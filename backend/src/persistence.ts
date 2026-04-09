import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppData } from './types.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStorageDir = path.resolve(currentDir, '..', '.data');
const defaultStorageFile = path.join(defaultStorageDir, 'app-data.json');

interface StorageDriver {
  hydrate(target: AppData): Promise<void>;
  persist(state: AppData): Promise<void>;
  hydrateUser?(userId: string, target: AppData): Promise<void>;
  persistUser?(userId: string, state: AppData): Promise<void>;
  deleteUser?(userId: string): Promise<void>;
  describe(): string;
}

interface SupabaseConfig {
  url: string;
  apiKey: string;
  stateTable: string;
  stateKey: string;
  userStateTable: string;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveSupabaseConfig(): SupabaseConfig | null {
  const explicitBackend = trimValue(process.env.DRIVEREADY_STORAGE_BACKEND).toLowerCase();

  if (explicitBackend && explicitBackend !== 'local' && explicitBackend !== 'supabase') {
    throw new Error('DRIVEREADY_STORAGE_BACKEND must be either "local" or "supabase".');
  }

  if (explicitBackend === 'local') {
    return null;
  }

  const url =
    trimValue(process.env.DRIVEREADY_SUPABASE_URL) ||
    trimValue(process.env.SUPABASE_URL);
  const apiKey =
    trimValue(process.env.DRIVEREADY_SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_KEY);
  const stateTable = trimValue(process.env.DRIVEREADY_SUPABASE_STATE_TABLE) || 'driveready_state';
  const stateKey = trimValue(process.env.DRIVEREADY_SUPABASE_STATE_KEY) || 'default';
  const userStateTable = trimValue(process.env.DRIVEREADY_SUPABASE_USER_STATE_TABLE) || 'driveready_user_state';
  const shouldUseSupabase =
    explicitBackend === 'supabase' ||
    Boolean(url && apiKey);

  if (!shouldUseSupabase) {
    return null;
  }

  if (!url || !apiKey) {
    throw new Error(
      'Supabase storage is enabled, but DRIVEREADY_SUPABASE_URL and DRIVEREADY_SUPABASE_SECRET_KEY are not both set.',
    );
  }

  return { url, apiKey, stateTable, stateKey, userStateTable };
}

function buildStorageDriver(): StorageDriver {
  const supabaseConfig = resolveSupabaseConfig();

  if (supabaseConfig) {
    return createSupabaseStorageDriver(supabaseConfig);
  }

  const storageFile = process.env.DRIVEREADY_DATA_FILE ?? defaultStorageFile;
  return createLocalStorageDriver(storageFile);
}

function createLocalStorageDriver(storageFile: string): StorageDriver {
  function ensureStorageDir() {
    const storageDir = path.dirname(storageFile);

    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }
  }

  return {
    async hydrate(target: AppData) {
      ensureStorageDir();

      if (!existsSync(storageFile)) {
        writeFileSync(storageFile, JSON.stringify(target, null, 2));
        return;
      }

      const raw = readFileSync(storageFile, 'utf8');
      const parsed = JSON.parse(raw) as AppData;
      Object.assign(target, parsed);
    },
    async persist(state: AppData) {
      ensureStorageDir();
      writeFileSync(storageFile, JSON.stringify(state, null, 2));
    },
    describe() {
      return `local file (${storageFile})`;
    },
  };
}

