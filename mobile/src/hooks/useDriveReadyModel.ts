import { useCallback, useEffect, useState } from 'react';

import { apiClient, type LocalUploadAsset } from '../api/client';
import {
  clearStoredSession,
  getStoredSession,
  loadStoredSession,
  storeSession,
} from '../api/session';
import { resolvePasswordResetSession } from '../app-helpers';
import type {
  AlertSummary,
  DashboardSnapshot,
  DocumentSummary,
  NotificationPreferences,
  PermissionStates,
  PushDeviceRecord,
  SavedZone,
  SessionState,
  SupportItem,
  TripCheckResponse,
  TripCheckRecord,
  UserProfile,
  VehicleDetailResponse,
  VehicleSummary,
} from '../api/types';

interface LoadableState {
  user: UserProfile | null;
  session: SessionState | null;
  dashboard: DashboardSnapshot | null;
  selectedVehicle: VehicleSummary | null;
  vehicles: VehicleSummary[];
  alerts: AlertSummary[];
  documents: DocumentSummary[];
  zones: SavedZone[];
  tripChecks: TripCheckRecord[];
  notificationPreferences: NotificationPreferences | null;
  permissionStates: PermissionStates | null;
  pushDevices: PushDeviceRecord[];
  supportItems: SupportItem[];
}

const initialState: LoadableState = {
  user: null,
  session: null,
  dashboard: null,
  selectedVehicle: null,
  vehicles: [],
  alerts: [],
  documents: [],
  zones: [],
  tripChecks: [],
  notificationPreferences: null,
  permissionStates: null,
  pushDevices: [],
  supportItems: [],
};

