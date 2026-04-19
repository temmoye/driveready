import { evaluateVehicleAgainstZone, mergeZoneWithPolicy } from './compliance.js';
import { deriveDocumentStatus, diffInDays } from './status.js';
import type {
  AlertRecord,
  AppData,
  NotificationPreferences,
  PermissionStates,
  ScheduledReminder,
} from './types.js';

const DEFAULT_LEAD_DAYS = {
  document: 30,
  insurance: 30,
  mot: 30,
  tax: 21,
  zone: 1,
} satisfies Record<AlertRecord['alert_type'], number>;
const MAX_REMINDER_FAILURE_RETRIES = 3;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateWithOffset(days: number, now = new Date()) {
  const target = new Date(now);
  target.setDate(target.getDate() + days);
  return isoDate(target);
}

function reminderCategoryEnabled(alertType: AlertRecord['alert_type'], preferences: NotificationPreferences) {
  if (alertType === 'mot') {
    return preferences.mot_enabled;
  }

  if (alertType === 'tax') {
    return preferences.tax_enabled;
  }

  if (alertType === 'insurance') {
    return preferences.insurance_enabled;
  }

  if (alertType === 'document') {
    return preferences.docs_enabled;
  }

  return preferences.zones_enabled;
}

function reminderScheduleForAlert(alert: AlertRecord) {
  const scheduledAt = new Date(`${alert.due_at}T09:00:00.000Z`);
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() - alert.lead_days);
  return scheduledAt.toISOString();
}

function sameAlertWindow(existing: AlertRecord | undefined, dueAt: string) {
  return existing?.due_at === dueAt;
}

function mergeAlertState(base: Omit<AlertRecord, 'lead_days' | 'muted' | 'handled'>, existing?: AlertRecord): AlertRecord {
  const leadDays = existing?.lead_days ?? DEFAULT_LEAD_DAYS[base.alert_type];
  const preserveState = sameAlertWindow(existing, base.due_at);

  return {
    ...base,
    lead_days: leadDays,
    muted: preserveState ? existing?.muted ?? false : false,
    handled: preserveState ? existing?.handled ?? false : false,
  };
}

function shouldSurfaceAlert(dueAt: string, leadDays: number, now = new Date()) {
  return diffInDays(dueAt, now) <= leadDays;
}

function buildDateAlert(input: {
  alertType: 'mot' | 'tax' | 'insurance';
  dueAt: string;
  title: string;
  detail: string;
  id: string;
  subtitle: string;
  vehicleId: string;
}, existing?: AlertRecord, now = new Date()) {
  const leadDays = existing?.lead_days ?? DEFAULT_LEAD_DAYS[input.alertType];

  if (!shouldSurfaceAlert(input.dueAt, leadDays, now)) {
    return null;
  }

  return mergeAlertState(
    {
      id: input.id,
      vehicle_id: input.vehicleId,
      alert_type: input.alertType,
      title: input.title,
      subtitle: input.subtitle,
      detail: input.detail,
      due_at: input.dueAt,
    },
    existing,
  );
}

function buildScheduledReminders(
  state: AppData,
  alerts: AlertRecord[],
  notificationPreferences: NotificationPreferences,
  permissionStates: PermissionStates,
) {
  return alerts.map((alert) => {
    let status: ScheduledReminder['status'] = 'scheduled';
    let reason: string | undefined;
    const scheduledFor = reminderScheduleForAlert(alert);
    const matchingDispatches = state.reminder_dispatches.filter(
      (entry) => entry.reminder_id === `reminder:${alert.id}` && entry.scheduled_for === scheduledFor,
    );
    const dispatch = matchingDispatches[matchingDispatches.length - 1];
    const failedAttempts = matchingDispatches.filter((entry) => entry.status === 'failed').length;

    if (dispatch?.status === 'sent') {
      status = 'delivered';
      reason = dispatch.provider;
    } else if (dispatch?.status === 'failed' && failedAttempts >= MAX_REMINDER_FAILURE_RETRIES) {
      status = 'failed';
      reason = dispatch.error ?? 'delivery_failed';
    } else if (dispatch?.status === 'failed') {
      status = 'scheduled';
      reason = `retry_pending_${failedAttempts}`;
    } else if (alert.handled) {
      status = 'suppressed';
      reason = 'alert_handled';
    } else if (alert.muted) {
      status = 'suppressed';
      reason = 'alert_muted';
    } else if (permissionStates.notifications_state !== 'granted') {
      status = 'suppressed';
      reason = 'notifications_permission_not_granted';
    } else if (!reminderCategoryEnabled(alert.alert_type, notificationPreferences)) {
      status = 'suppressed';
      reason = 'reminder_category_disabled';
    }

    return {
      id: `reminder:${alert.id}`,
      alert_id: alert.id,
      alert_title: alert.title,
      scheduled_for: scheduledFor,
      delivery_channel: 'push',
      status,
      ...(reason ? { reason } : {}),
      freshness_at: new Date().toISOString(),
      source_name: 'derived-reminder-scheduler',
    } satisfies ScheduledReminder;
  });
}

