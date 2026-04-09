import type {
  VehicleMotOdometerResultType,
  VehicleMotOdometerUnit,
  VehicleMotRecallStatus,
  VehicleMotSnapshot,
  VehicleMotTestResult,
  VehicleMotTestSnapshot,
  VehicleRecord,
  VehicleServiceHistoryEntry,
} from './types.js';

interface DvsaMotConfig {
  apiKey: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenUrl: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface DvsaDefect {
  dangerous?: boolean | null;
  text?: string | null;
  type?: string | null;
}

interface DvsaMotTest {
  completedDate: string;
  dataSource: string;
  defects?: DvsaDefect[] | null;
  expiryDate?: string | null;
  motTestNumber?: string | null;
  odometerResultType: VehicleMotOdometerResultType;
  odometerUnit?: VehicleMotOdometerUnit | null;
  odometerValue?: string | null;
  registrationAtTimeOfTest?: string | null;
  testResult: VehicleMotTestResult;
}

interface DvsaVehicleResponse {
  engineSize?: string | null;
  firstUsedDate?: string | null;
  fuelType?: string | null;
  hasOutstandingRecall: VehicleMotRecallStatus;
  make?: string | null;
  manufactureDate?: string | null;
  model?: string | null;
  motTestDueDate?: string | null;
  motTests?: DvsaMotTest[] | null;
  primaryColour?: string | null;
  registration?: string | null;
  registrationDate?: string | null;
}

interface DvsaMotEnrichment {
  freshnessAt: string;
  motHistoryEntries: VehicleServiceHistoryEntry[];
  sourceName: string;
  vehicle: VehicleRecord;
}

interface DvsaMotConfigState {
  config: DvsaMotConfig | null;
  missing: string[];
  partiallyConfigured: boolean;
}

const DEFAULT_SCOPE = 'https://tapi.dvsa.gov.uk/.default';
const DEFAULT_BASE_URL = 'https://history.mot.api.gov.uk';
const DEFAULT_SOURCE_NAME = 'dvsa-mot-history-api';
let cachedToken: CachedToken | null = null;

export class DvsaMotError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'DvsaMotError';
    this.statusCode = statusCode;
  }
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveConfigState(): DvsaMotConfigState {
  const apiKey = trimValue(process.env.DRIVEREADY_DVSA_MOT_API_KEY);
  const clientId = trimValue(process.env.DRIVEREADY_DVSA_MOT_CLIENT_ID);
  const clientSecret = trimValue(process.env.DRIVEREADY_DVSA_MOT_CLIENT_SECRET);
  const tokenUrl = trimValue(process.env.DRIVEREADY_DVSA_MOT_TOKEN_URL);
  const scope = trimValue(process.env.DRIVEREADY_DVSA_MOT_SCOPE) || DEFAULT_SCOPE;
  const baseUrl = trimValue(process.env.DRIVEREADY_DVSA_MOT_BASE_URL) || DEFAULT_BASE_URL;
  const fields = {
    DRIVEREADY_DVSA_MOT_API_KEY: apiKey,
    DRIVEREADY_DVSA_MOT_CLIENT_ID: clientId,
    DRIVEREADY_DVSA_MOT_CLIENT_SECRET: clientSecret,
    DRIVEREADY_DVSA_MOT_TOKEN_URL: tokenUrl,
  };
  const missing = Object.entries(fields)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const provided = Object.values(fields).filter(Boolean).length;

  if (provided === 0) {
    return {
      config: null,
      missing,
      partiallyConfigured: false,
    };
  }

  if (missing.length > 0) {
    return {
      config: null,
      missing,
      partiallyConfigured: true,
    };
  }

  return {
    config: {
      apiKey,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      clientId,
      clientSecret,
      scope,
      tokenUrl,
    },
    missing: [],
    partiallyConfigured: false,
  };
}

function requireConfig() {
  const state = resolveConfigState();

  if (state.config) {
    return state.config;
  }

  if (state.partiallyConfigured) {
    throw new DvsaMotError(
      `DVSA MOT integration is misconfigured. Missing: ${state.missing.join(', ')}.`,
      503,
    );
  }

  throw new DvsaMotError(
    'DVSA MOT integration is not configured. Set DRIVEREADY_DVSA_MOT_API_KEY, DRIVEREADY_DVSA_MOT_CLIENT_ID, DRIVEREADY_DVSA_MOT_CLIENT_SECRET, and DRIVEREADY_DVSA_MOT_TOKEN_URL.',
    503,
  );
}

export function getDvsaMotTargetLabel() {
  const state = resolveConfigState();

  if (state.config) {
    return `DVSA MOT (${state.config.baseUrl})`;
  }

  if (state.partiallyConfigured) {
    return `DVSA MOT (misconfigured: missing ${state.missing.join(', ')})`;
  }

  return 'DVSA MOT (not configured)';
}

export function usesDvsaMot() {
  return Boolean(resolveConfigState().config);
}

export function hasDvsaMotSetup() {
  const state = resolveConfigState();
  return state.partiallyConfigured || Boolean(state.config);
}

