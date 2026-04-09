import type {
  AlertSummary,
  DashboardResponse,
  DocumentDetailResponse,
  DocumentSummary,
  NotificationPreferences,
  PermissionStates,
  RefuelSearchResponse,
  SavedZone,
  SessionState,
  SupportItem,
  TripCheckRecord,
  UserProfile,
  VehicleDetailResponse,
  VehicleSummary,
} from './types';
import { clearStoredSession, getSessionToken, getStoredSession, storeSession } from './session';

const DEFAULT_API_BASE = 'http://127.0.0.1:4000/api/v1';

function resolveApiBase() {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (!configured) {
    return DEFAULT_API_BASE;
  }

  return configured.replace(/\/+$/, '');
}

const API_BASE = resolveApiBase();

export interface LocalUploadAsset {
  uri: string;
  name: string;
  mimeType?: string;
}

async function authorizedFetch(path: string, init?: RequestInit, retryOnRefresh = true) {
  const headers = new Headers(init?.headers);
  const token = getSessionToken();
  const isFormDataBody = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  if (!isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401 && retryOnRefresh && path !== '/auth/refresh') {
    const refreshed = await refreshStoredSession();

    if (refreshed) {
      return authorizedFetch(path, init, false);
    }
  }

  return response;
}

async function refreshStoredSession() {
  const currentSession = getStoredSession();

  if (!currentSession?.refresh_token) {
    return false;
  }

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: currentSession.refresh_token,
    }),
  });

  if (!response.ok) {
    await clearStoredSession();
    return false;
  }

  const payload = (await response.json()) as {
    session?: SessionState | null;
  };

  if (!payload.session) {
    await clearStoredSession();
    return false;
  }

  await storeSession(payload.session);
  return true;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authorizedFetch(path, init);

  if (!response.ok) {
    const fallback = {
      error: {
        message: `Request failed: ${response.status}`,
      },
    };
    const payload = (await response.json().catch(() => fallback)) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? fallback.error.message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  session: () => request<{ user: UserProfile | null; session: SessionState | null }>('/auth/session'),
  refreshSession: (refreshToken: string) =>
    request<{ user: UserProfile; session: SessionState }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    }),
  signIn: (body: { email: string; password: string }) =>
    request<{ user: UserProfile; session: SessionState }>('/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  signUp: (body: { first_name: string; last_name: string; email: string; password: string }) =>
    request<{ user: UserProfile; session: SessionState }>('/auth/sign-up', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  requestPasswordReset: (body: { email: string; redirect_to?: string }) =>
    request<{ message: string }>('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  confirmPasswordReset: (body: { access_token: string; password: string }) =>
    request<{ message: string }>('/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  signOut: () =>
    request<void>('/auth/sign-out', {
      method: 'POST',
    }),
  me: () =>
    request<{
      user: UserProfile;
      notification_preferences: NotificationPreferences;
      permission_states: PermissionStates;
    }>('/me'),
  updateProfile: (body: Partial<UserProfile>) =>
    request<{ user: UserProfile }>('/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateNotificationPreferences: (body: Partial<NotificationPreferences>) =>
    request<{ notification_preferences: NotificationPreferences }>('/me/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updatePermissionStates: (body: Partial<PermissionStates>) =>
    request<{ permission_states: PermissionStates }>('/me/permission-states', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAccount: () =>
    request<void>('/me', {
      method: 'DELETE',
    }),
  dashboard: () => request<DashboardResponse>('/dashboard'),
  vehicles: () => request<{ vehicles: VehicleSummary[] }>('/vehicles'),
  vehicle: (vehicleId: string) => request<VehicleDetailResponse>(`/vehicles/${vehicleId}`),
  createVehicle: (body: Record<string, unknown>) =>
    request<{ vehicle: VehicleSummary }>('/vehicles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateVehicle: (vehicleId: string, body: Record<string, unknown>) =>
    request<{ vehicle: VehicleSummary }>(`/vehicles/${vehicleId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  enrichVehicle: (vehicleId: string) =>
    request<{ vehicle: VehicleSummary; freshness_at: string; mot_tests_synced: number; source_name: string }>(`/vehicles/${vehicleId}/enrich`, {
      method: 'POST',
    }),
  deleteVehicle: (vehicleId: string) =>
    request<void>(`/vehicles/${vehicleId}`, {
      method: 'DELETE',
    }),
  alerts: (query = '') => request<{ alerts: AlertSummary[] }>(`/alerts${query}`),
  alert: (alertId: string) => request<{ alert: AlertSummary }>(`/alerts/${alertId}`),
  updateAlert: (alertId: string, body: Record<string, unknown>) =>
    request<{ alert: AlertSummary }>(`/alerts/${alertId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  documents: (query = '') => request<{ documents: DocumentSummary[] }>(`/documents${query}`),
  document: (documentId: string) => request<DocumentDetailResponse>(`/documents/${documentId}`),
  initDocumentUpload: () =>
    request<{ upload: { upload_id: string; status: string } }>('/documents/upload-init', {
      method: 'POST',
    }),
  uploadDocumentBinary: async (uploadId: string, asset: LocalUploadAsset) => {
    const formData = new FormData();
    formData.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/octet-stream',
    } as unknown as Blob);

    const headers = new Headers();
    const token = getSessionToken();

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await authorizedFetch(
      `/documents/upload-binary/${uploadId}`,
      {
        method: 'POST',
        headers,
        body: formData,
      },
      false,
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? 'Upload failed.');
    }

    return (await response.json()) as {
      upload: {
        upload_id: string;
        file_key: string;
        file_name: string;
        mime_type: string;
        uploaded_at: string;
        download_url: string;
      };
    };
  },
  createDocument: (body: Record<string, unknown>) =>
    request<{ document: DocumentSummary }>('/documents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateDocument: (documentId: string, body: Record<string, unknown>) =>
    request<{ document: DocumentSummary }>(`/documents/${documentId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteDocument: (documentId: string) =>
    request<void>(`/documents/${documentId}`, {
      method: 'DELETE',
    }),
  shareDocument: (documentId: string) =>
    request<{ share_url: string }>(`/documents/${documentId}/share`, {
      method: 'POST',
    }),
  zones: () => request<{ zones: SavedZone[] }>('/zones'),
  createZone: (body: Record<string, unknown>) =>
    request<{ zone: SavedZone }>('/zones', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateZone: (zoneId: string, body: Record<string, unknown>) =>
    request<{ zone: SavedZone }>(`/zones/${zoneId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteZone: (zoneId: string) =>
    request<void>(`/zones/${zoneId}`, {
      method: 'DELETE',
    }),
  tripChecks: () => request<{ trip_checks: TripCheckRecord[] }>('/trip-checks'),
  runTripCheck: (body: Record<string, unknown>) =>
    request<{ trip_check: TripCheckRecord }>('/trip-checks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  searchRefuelOptions: (body: Record<string, unknown>) =>
    request<RefuelSearchResponse>('/refuel-options', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  supportContent: () => request<{ items: SupportItem[] }>('/support/content'),
  exportRequest: () =>
    request<{ message: string }>('/support/export-request', {
      method: 'POST',
    }),
};