function createSupabaseStorageDriver(config: SupabaseConfig): StorageDriver {
  const baseUrl = config.url.replace(/\/$/, '');

  async function request<T>(tableName: string, method: string, searchParams: URLSearchParams, body?: unknown) {
    const endpoint = new URL(`/rest/v1/${tableName}`, baseUrl);
    endpoint.search = searchParams.toString();

    const response = await fetch(endpoint, {
      method,
      headers: {
        apikey: config.apiKey,
        'Content-Type': 'application/json',
        Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = await response.text();
      const missingTable =
        payload.toLowerCase().includes(tableName.toLowerCase()) &&
        payload.toLowerCase().includes('table');

      if (missingTable) {
        throw new Error(
          `Supabase table "${tableName}" was not found. Run the matching SQL file in backend/supabase first.`,
        );
      }

      throw new Error(
        `Supabase storage request failed (${response.status} ${response.statusText}): ${payload || 'no response body'}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = await response.text();

    if (!payload) {
      return undefined as T;
    }

    return JSON.parse(payload) as T;
  }

  async function upsertGlobalState(state: AppData) {
    const searchParams = new URLSearchParams({
      on_conflict: 'state_key',
    });

    await request<void>(config.stateTable, 'POST', searchParams, {
      state_key: config.stateKey,
      state,
      updated_at: new Date().toISOString(),
    });
  }

  async function hydrateGlobalState(target: AppData) {
    const searchParams = new URLSearchParams({
      select: 'state',
      state_key: `eq.${config.stateKey}`,
      limit: '1',
    });

    const rows = await request<Array<{ state: AppData }>>(config.stateTable, 'GET', searchParams);

    if (rows.length === 0) {
      await upsertGlobalState(target);
      return;
    }

    Object.assign(target, rows[0].state);
  }

  async function upsertUserState(userId: string, state: AppData) {
    const searchParams = new URLSearchParams({
      on_conflict: 'user_id',
    });

    await request<void>(config.userStateTable, 'POST', searchParams, {
      user_id: userId,
      state,
      updated_at: new Date().toISOString(),
    });
  }

  async function hydrateUserState(userId: string, target: AppData) {
    const searchParams = new URLSearchParams({
      select: 'state',
      user_id: `eq.${userId}`,
      limit: '1',
    });

    const rows = await request<Array<{ state: AppData }>>(config.userStateTable, 'GET', searchParams);

    if (rows.length === 0) {
      await upsertUserState(userId, target);
      return;
    }

    Object.assign(target, rows[0].state);
  }

  async function deleteUserState(userId: string) {
    const searchParams = new URLSearchParams({
      user_id: `eq.${userId}`,
    });

    await request<void>(config.userStateTable, 'DELETE', searchParams);
  }

  return {
    async hydrate(target: AppData) {
      await hydrateGlobalState(target);
    },
    async persist(state: AppData) {
      await upsertGlobalState(state);
    },
    async hydrateUser(userId: string, target: AppData) {
      await hydrateUserState(userId, target);
    },
    async persistUser(userId: string, state: AppData) {
      await upsertUserState(userId, state);
    },
    async deleteUser(userId: string) {
      await deleteUserState(userId);
    },
    describe() {
      return `Supabase (${baseUrl}, tables: ${config.stateTable}, ${config.userStateTable})`;
    },
  };
}

const storageDriver = buildStorageDriver();

export async function hydrateAppData(target: AppData) {
  await storageDriver.hydrate(target);
}

export async function persistAppData(state: AppData) {
  await storageDriver.persist(state);
}

export function supportsPerUserAppData() {
  return typeof storageDriver.hydrateUser === 'function' && typeof storageDriver.persistUser === 'function';
}

export async function hydrateUserAppData(userId: string, target: AppData) {
  if (!storageDriver.hydrateUser) {
    throw new Error('Per-user app data is not supported by the configured storage backend.');
  }

  await storageDriver.hydrateUser(userId, target);
}

export async function persistUserAppData(userId: string, state: AppData) {
  if (!storageDriver.persistUser) {
    throw new Error('Per-user app data is not supported by the configured storage backend.');
  }

  await storageDriver.persistUser(userId, state);
}

export async function deleteUserAppData(userId: string) {
  if (!storageDriver.deleteUser) {
    throw new Error('Per-user app data deletion is not supported by the configured storage backend.');
  }

  await storageDriver.deleteUser(userId);
}

export function getStorageTargetLabel() {
  return storageDriver.describe();
}
