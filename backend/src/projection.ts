import { buildNormalizedWriteModel, normalizedUserTableNames, normalizedTables } from './normalized-state.js';
import { usesNormalizedSupabaseStorage } from './persistence.js';
import type { AppData } from './types.js';

interface ProjectionConfig {
  apiKey: string;
  enabled: boolean;
  url: string;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveProjectionConfig(): ProjectionConfig | null {
  const enabled = trimValue(process.env.DRIVEREADY_PROJECTION_ENABLED).toLowerCase() === 'true';

  if (!enabled || usesNormalizedSupabaseStorage()) {
    return null;
  }

  const url = trimValue(process.env.DRIVEREADY_SUPABASE_URL) || trimValue(process.env.SUPABASE_URL);
  const apiKey =
    trimValue(process.env.DRIVEREADY_SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_KEY);

  if (!url || !apiKey) {
    throw new Error('Normalized projection requires Supabase URL and secret key.');
  }

  return {
    apiKey,
    enabled,
    url: url.replace(/\/$/, ''),
  };
}

const config = resolveProjectionConfig();

async function request(table: string, method: string, searchParams: URLSearchParams, body?: unknown) {
  if (!config) {
    return;
  }

  const endpoint = new URL(`/rest/v1/${table}`, config.url);
  endpoint.search = searchParams.toString();

  const response = await fetch(endpoint, {
    method,
    headers: {
      apikey: config.apiKey,
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Projection request failed for ${table}: ${response.status} ${await response.text()}`);
  }
}

async function replaceRows(table: string, userId: string, rows: Array<Record<string, unknown>>, conflictKey = 'id') {
  if (!config) {
    return;
  }

  await request(
    table,
    'DELETE',
    new URLSearchParams({
      user_id: `eq.${userId}`,
    }),
  );

  if (rows.length === 0) {
    return;
  }

  await request(
    table,
    'POST',
    new URLSearchParams({
      on_conflict: conflictKey,
    }),
    rows,
  );
}

export function normalizedProjectionEnabled() {
  return Boolean(config?.enabled);
}

export async function deleteProjectedUserData(userId: string) {
  if (!config) {
    return;
  }

  await Promise.all(
    normalizedUserTableNames.map((table) =>
      request(
        table,
        'DELETE',
        new URLSearchParams({
          user_id: `eq.${userId}`,
        }),
      ),
    ),
  );
}

export async function projectUserAppData(userId: string, state: AppData) {
  if (!config) {
    return;
  }

  const writeModel = buildNormalizedWriteModel(userId, state);
  await request(
    normalizedTables.profile,
    'POST',
    new URLSearchParams({
      on_conflict: 'user_id',
    }),
    [writeModel.profile],
  );

  await Promise.all(
    writeModel.repeatedTables.map(({ rows, table }) => replaceRows(table, userId, rows)),
  );
}
