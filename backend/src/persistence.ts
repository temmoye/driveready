import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyNormalizedReadModel, buildNormalizedWriteModel, normalizedTables, normalizedUserTableNames, type NormalizedReadModel } from './normalized-state.js';
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
  listUsers?(): Promise<string[]>;
  describe(): string;
}

interface SupabaseConfig {
  url: string;
  apiKey: string;
  storageMode: 'state' | 'normalized';
  stateTable: string;
  stateKey: string;
  userStateTable: string;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveSupabaseStorageMode() {
  const configured = trimValue(process.env.DRIVEREADY_SUPABASE_STORAGE_MODE).toLowerCase();

  if (!configured) {
    return 'state' as const;
  }

  if (configured === 'state' || configured === 'normalized') {
    return configured;
  }

  throw new Error('DRIVEREADY_SUPABASE_STORAGE_MODE must be either "state" or "normalized".');
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
  const storageMode = resolveSupabaseStorageMode();
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

  return { url, apiKey, stateTable, stateKey, storageMode, userStateTable };
}

function buildStorageDriver(supabaseConfig: SupabaseConfig | null): StorageDriver {
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

  function listRowIds(table: string, rows: Array<Record<string, unknown>>) {
    return rows.map((row) => {
      const id = typeof row.id === 'string' ? trimValue(row.id) : '';

      if (!id) {
        throw new Error(`Normalized storage row in "${table}" is missing an id.`);
      }

      return id;
    });
  }

  function buildNotInFilter(ids: string[]) {
    return `not.in.(${ids.map((id) => JSON.stringify(id)).join(',')})`;
  }

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

  async function requestOptional<T>(tableName: string, method: string, searchParams: URLSearchParams, fallback: T, body?: unknown) {
    try {
      return await request<T>(tableName, method, searchParams, body);
    } catch (error) {
      if (error instanceof Error && error.message.includes(`Supabase table "${tableName}" was not found`)) {
        return fallback;
      }

      throw error;
    }
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

  async function upsertLegacyUserState(userId: string, state: AppData) {
    const searchParams = new URLSearchParams({
      on_conflict: 'user_id',
    });

    await request<void>(config.userStateTable, 'POST', searchParams, {
      user_id: userId,
      state,
      updated_at: new Date().toISOString(),
    });
  }

  async function readLegacyUserState(userId: string) {
    const searchParams = new URLSearchParams({
      select: 'state',
      user_id: `eq.${userId}`,
      limit: '1',
    });

    const rows = await requestOptional<Array<{ state: AppData }>>(config.userStateTable, 'GET', searchParams, []);

    if (rows.length === 0) {
      return null;
    }

    return rows[0].state;
  }

  async function hydrateLegacyUserState(userId: string, target: AppData) {
    const existingState = await readLegacyUserState(userId);

    if (!existingState) {
      await upsertLegacyUserState(userId, target);
      return false;
    }

    Object.assign(target, existingState);
    return true;
  }

  async function deleteLegacyUserState(userId: string) {
    const searchParams = new URLSearchParams({
      user_id: `eq.${userId}`,
    });

    await requestOptional<void>(config.userStateTable, 'DELETE', searchParams, undefined as void);
  }

  async function deleteNormalizedUserState(userId: string) {
    await Promise.all(normalizedUserTableNames.map((table) =>
      request<void>(
        table,
        'DELETE',
        new URLSearchParams({
          user_id: `eq.${userId}`,
        }),
      ),
    ));
    await deleteLegacyUserState(userId);
  }

  async function replaceNormalizedRows(table: string, userId: string, rows: Array<Record<string, unknown>>) {
    const rowIds = listRowIds(table, rows);

    if (rows.length > 0) {
      await request<void>(
        table,
        'POST',
        new URLSearchParams({
          on_conflict: 'id',
        }),
        rows,
      );
    }

    const deleteParams = new URLSearchParams({
      user_id: `eq.${userId}`,
    });

    if (rowIds.length > 0) {
      deleteParams.set('id', buildNotInFilter(rowIds));
    }

    await request<void>(table, 'DELETE', deleteParams);
  }

  async function upsertNormalizedUserState(userId: string, state: AppData) {
    const writeModel = buildNormalizedWriteModel(userId, state);
    await request<void>(
      normalizedTables.profile,
      'POST',
      new URLSearchParams({
        on_conflict: 'user_id',
      }),
      [writeModel.profile],
    );

    // PostgREST writes here are not wrapped in a cross-table transaction. Upserting before pruning stale ids
    // keeps each repeated table retry-safe and avoids leaving a table empty if a write is interrupted.
    await Promise.all(writeModel.repeatedTables.map(async ({ rows, table }) => {
      await replaceNormalizedRows(table, userId, rows);
    }));
  }

  async function hydrateNormalizedUserState(userId: string, target: AppData) {
    const [
      profileRows,
      vehicles,
      serviceHistory,
      documents,
      alerts,
      zones,
      tripChecks,
      scheduledReminders,
      pushDevices,
      dataExports,
      reminderDispatches,
    ] = await Promise.all([
      request<Array<NormalizedReadModel['profile']>>(normalizedTables.profile, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
        limit: '1',
      })),
      request<Array<NormalizedReadModel['vehicles'][number]>>(normalizedTables.vehicle, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['serviceHistory'][number]>>(normalizedTables.serviceHistory, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['documents'][number]>>(normalizedTables.document, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['alerts'][number]>>(normalizedTables.alert, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['zones'][number]>>(normalizedTables.zone, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['tripChecks'][number]>>(normalizedTables.tripCheck, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['scheduledReminders'][number]>>(normalizedTables.scheduledReminder, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['pushDevices'][number]>>(normalizedTables.pushDevice, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      request<Array<NormalizedReadModel['dataExports'][number]>>(normalizedTables.dataExport, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      })),
      requestOptional<Array<NormalizedReadModel['reminderDispatches'][number]>>(normalizedTables.reminderDispatch, 'GET', new URLSearchParams({
        select: '*',
        user_id: `eq.${userId}`,
      }), []),
    ]);

    if (
      profileRows.length === 0 &&
      vehicles.length === 0 &&
      serviceHistory.length === 0 &&
      documents.length === 0 &&
      alerts.length === 0 &&
      zones.length === 0 &&
      tripChecks.length === 0 &&
      scheduledReminders.length === 0 &&
      pushDevices.length === 0 &&
      dataExports.length === 0 &&
      reminderDispatches.length === 0
    ) {
      const hydratedFromLegacy = await hydrateLegacyUserState(userId, target);

      if (!hydratedFromLegacy) {
        await upsertNormalizedUserState(userId, target);
        return;
      }

      await upsertNormalizedUserState(userId, target);
      await deleteLegacyUserState(userId);
      return;
    }

    await applyNormalizedReadModel(target, {
      profile: profileRows[0] ?? null,
      vehicles,
      serviceHistory,
      documents,
      alerts,
      zones,
      tripChecks,
      scheduledReminders,
      pushDevices,
      dataExports,
      reminderDispatches,
    });
  }

  return {
    async hydrate(target: AppData) {
      await hydrateGlobalState(target);
    },
    async persist(state: AppData) {
      await upsertGlobalState(state);
    },
    async hydrateUser(userId: string, target: AppData) {
      if (config.storageMode === 'normalized') {
        await hydrateNormalizedUserState(userId, target);
        return;
      }

      await hydrateLegacyUserState(userId, target);
    },
    async persistUser(userId: string, state: AppData) {
      if (config.storageMode === 'normalized') {
        await upsertNormalizedUserState(userId, state);
        return;
      }

      await upsertLegacyUserState(userId, state);
    },
    async deleteUser(userId: string) {
      if (config.storageMode === 'normalized') {
        await deleteNormalizedUserState(userId);
        return;
      }

      await deleteLegacyUserState(userId);
    },
    async listUsers() {
      if (config.storageMode === 'normalized') {
        const [profileRows, legacyRows] = await Promise.all([
          request<Array<{ user_id: string }>>(normalizedTables.profile, 'GET', new URLSearchParams({
            select: 'user_id',
          })),
          requestOptional<Array<{ user_id: string }>>(config.userStateTable, 'GET', new URLSearchParams({
            select: 'user_id',
          }), []),
        ]);

        return [...new Set(
          [...profileRows, ...legacyRows]
            .map((row) => trimValue(row.user_id))
            .filter(Boolean),
        )];
      }

      const legacyRows = await request<Array<{ user_id: string }>>(config.userStateTable, 'GET', new URLSearchParams({
        select: 'user_id',
      }));
      return legacyRows.map((row) => trimValue(row.user_id)).filter(Boolean);
    },
    describe() {
      if (config.storageMode === 'normalized') {
        return `Supabase normalized tables (${baseUrl})`;
      }

      return `Supabase JSON state (${baseUrl}, tables: ${config.stateTable}, ${config.userStateTable})`;
    },
  };
}

const resolvedSupabaseConfig = resolveSupabaseConfig();
const storageDriver = buildStorageDriver(resolvedSupabaseConfig);

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

export async function listStoredUserIds() {
  if (!storageDriver.listUsers) {
    return [];
  }

  return storageDriver.listUsers();
}

export function getStorageTargetLabel() {
  return storageDriver.describe();
}

export function usesNormalizedSupabaseStorage() {
  return resolvedSupabaseConfig?.storageMode === 'normalized';
}
