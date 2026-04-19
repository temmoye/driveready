import { createEmptyUserAppData } from './data.js';
import { syncDerivedState } from './derived-state.js';
import { DvlaVesError, enrichVehicleWithDvlaVes, usesDvlaVes } from './dvla-ves.js';
import { DvsaMotError, enrichVehicleWithDvsaMot, hasDvsaMotSetup } from './dvsa-mot.js';
import { recordJobMetric } from './metrics.js';
import { dispatchDueReminders } from './notifications.js';
import {
  hydrateUserAppData,
  listStoredUserIds,
  persistAppData,
  persistUserAppData,
  supportsPerUserAppData,
} from './persistence.js';
import { normalizedProjectionEnabled, projectUserAppData } from './projection.js';
import type { AppData, UserProfile, VehicleRecord } from './types.js';

interface JobTarget {
  state: AppData;
  userId?: string;
}

interface JobUserSummary {
  failed_count: number;
  refreshed_count?: number;
  sent_count?: number;
  skipped_count?: number;
  due_count?: number;
  user_id: string;
}

export interface ReminderJobResult {
  due_count: number;
  failed_count: number;
  sent_count: number;
  skipped_count: number;
  user_count: number;
  users: JobUserSummary[];
}

export interface ProviderRefreshResult {
  failed_count: number;
  refreshed_count: number;
  user_count: number;
  users: JobUserSummary[];
}

interface BackgroundJobStatus {
  provider_refresh: {
    enabled: boolean;
    interval_hours: number | null;
  };
  reminders: {
    enabled: boolean;
    interval_minutes: number | null;
  };
}

const backgroundIntervals: Array<NodeJS.Timeout> = [];
let backgroundJobsStarted = false;

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveBoolean(value?: string) {
  return trimValue(value).toLowerCase() === 'true';
}

function resolvePositiveNumber(value: string | undefined, fallback: number) {
  const numeric = Number(trimValue(value));

  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  return fallback;
}

function emptyUser(userId: string): UserProfile {
  return {
    id: userId,
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address_line: '',
  };
}

function userLabel(userId?: string) {
  return userId ?? 'local';
}

async function loadJobTargets(localState: AppData) {
  if (!supportsPerUserAppData()) {
    syncDerivedState(localState);
    return [{ state: localState, userId: undefined }] satisfies JobTarget[];
  }

  const userIds = await listStoredUserIds();
  return Promise.all(userIds.map(async (userId) => {
    const state = createEmptyUserAppData(emptyUser(userId));
    await hydrateUserAppData(userId, state);
    syncDerivedState(state);
    return {
      state,
      userId,
    } satisfies JobTarget;
  }));
}

async function persistTarget(target: JobTarget) {
  syncDerivedState(target.state);

  if (target.userId) {
    await persistUserAppData(target.userId, target.state);

    if (normalizedProjectionEnabled()) {
      await projectUserAppData(target.userId, target.state);
    }

    return;
  }

  await persistAppData(target.state);
}

function dueReminderCount(state: AppData, now = new Date()) {
  return state.scheduled_reminders.filter((reminder) =>
    reminder.status === 'scheduled' && Date.parse(reminder.scheduled_for) <= now.getTime(),
  ).length;
}

async function refreshVehicleRecord(vehicle: VehicleRecord, state: AppData) {
  let nextVehicle = vehicle;
  let refreshed = false;

  if (usesDvlaVes()) {
    const dvla = await enrichVehicleWithDvlaVes(nextVehicle);
    nextVehicle = dvla.vehicle;
    refreshed = true;
  }

  if (hasDvsaMotSetup()) {
    const dvsa = await enrichVehicleWithDvsaMot(nextVehicle);
    nextVehicle = dvsa.vehicle;
    state.service_history = state.service_history.filter(
      (entry) => !(entry.vehicle_id === dvsa.vehicle.id && entry.id.startsWith(`mot-history-${dvsa.vehicle.id}-`)),
    );
    state.service_history.push(...dvsa.motHistoryEntries);
    state.service_history.sort((left, right) => right.event_date.localeCompare(left.event_date));
    refreshed = true;
  }

  return {
    refreshed,
    vehicle: nextVehicle,
  };
}