function generateAlerts(state: AppData, now = new Date()) {
  const existingById = new Map(state.alerts.map((alert) => [alert.id, alert]));
  const alerts: AlertRecord[] = [];

  state.vehicles.forEach((vehicle) => {
    const motAlert = buildDateAlert(
      {
        alertType: 'mot',
        dueAt: vehicle.mot_due_at,
        title: diffInDays(vehicle.mot_due_at, now) < 0 ? 'MOT overdue' : 'MOT due soon',
        detail:
          diffInDays(vehicle.mot_due_at, now) < 0
            ? 'This vehicle needs an MOT before it should be used again.'
            : 'Book an MOT before the due date to keep the vehicle road legal.',
        id: `alert:vehicle:${vehicle.id}:mot`,
        subtitle: vehicle.nickname,
        vehicleId: vehicle.id,
      },
      existingById.get(`alert:vehicle:${vehicle.id}:mot`),
      now,
    );

    if (motAlert) {
      alerts.push(motAlert);
    }

    const taxAlert = buildDateAlert(
      {
        alertType: 'tax',
        dueAt: vehicle.tax_due_at,
        title: diffInDays(vehicle.tax_due_at, now) < 0 ? 'Tax overdue' : 'Tax renews soon',
        detail:
          diffInDays(vehicle.tax_due_at, now) < 0
            ? 'Vehicle tax is overdue. Renew before driving again.'
            : 'Vehicle tax is due soon. Renew before the due date.',
        id: `alert:vehicle:${vehicle.id}:tax`,
        subtitle: vehicle.nickname,
        vehicleId: vehicle.id,
      },
      existingById.get(`alert:vehicle:${vehicle.id}:tax`),
      now,
    );

    if (taxAlert) {
      alerts.push(taxAlert);
    }

    const insuranceAlert = buildDateAlert(
      {
        alertType: 'insurance',
        dueAt: vehicle.insurance_due_at,
        title: diffInDays(vehicle.insurance_due_at, now) < 0 ? 'Insurance expired' : 'Insurance renews soon',
        detail:
          diffInDays(vehicle.insurance_due_at, now) < 0
            ? 'Insurance has expired. Renew before this vehicle is driven.'
            : 'Insurance is due soon. Review cover and renew before the due date.',
        id: `alert:vehicle:${vehicle.id}:insurance`,
        subtitle: vehicle.nickname,
        vehicleId: vehicle.id,
      },
      existingById.get(`alert:vehicle:${vehicle.id}:insurance`),
      now,
    );

    if (insuranceAlert) {
      alerts.push(insuranceAlert);
    }
  });

  state.documents.forEach((document) => {
    const existing = existingById.get(`alert:document:${document.id}`);
    const leadDays = existing?.lead_days ?? DEFAULT_LEAD_DAYS.document;

    if (!shouldSurfaceAlert(document.expires_at, leadDays, now) && deriveDocumentStatus(document, now) === 'current') {
      return;
    }

    alerts.push(
      mergeAlertState(
        {
          id: `alert:document:${document.id}`,
          vehicle_id: document.vehicle_id,
          document_id: document.id,
          alert_type: 'document',
          title: deriveDocumentStatus(document, now) === 'expired' ? `${document.title} expired` : `${document.title} needs review`,
          subtitle:
            state.vehicles.find((vehicle) => vehicle.id === document.vehicle_id)?.nickname ??
            document.document_type.toUpperCase(),
          detail:
            deriveDocumentStatus(document, now) === 'expired'
              ? 'Replace this document with a current copy.'
              : 'Review the document details and replace it with the latest version if needed.',
          due_at: document.expires_at,
        },
        existing,
      ),
    );
  });

  state.zones
    .filter((zone) => zone.monitored)
    .forEach((zone) => {
      state.vehicles.forEach((vehicle) => {
        const evaluation = evaluateVehicleAgainstZone(vehicle, zone);

        if (evaluation.compliance_status === 'compliant') {
          return;
        }

        const alertId = `alert:zone:${zone.id}:${vehicle.id}`;
        const existing = existingById.get(alertId);
        const zoneWithPolicy = mergeZoneWithPolicy(zone);

        alerts.push(
          mergeAlertState(
            {
              id: alertId,
              vehicle_id: vehicle.id,
              zone_id: zone.id,
              alert_type: 'zone',
              title:
                evaluation.compliance_status === 'charge_risk'
                  ? `${zoneWithPolicy.name} charge risk`
                  : `${zoneWithPolicy.name} needs a compliance check`,
              subtitle: vehicle.nickname,
              detail: evaluation.reason,
              due_at: dateWithOffset(evaluation.compliance_status === 'charge_risk' ? 2 : 4, now),
            },
            existing,
          ),
        );
      });
    });

  alerts.sort((left, right) => left.due_at.localeCompare(right.due_at));
  return alerts;
}

export function syncDerivedState(state: AppData, now = new Date()) {
  const nextAlerts = generateAlerts(state, now);
  const nextReminders = buildScheduledReminders(
    state,
    nextAlerts,
    state.notification_preferences,
    state.permission_states,
  );

  const alertsChanged = JSON.stringify(nextAlerts) !== JSON.stringify(state.alerts);
  const remindersChanged = JSON.stringify(nextReminders) !== JSON.stringify(state.scheduled_reminders);

  if (alertsChanged) {
    state.alerts = nextAlerts;
  }

  if (remindersChanged) {
    state.scheduled_reminders = nextReminders;
  }

  return alertsChanged || remindersChanged;
}

export function summarizeReminderSchedule(state: AppData) {
  const scheduled = state.scheduled_reminders.filter((entry) => entry.status === 'scheduled');
  const suppressed = state.scheduled_reminders.filter((entry) => entry.status === 'suppressed');
  const delivered = state.scheduled_reminders.filter((entry) => entry.status === 'delivered');
  const failed = state.scheduled_reminders.filter((entry) => entry.status === 'failed');
  const nextScheduled = scheduled.sort((left, right) => left.scheduled_for.localeCompare(right.scheduled_for))[0];

  return {
    nextScheduled,
    scheduledCount: scheduled.length,
    suppressedCount: suppressed.length,
    deliveredCount: delivered.length,
    failedCount: failed.length,
  };
}
