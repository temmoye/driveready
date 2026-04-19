import { createDocumentShareUrl } from './uploads.js';
import type {
  AlertRecord,
  AppData,
  DataExportRecord,
  DocumentRecord,
  NotificationPreferences,
  PermissionStates,
  PushDeviceRecord,
  ReminderDispatchRecord,
  SavedZone,
  ScheduledReminder,
  TripCheckRecord,
  UserProfile,
  VehicleRecord,
  VehicleServiceHistoryEntry,
} from './types.js';

export const normalizedTables = {
  alert: 'driveready_alert',
  dataExport: 'driveready_data_export',
  document: 'driveready_document',
  profile: 'driveready_profile',
  pushDevice: 'driveready_push_device',
  reminderDispatch: 'driveready_reminder_dispatch',
  scheduledReminder: 'driveready_scheduled_reminder',
  serviceHistory: 'driveready_service_history',
  tripCheck: 'driveready_trip_check',
  vehicle: 'driveready_vehicle',
  zone: 'driveready_zone',
} as const;

export const normalizedUserTableNames = [
  normalizedTables.profile,
  normalizedTables.vehicle,
  normalizedTables.serviceHistory,
  normalizedTables.document,
  normalizedTables.alert,
  normalizedTables.zone,
  normalizedTables.tripCheck,
  normalizedTables.scheduledReminder,
  normalizedTables.pushDevice,
  normalizedTables.dataExport,
  normalizedTables.reminderDispatch,
] as const;

type WithUserId<T> = T & { user_id: string };

interface NormalizedProfileRow {
  address_line: string;
  email: string;
  first_name: string;
  last_name: string;
  notification_preferences?: Partial<NotificationPreferences> | null;
  permission_states?: Partial<PermissionStates> | null;
  phone: string;
  selected_vehicle_id?: string | null;
  user_id: string;
}

export interface NormalizedReadModel {
  alerts: Array<WithUserId<AlertRecord>>;
  dataExports: Array<WithUserId<DataExportRecord>>;
  documents: Array<WithUserId<DocumentRecord>>;
  profile: NormalizedProfileRow | null;
  pushDevices: Array<WithUserId<PushDeviceRecord>>;
  reminderDispatches: Array<WithUserId<ReminderDispatchRecord>>;
  scheduledReminders: Array<WithUserId<ScheduledReminder>>;
  serviceHistory: Array<WithUserId<VehicleServiceHistoryEntry>>;
  tripChecks: Array<WithUserId<TripCheckRecord>>;
  vehicles: Array<WithUserId<VehicleRecord>>;
  zones: Array<WithUserId<SavedZone>>;
}

export interface NormalizedWriteModel {
  profile: NormalizedProfileRow;
  repeatedTables: Array<{
    rows: Array<Record<string, unknown>>;
    table: (typeof normalizedUserTableNames)[number];
  }>;
}

function sortDescendingByTimestamp<T extends { id: string }>(items: T[], getTimestamp: (item: T) => string | undefined) {
  return [...items].sort((left, right) => {
    const leftTimestamp = getTimestamp(left) ?? '';
    const rightTimestamp = getTimestamp(right) ?? '';

    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp.localeCompare(leftTimestamp);
    }

    return right.id.localeCompare(left.id);
  });
}

function stripUserId<T extends { user_id: string }>(items: T[]) {
  return items.map(({ user_id: _userId, ...item }) => item);
}

async function refreshExportDownloadUrls(items: Array<WithUserId<DataExportRecord>>) {
  return Promise.all(items.map(async (item) => {
    try {
      return {
        ...item,
        download_url: await createDocumentShareUrl(item.file_key),
      };
    } catch {
      return item;
    }
  }));
}