export function useDriveReadyModel() {
  const [state, setState] = useState<LoadableState>(initialState);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const currentSession = getStoredSession();
      let sessionResult = await apiClient.session();

      if (!sessionResult.session && currentSession?.refresh_token) {
        const refreshedSession = await apiClient.refreshSession(currentSession.refresh_token);
        sessionResult = refreshedSession;
        await storeSession(refreshedSession.session);
      }

      if (!sessionResult.session) {
        await clearStoredSession();
        setState({
          ...initialState,
          user: sessionResult.user,
          session: null,
        });
        return;
      }

      const [meResult, dashboardResult, vehicleResult, alertResult, documentResult, zoneResult, tripCheckResult, supportResult] =
        await Promise.all([
          apiClient.me(),
          apiClient.dashboard(),
          apiClient.vehicles(),
          apiClient.alerts('?status=all'),
          apiClient.documents('?status=all'),
          apiClient.zones(),
          apiClient.tripChecks(),
          apiClient.supportContent(),
        ]);

      setState({
        user: sessionResult.user,
        session: sessionResult.session,
        dashboard: dashboardResult.dashboard,
        selectedVehicle: dashboardResult.selected_vehicle,
        vehicles: vehicleResult.vehicles,
        alerts: alertResult.alerts,
        documents: documentResult.documents,
        zones: zoneResult.zones,
        tripChecks: tripCheckResult.trip_checks,
        notificationPreferences: meResult.notification_preferences,
        permissionStates: meResult.permission_states,
        pushDevices: meResult.push_devices ?? [],
        supportItems: supportResult.items,
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load DriveReady data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadStoredSession();
      await refreshAll();
    })();
  }, [refreshAll]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await apiClient.signIn({ email, password });
      await storeSession(result.session);
      await refreshAll();
    },
    [refreshAll],
  );

  const signUp = useCallback(
    async (payload: { first_name: string; last_name: string; email: string; password: string }) => {
      const result = await apiClient.signUp(payload);
      await storeSession(result.session);
      await refreshAll();
    },
    [refreshAll],
  );

  const requestReset = useCallback(async (email: string, redirectTo?: string) => {
    await apiClient.requestPasswordReset({
      email,
      redirect_to: redirectTo,
    });
  }, []);

  const confirmPasswordReset = useCallback(
    async (payload: { access_token: string; refresh_token?: string; expires_at: string; password: string }) => {
      const result = await apiClient.confirmPasswordReset({
        access_token: payload.access_token,
        password: payload.password,
      });

      const sessionToStore = resolvePasswordResetSession(result, payload);

      if (sessionToStore) {
        await storeSession(sessionToStore);
      }

      await refreshAll();
    },
    [refreshAll],
  );

  const signOut = useCallback(async () => {
    try {
      await apiClient.signOut();
    } finally {
      await clearStoredSession();
      setState({
        ...initialState,
      });
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    try {
      await apiClient.deleteAccount();
    } finally {
      await clearStoredSession();
      setState({
        ...initialState,
      });
    }
  }, []);

  const createVehicle = useCallback(
    async (payload: Record<string, unknown>) => {
      await apiClient.createVehicle(payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const updateVehicle = useCallback(
    async (vehicleId: string, payload: Record<string, unknown>) => {
      await apiClient.updateVehicle(vehicleId, payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const enrichVehicle = useCallback(
    async (vehicleId: string) => {
      const result = await apiClient.enrichVehicle(vehicleId);
      await refreshAll();
      return result;
    },
    [refreshAll],
  );

  const deleteVehicle = useCallback(
    async (vehicleId: string) => {
      await apiClient.deleteVehicle(vehicleId);
      await refreshAll();
    },
    [refreshAll],
  );

  const loadVehicleDetail = useCallback((vehicleId: string) => apiClient.vehicle(vehicleId), []);

  const updateAlert = useCallback(
    async (alertId: string, payload: Record<string, unknown>) => {
      await apiClient.updateAlert(alertId, payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const loadAlert = useCallback((alertId: string) => apiClient.alert(alertId), []);

  const createDocument = useCallback(
    async (payload: Record<string, unknown>, asset?: LocalUploadAsset) => {
      let enrichedPayload = payload;

      if (asset) {
        const uploadInit = await apiClient.initDocumentUpload();
        const uploaded = await apiClient.uploadDocumentBinary(uploadInit.upload.upload_id, asset);
        enrichedPayload = {
          ...payload,
          file_key: uploaded.upload.file_key,
          file_name: uploaded.upload.file_name,
          mime_type: uploaded.upload.mime_type,
        };
      }

      await apiClient.createDocument(enrichedPayload);
      await refreshAll();
    },
    [refreshAll],
  );

  const updateDocument = useCallback(
    async (documentId: string, payload: Record<string, unknown>) => {
      await apiClient.updateDocument(documentId, payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const deleteDocument = useCallback(
    async (documentId: string) => {
      await apiClient.deleteDocument(documentId);
      await refreshAll();
    },
    [refreshAll],
  );

  const loadDocument = useCallback((documentId: string) => apiClient.document(documentId), []);
  const shareDocument = useCallback((documentId: string) => apiClient.shareDocument(documentId), []);
  const uploadFileAsset = useCallback(async (asset: LocalUploadAsset) => {
    const uploadInit = await apiClient.initDocumentUpload();
    return apiClient.uploadDocumentBinary(uploadInit.upload.upload_id, asset);
  }, []);
  const replaceDocumentFile = useCallback(async (documentId: string, asset: LocalUploadAsset) => {
    const uploadInit = await apiClient.initDocumentReplacement(documentId);
    return apiClient.uploadDocumentBinary(uploadInit.upload.upload_id, asset);
  }, []);

  const runTripCheck = useCallback(
    async (payload: Record<string, unknown>) => {
      const result = await apiClient.runTripCheck(payload);
      await refreshAll();
      return result;
    },
    [refreshAll],
  );

  const searchLocationSuggestions = useCallback(async (query: string) => {
    const result = await apiClient.searchLocationSuggestions(query);
    return result.suggestions;
  }, []);

  const searchRefuelOptions = useCallback((payload: Record<string, unknown>) => apiClient.searchRefuelOptions(payload), []);

  const createZone = useCallback(
    async (payload: Record<string, unknown>) => {
      await apiClient.createZone(payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const updateZone = useCallback(
    async (zoneId: string, payload: Record<string, unknown>) => {
      await apiClient.updateZone(zoneId, payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const deleteZone = useCallback(
    async (zoneId: string) => {
      await apiClient.deleteZone(zoneId);
      await refreshAll();
    },
    [refreshAll],
  );

  const updateProfile = useCallback(
    async (payload: Record<string, unknown>) => {
      const result = await apiClient.updateProfile(payload);
      await refreshAll();
      return result;
    },
    [refreshAll],
  );

  const updateNotificationPreferences = useCallback(
    async (payload: Record<string, unknown>) => {
      await apiClient.updateNotificationPreferences(payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const updatePermissionStates = useCallback(
    async (payload: Record<string, unknown>) => {
      await apiClient.updatePermissionStates(payload);
      await refreshAll();
    },
    [refreshAll],
  );

  const registerPushDevice = useCallback(
    async (payload: { label?: string; platform: PushDeviceRecord['platform']; token: string }) => {
      const result = await apiClient.registerPushDevice(payload);
      await refreshAll();
      return result.device;
    },
    [refreshAll],
  );

  const deletePushDevice = useCallback(
    async (deviceId: string) => {
      await apiClient.deletePushDevice(deviceId);
      await refreshAll();
    },
    [refreshAll],
  );

  const clearPushDevices = useCallback(
    async (deviceIds: string[]) => {
      if (deviceIds.length === 0) {
        return;
      }

      await Promise.all(deviceIds.map((deviceId) => apiClient.deletePushDevice(deviceId)));
      await refreshAll();
    },
    [refreshAll],
  );

  const exportRequest = useCallback(async () => {
    return apiClient.exportRequest();
  }, []);

  return {
    ...state,
    isLoading,
    error,
    refreshAll,
    signIn,
    signUp,
    requestReset,
    confirmPasswordReset,
    signOut,
    deleteAccount,
    createVehicle,
    updateVehicle,
    enrichVehicle,
    deleteVehicle,
    loadVehicleDetail,
    updateAlert,
    loadAlert,
    createDocument,
    updateDocument,
    deleteDocument,
    loadDocument,
    shareDocument,
    uploadFileAsset,
    replaceDocumentFile,
    runTripCheck,
    searchLocationSuggestions,
    searchRefuelOptions,
    createZone,
    updateZone,
    deleteZone,
    updateProfile,
    updateNotificationPreferences,
    updatePermissionStates,
    registerPushDevice,
    deletePushDevice,
    clearPushDevices,
    exportRequest,
  };
}

export type DriveReadyModel = ReturnType<typeof useDriveReadyModel>;
export type { VehicleDetailResponse };