function normalizeRegistration(registration: string) {
  return registration.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sortMotTestsDescending(tests: DvsaMotTest[]) {
  return [...tests].sort((left, right) => Date.parse(right.completedDate) - Date.parse(left.completedDate));
}

function parseOptionalNumber(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function findMotDueDate(payload: DvsaVehicleResponse, tests: DvsaMotTest[]) {
  if (payload.motTestDueDate) {
    return payload.motTestDueDate;
  }

  return tests.find((entry) => entry.expiryDate)?.expiryDate ?? undefined;
}

function toMotTestSnapshot(test: DvsaMotTest): VehicleMotTestSnapshot {
  const defects = test.defects ?? [];

  return {
    completed_at: test.completedDate,
    data_source: test.dataSource,
    defect_count: defects.length,
    dangerous_defect_count: defects.filter((entry) => entry.dangerous).length,
    expiry_date: test.expiryDate ?? undefined,
    mot_test_number: test.motTestNumber ?? undefined,
    odometer_result_type: test.odometerResultType,
    odometer_unit: test.odometerUnit ?? undefined,
    odometer_value: parseOptionalNumber(test.odometerValue),
    test_result: test.testResult,
  };
}

function buildMotSnapshot(
  registration: string,
  payload: DvsaVehicleResponse,
  tests: DvsaMotTest[],
  checkedAt: string,
): VehicleMotSnapshot {
  const lastTest = tests[0] ? toMotTestSnapshot(tests[0]) : null;

  return {
    checked_at: checkedAt,
    engine_size: payload.engineSize ?? undefined,
    first_used_date: payload.firstUsedDate ?? undefined,
    last_test: lastTest,
    make: payload.make ?? undefined,
    manufacture_date: payload.manufactureDate ?? undefined,
    model: payload.model ?? undefined,
    mot_test_due_date: findMotDueDate(payload, tests),
    primary_colour: payload.primaryColour ?? undefined,
    recall_status: payload.hasOutstandingRecall,
    registration_checked: registration,
    registration_date: payload.registrationDate ?? undefined,
    source_name: DEFAULT_SOURCE_NAME,
    test_count: tests.length,
  };
}

function buildMotHistoryNote(test: DvsaMotTest) {
  const parts: string[] = [];

  if (test.expiryDate) {
    parts.push(`Expiry ${test.expiryDate}`);
  }

  if (test.odometerValue) {
    const unit = test.odometerUnit ? ` ${test.odometerUnit}` : '';
    parts.push(`Odometer ${test.odometerValue}${unit}`);
  }

  const defectCount = test.defects?.length ?? 0;

  if (defectCount > 0) {
    parts.push(`${defectCount} defect${defectCount === 1 ? '' : 's'}`);
  }

  parts.push(`Source ${test.dataSource}`);

  return parts.join(' · ');
}

function buildMotHistoryEntries(vehicleId: string, tests: DvsaMotTest[]) {
  return tests.map((test) => {
    const key = test.motTestNumber?.trim() || test.completedDate;
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'unknown';

    return {
      id: `mot-history-${vehicleId}-${normalizedKey}`,
      vehicle_id: vehicleId,
      event_date: test.completedDate.slice(0, 10),
      note: buildMotHistoryNote(test),
      title: test.testResult === 'PASSED' ? 'MOT passed' : 'MOT failed',
    } satisfies VehicleServiceHistoryEntry;
  });
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);

  if (!response.ok) {
    let message = `DVSA MOT request failed with status ${response.status}.`;

    try {
      const payload = (await response.json()) as { errorMessage?: string };
      message = payload.errorMessage?.trim() || message;
    } catch {
      // Ignore JSON parse errors and keep fallback message.
    }

    throw new DvsaMotError(message, response.status === 404 ? 404 : 502);
  }

  return response.json() as Promise<T>;
}

async function getAccessToken(config: DvsaMotConfig) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'client_credentials',
    scope: config.scope,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new DvsaMotError('Unable to obtain a DVSA MOT access token.', 502);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };

  if (!payload.access_token) {
    throw new DvsaMotError('DVSA MOT token response did not include an access token.', 502);
  }

  const expiresInSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  return payload.access_token;
}

async function fetchVehicleByRegistration(registration: string) {
  const config = requireConfig();
  const accessToken = await getAccessToken(config);
  const normalizedRegistration = normalizeRegistration(registration);

  if (!normalizedRegistration) {
    throw new DvsaMotError('A valid vehicle registration is required to query DVSA MOT history.', 400);
  }

  const payload = await requestJson<DvsaVehicleResponse>(
    `${config.baseUrl}/v1/trade/vehicles/registration/${encodeURIComponent(normalizedRegistration)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-API-Key': config.apiKey,
      },
    },
  );

  return {
    normalizedRegistration,
    payload,
  };
}

export async function enrichVehicleWithDvsaMot(vehicle: VehicleRecord): Promise<DvsaMotEnrichment> {
  const freshnessAt = new Date().toISOString();
  const { normalizedRegistration, payload } = await fetchVehicleByRegistration(vehicle.registration_plate);
  const tests = sortMotTestsDescending(payload.motTests ?? []);
  const motSnapshot = buildMotSnapshot(normalizedRegistration, payload, tests, freshnessAt);
  const makeModel = [payload.make?.trim(), payload.model?.trim()].filter(Boolean).join(' ').trim();
  const updatedVehicle: VehicleRecord = {
    ...vehicle,
    dvsa_mot: motSnapshot,
    fuel_type: payload.fuelType?.trim() || vehicle.fuel_type,
    make_model: makeModel || vehicle.make_model,
    mot_due_at: motSnapshot.mot_test_due_date || vehicle.mot_due_at,
  };

  return {
    freshnessAt,
    motHistoryEntries: buildMotHistoryEntries(vehicle.id, tests),
    sourceName: DEFAULT_SOURCE_NAME,
    vehicle: updatedVehicle,
  };
}