export function buildNormalizedWriteModel(userId: string, state: AppData): NormalizedWriteModel {
  return {
    profile: {
      user_id: userId,
      first_name: state.user.first_name,
      last_name: state.user.last_name,
      email: state.user.email,
      phone: state.user.phone,
      address_line: state.user.address_line,
      notification_preferences: state.notification_preferences,
      permission_states: state.permission_states,
      selected_vehicle_id: state.selected_vehicle_id || null,
    },
    repeatedTables: [
      {
        table: normalizedTables.vehicle,
        rows: state.vehicles.map((vehicle) => ({
          user_id: userId,
          ...vehicle,
        })),
      },
      {
        table: normalizedTables.serviceHistory,
        rows: state.service_history.map((entry) => ({
          user_id: userId,
          ...entry,
        })),
      },
      {
        table: normalizedTables.document,
        rows: state.documents.map((document) => ({
          user_id: userId,
          ...document,
        })),
      },
      {
        table: normalizedTables.alert,
        rows: state.alerts.map((alert) => ({
          user_id: userId,
          ...alert,
        })),
      },
      {
        table: normalizedTables.zone,
        rows: state.zones.map((zone) => ({
          user_id: userId,
          ...zone,
        })),
      },
      {
        table: normalizedTables.tripCheck,
        rows: state.trip_checks.map((tripCheck) => ({
          user_id: userId,
          ...tripCheck,
        })),
      },
      {
        table: normalizedTables.scheduledReminder,
        rows: state.scheduled_reminders.map((reminder) => ({
          user_id: userId,
          ...reminder,
        })),
      },
      {
        table: normalizedTables.pushDevice,
        rows: state.push_devices.map((device) => ({
          user_id: userId,
          ...device,
        })),
      },
      {
        table: normalizedTables.dataExport,
        rows: state.data_exports.map((entry) => ({
          user_id: userId,
          ...entry,
        })),
      },
      {
        table: normalizedTables.reminderDispatch,
        rows: state.reminder_dispatches.map((entry) => ({
          user_id: userId,
          ...entry,
        })),
      },
    ],
  };
}

export async function applyNormalizedReadModel(target: AppData, model: NormalizedReadModel) {
  const profile = model.profile;
  const refreshedExports = await refreshExportDownloadUrls(model.dataExports);
  const nextUser: UserProfile = {
    id: target.user.id || profile?.user_id || '',
    first_name: profile?.first_name ?? target.user.first_name,
    last_name: profile?.last_name ?? target.user.last_name,
    email: profile?.email ?? target.user.email,
    phone: profile?.phone ?? target.user.phone,
    address_line: profile?.address_line ?? target.user.address_line,
  };

  target.user = nextUser;
  target.notification_preferences = {
    ...target.notification_preferences,
    ...(profile?.notification_preferences ?? {}),
  };
  target.permission_states = {
    ...target.permission_states,
    ...(profile?.permission_states ?? {}),
  };
  target.selected_vehicle_id = profile?.selected_vehicle_id ?? '';
  target.vehicles = sortDescendingByTimestamp(stripUserId(model.vehicles), (vehicle) => vehicle.id);
  target.service_history = [...stripUserId(model.serviceHistory)].sort(
    (left, right) => right.event_date.localeCompare(left.event_date) || right.id.localeCompare(left.id),
  );
  target.documents = sortDescendingByTimestamp(stripUserId(model.documents), (document) => document.uploaded_at);
  target.alerts = [...stripUserId(model.alerts)].sort(
    (left, right) => left.due_at.localeCompare(right.due_at) || left.id.localeCompare(right.id),
  );
  target.zones = sortDescendingByTimestamp(stripUserId(model.zones), (zone) => zone.freshness_at);
  target.trip_checks = sortDescendingByTimestamp(stripUserId(model.tripChecks), (tripCheck) => tripCheck.freshness_at);
  target.scheduled_reminders = [...stripUserId(model.scheduledReminders)].sort(
    (left, right) => left.scheduled_for.localeCompare(right.scheduled_for) || left.id.localeCompare(right.id),
  );
  target.push_devices = sortDescendingByTimestamp(stripUserId(model.pushDevices), (device) => device.created_at);
  target.data_exports = sortDescendingByTimestamp(stripUserId(refreshedExports), (item) => item.created_at);
  target.reminder_dispatches = sortDescendingByTimestamp(stripUserId(model.reminderDispatches), (item) => item.delivered_at ?? item.scheduled_for);
}