export async function runReminderDispatchJob(input: {
  dryRun?: boolean;
  localState: AppData;
}): Promise<ReminderJobResult> {
  const now = new Date();
  const targets = await loadJobTargets(input.localState);
  let dueCount = 0;
  let failedCount = 0;
  let sentCount = 0;
  let skippedCount = 0;
  const users: JobUserSummary[] = [];

  for (const target of targets) {
    const userDueCount = dueReminderCount(target.state, now);
    dueCount += userDueCount;

    if (input.dryRun) {
      users.push({
        user_id: userLabel(target.userId),
        due_count: userDueCount,
        failed_count: 0,
        sent_count: 0,
        skipped_count: 0,
      });
      continue;
    }

    const result = await dispatchDueReminders(target.state, now);
    await persistTarget(target);
    failedCount += result.failed_count;
    sentCount += result.sent_count;
    skippedCount += result.skipped_count;
    users.push({
      user_id: userLabel(target.userId),
      due_count: userDueCount,
      failed_count: result.failed_count,
      sent_count: result.sent_count,
      skipped_count: result.skipped_count,
    });
  }

  if (!input.dryRun) {
    recordJobMetric('run_reminders');
    recordJobMetric('reminders_sent', sentCount);
    recordJobMetric('reminders_failed', failedCount);
  }

  return {
    due_count: dueCount,
    failed_count: failedCount,
    sent_count: sentCount,
    skipped_count: skippedCount,
    user_count: targets.length,
    users,
  };
}

export async function runVehicleRefreshJob(input: {
  dryRun?: boolean;
  localState: AppData;
}): Promise<ProviderRefreshResult> {
  const targets = await loadJobTargets(input.localState);
  let failedCount = 0;
  let refreshedCount = 0;
  const users: JobUserSummary[] = [];

  for (const target of targets) {
    let userFailedCount = 0;
    let userRefreshedCount = 0;

    if (!input.dryRun) {
      for (let index = 0; index < target.state.vehicles.length; index += 1) {
        try {
          const refreshed = await refreshVehicleRecord(target.state.vehicles[index], target.state);

          if (refreshed.refreshed) {
            target.state.vehicles[index] = refreshed.vehicle;
            userRefreshedCount += 1;
          }
        } catch (error) {
          if (error instanceof DvlaVesError || error instanceof DvsaMotError) {
            userFailedCount += 1;
            continue;
          }

          throw error;
        }
      }

      if (userRefreshedCount > 0) {
        await persistTarget(target);
      }
    } else {
      userRefreshedCount = target.state.vehicles.length;
    }

    failedCount += userFailedCount;
    refreshedCount += userRefreshedCount;
    users.push({
      user_id: userLabel(target.userId),
      failed_count: userFailedCount,
      refreshed_count: userRefreshedCount,
    });
  }

  if (!input.dryRun) {
    recordJobMetric('refresh_vehicle_data');
    recordJobMetric('vehicle_records_refreshed', refreshedCount);
    recordJobMetric('vehicle_refresh_failures', failedCount);
  }

  return {
    failed_count: failedCount,
    refreshed_count: refreshedCount,
    user_count: targets.length,
    users,
  };
}

function reminderRunnerConfig() {
  const enabled = resolveBoolean(process.env.DRIVEREADY_REMINDER_RUNNER_ENABLED);

  return {
    enabled,
    intervalMinutes: enabled ? resolvePositiveNumber(process.env.DRIVEREADY_REMINDER_RUNNER_INTERVAL_MINUTES, 15) : null,
  };
}

function providerRefreshRunnerConfig() {
  const enabled = resolveBoolean(process.env.DRIVEREADY_PROVIDER_REFRESH_RUNNER_ENABLED);

  return {
    enabled,
    intervalHours: enabled ? resolvePositiveNumber(process.env.DRIVEREADY_PROVIDER_REFRESH_RUNNER_INTERVAL_HOURS, 24) : null,
  };
}

export function getBackgroundJobStatus(): BackgroundJobStatus {
  const reminder = reminderRunnerConfig();
  const providerRefresh = providerRefreshRunnerConfig();

  return {
    provider_refresh: {
      enabled: providerRefresh.enabled,
      interval_hours: providerRefresh.intervalHours,
    },
    reminders: {
      enabled: reminder.enabled,
      interval_minutes: reminder.intervalMinutes,
    },
  };
}

export function startBackgroundJobs(localState: AppData) {
  if (backgroundJobsStarted) {
    return;
  }

  backgroundJobsStarted = true;
  const reminder = reminderRunnerConfig();
  const providerRefresh = providerRefreshRunnerConfig();

  if (reminder.enabled && reminder.intervalMinutes) {
    backgroundIntervals.push(setInterval(() => {
      void runReminderDispatchJob({ localState }).catch((error) => {
        console.error('DriveReady reminder runner failed', error);
      });
    }, reminder.intervalMinutes * 60 * 1000));
  }

  if (providerRefresh.enabled && providerRefresh.intervalHours) {
    backgroundIntervals.push(setInterval(() => {
      void runVehicleRefreshJob({ localState }).catch((error) => {
        console.error('DriveReady vehicle refresh runner failed', error);
      });
    }, providerRefresh.intervalHours * 60 * 60 * 1000));
  }
}
