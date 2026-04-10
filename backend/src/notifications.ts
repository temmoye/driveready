import type {
  AppData,
  PushDeviceRecord,
  ReminderDispatchRecord,
  ScheduledReminder,
} from './types.js';

type NotificationProvider = 'log' | 'expo';

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveProvider(): NotificationProvider {
  const configured = trimValue(process.env.DRIVEREADY_NOTIFICATION_PROVIDER).toLowerCase();

  if (configured === 'expo') {
    return 'expo';
  }

  return 'log';
}

function reminderMessage(reminder: ScheduledReminder) {
  return {
    body: reminder.alert_title,
    title: 'DriveReady reminder',
  };
}

async function sendWithExpo(devices: PushDeviceRecord[], reminder: ScheduledReminder) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(
      devices.map((device) => ({
        to: device.token,
        sound: 'default',
        title: reminderMessage(reminder).title,
        body: reminderMessage(reminder).body,
      })),
    ),
  });

  if (!response.ok) {
    throw new Error(`Expo push send failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string; status?: string; message?: string }>;
  };
  const first = payload.data?.[0];

  if (!first || first.status !== 'ok') {
    throw new Error(first?.message ?? 'Expo push send failed.');
  }

  return first.id;
}

async function dispatchReminder(devices: PushDeviceRecord[], reminder: ScheduledReminder) {
  const provider = resolveProvider();

  if (provider === 'expo') {
    const providerMessageId = await sendWithExpo(devices, reminder);
    return {
      provider,
      providerMessageId,
    };
  }

  return {
    provider,
    providerMessageId: `log-${Date.now()}`,
  };
}

export function upsertPushDevice(state: AppData, input: {
  label?: string;
  platform: PushDeviceRecord['platform'];
  token: string;
}) {
  const index = state.push_devices.findIndex((device) => device.token === input.token);
  const timestamp = new Date().toISOString();

  if (index >= 0) {
    state.push_devices[index] = {
      ...state.push_devices[index],
      label: input.label,
      platform: input.platform,
      last_seen_at: timestamp,
    };

    return state.push_devices[index];
  }

  const device: PushDeviceRecord = {
    id: `push-device-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    token: input.token,
    platform: input.platform,
    label: input.label,
    created_at: timestamp,
    last_seen_at: timestamp,
  };
  state.push_devices.unshift(device);
  return device;
}

export function removePushDevice(state: AppData, deviceId: string) {
  const index = state.push_devices.findIndex((device) => device.id === deviceId);

  if (index === -1) {
    return null;
  }

  const [removed] = state.push_devices.splice(index, 1);
  return removed;
}

export async function dispatchDueReminders(state: AppData, now = new Date()) {
  const dueReminders = state.scheduled_reminders.filter((reminder) =>
    reminder.status === 'scheduled' && Date.parse(reminder.scheduled_for) <= now.getTime(),
  );
  const sent: ReminderDispatchRecord[] = [];
  const failed: ReminderDispatchRecord[] = [];
  const skipped: ScheduledReminder[] = [];

  for (const reminder of dueReminders) {
    if (state.push_devices.length === 0) {
      failed.push({
        id: `dispatch-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        reminder_id: reminder.id,
        scheduled_for: reminder.scheduled_for,
        provider: resolveProvider(),
        status: 'failed',
        error: 'no_registered_push_devices',
      });
      continue;
    }

    try {
      const result = await dispatchReminder(state.push_devices, reminder);
      sent.push({
        id: `dispatch-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        reminder_id: reminder.id,
        scheduled_for: reminder.scheduled_for,
        provider: result.provider,
        status: 'sent',
        delivered_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId,
      });
    } catch (error) {
      failed.push({
        id: `dispatch-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        reminder_id: reminder.id,
        scheduled_for: reminder.scheduled_for,
        provider: resolveProvider(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'unknown_notification_error',
      });
    }
  }

  if (sent.length > 0 || failed.length > 0) {
    state.reminder_dispatches.push(...sent, ...failed);
  }

  return {
    sent_count: sent.length,
    failed_count: failed.length,
    skipped_count: skipped.length,
    sent,
    failed,
  };
}

export function getNotificationTargetLabel() {
  const provider = resolveProvider();

  if (provider === 'expo') {
    return 'Expo push gateway';
  }

  return 'Log-only notification provider';
}
