import type {
  PermissionState,
  RefuelEnergyType,
  SessionState,
} from './api/types';

export interface PasswordRecoveryState {
  access_token: string;
  refresh_token?: string;
  expires_at: string;
}

interface ParsedLink {
  queryParams?: Record<string, string | string[] | undefined> | null;
}

function readLinkParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === 'string' ? value : undefined;
}

function decodeLinkParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveRecoveryExpiry(params: URLSearchParams, nowMs = Date.now()) {
  const expiresAt = Number(params.get('expires_at'));

  if (Number.isFinite(expiresAt) && expiresAt > 0) {
    return new Date(expiresAt * 1000).toISOString();
  }

  const expiresIn = Number(params.get('expires_in'));

  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(nowMs + expiresIn * 1000).toISOString();
  }

  return new Date(nowMs + 60 * 60 * 1000).toISOString();
}

export function getPasswordRecoveryFromUrl(url: string, parseUrl: (url: string) => ParsedLink) {
  const parsed = parseUrl(url);
  const params = new URLSearchParams();

  Object.entries(parsed.queryParams ?? {}).forEach(([key, value]) => {
    const normalizedValue = readLinkParam(value);

    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  });

  const hashFragment = url.split('#')[1];

  if (hashFragment) {
    const hashParams = new URLSearchParams(hashFragment);
    hashParams.forEach((value, key) => {
      params.set(key, value);
    });
  }

  const errorMessage = params.get('error_description') ?? params.get('error');

  if (errorMessage) {
    return {
      error: decodeLinkParam(errorMessage),
    };
  }

  const accessToken = params.get('access_token');

  if (!accessToken || params.get('type') !== 'recovery') {
    return null;
  }

  return {
    recovery: {
      access_token: accessToken,
      refresh_token: params.get('refresh_token') ?? undefined,
      expires_at: resolveRecoveryExpiry(params),
    } satisfies PasswordRecoveryState,
  };
}

export function energyTypeFromFuelType(fuelType?: string): RefuelEnergyType {
  const normalizedFuelType = fuelType?.toLowerCase() ?? '';

  if (normalizedFuelType.includes('electric')) {
    return 'electric';
  }

  if (normalizedFuelType.includes('diesel')) {
    return 'diesel';
  }

  return 'petrol';
}

export function resolvePasswordResetSession(
  result: { session?: SessionState | null },
  payload: { access_token: string; refresh_token?: string; expires_at: string },
) {
  if (result.session) {
    return result.session;
  }

  if (!payload.refresh_token) {
    return null;
  }

  return {
    token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: payload.expires_at,
  } satisfies SessionState;
}

function permissionStateFromStatus(status: string): PermissionState {
  if (status === 'granted') {
    return 'granted';
  }

  if (status === 'denied') {
    return 'denied';
  }

  return 'not_requested';
}

export interface PushRegistrationDeps {
  getExpoPushToken: (projectId?: string) => Promise<string>;
  getPermissions: () => Promise<{ status: string }>;
  isDevice: boolean;
  platform: 'android' | 'ios';
  projectId?: string;
  requestPermissions: () => Promise<{ status: string }>;
  setAndroidChannel?: () => Promise<void>;
}

export async function registerForPushNotifications(deps: PushRegistrationDeps) {
  if (!deps.isDevice) {
    throw new Error('Push notifications require a physical device.');
  }

  let permission = await deps.getPermissions();

  if (permission.status !== 'granted') {
    permission = await deps.requestPermissions();
  }

  const permissionState = permissionStateFromStatus(permission.status);

  if (permissionState !== 'granted') {
    return {
      permissionState,
    };
  }

  if (deps.platform === 'android') {
    await deps.setAndroidChannel?.();
  }

  return {
    permissionState,
    platform: deps.platform,
    token: await deps.getExpoPushToken(deps.projectId),
  };
}
