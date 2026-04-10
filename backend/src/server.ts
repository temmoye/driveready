import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import type { NextFunction, Request, Response } from 'express';

import {
  confirmSupabasePasswordReset,
  deleteSupabaseAuthUser,
  getSupabaseUserForToken,
  refreshSupabaseSession,
  requestSupabasePasswordReset,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  updateSupabaseAuthProfile,
  usesSupabaseAuth,
} from './auth.js';
import { writeAuditEntry } from './audit.js';
import { syncDerivedState, summarizeReminderSchedule } from './derived-state.js';
import { appData, createEmptyUserAppData } from './data.js';
import { DvlaVesError, enrichVehicleWithDvlaVes, getDvlaVesTargetLabel, usesDvlaVes } from './dvla-ves.js';
import { DvsaMotError, enrichVehicleWithDvsaMot, getDvsaMotTargetLabel, hasDvsaMotSetup } from './dvsa-mot.js';
import { generateUserDataExport } from './exports.js';
import { getBackgroundJobStatus, runReminderDispatchJob, runVehicleRefreshJob, startBackgroundJobs } from './jobs.js';
import { createLocalAuthState, defaultLocalAuthState, verifyLocalPassword } from './local-auth.js';
import { getLocationSearchTargetLabel, searchLocationSuggestions } from './location-search.js';
import { metricsSnapshot, recordJobMetric, recordProviderMetric, recordRequestMetric } from './metrics.js';
import { getNotificationTargetLabel, removePushDevice, upsertPushDevice } from './notifications.js';
import {
  deleteUserAppData,
  getStorageTargetLabel,
  hydrateAppData,
  hydrateUserAppData,
  persistAppData,
  persistUserAppData,
  supportsPerUserAppData,
  usesNormalizedSupabaseStorage,
} from './persistence.js';
import { deleteProjectedUserData, normalizedProjectionEnabled, projectUserAppData } from './projection.js';
import { getRefuelTargetLabel, searchRefuelOptions } from './refuel.js';
import { buildDashboard, linkVehicleZones, summarizeAlert, summarizeDocument, summarizeVehicle } from './status.js';
import { buildTripCheck } from './trip-check.js';
import type {
  AppData,
  DocumentRecord,
  SavedZone,
  VehicleRecord,
} from './types.js';
import {
  createDocumentShareUrl,
  deleteStoredDocument,
  getUploadTargetLabel,
  resolveLocalDownloadFile,
  storeUploadedDocument,
  uploadMiddleware,
  usesSupabaseUploads,
} from './uploads.js';
import {
  alertPatchSchema,
  documentSchema,
  jobRunSchema,
  notificationPreferencesSchema,
  parseBody,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  permissionStatesSchema,
  profilePatchSchema,
  pushDeviceSchema,
  querySchema,
  refreshSessionSchema,
  refuelSearchSchema,
  signInSchema,
  signUpSchema,
  tripCheckSchema,
  documentPatchSchema,
  vehiclePatchSchema,
  vehicleSchema,
  zonePatchSchema,
  zoneSchema,
} from './validation.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const publicPaths = new Set([
  '/health',
  '/metrics',
  '/files/download',
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/sign-out',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  '/auth/refresh',
  '/auth/session',
]);
const publicPathPrefixes = [
  '/internal/jobs/',
];
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const uploadSessions = new Map<string, { createdAt: string; replacesDocumentId?: string }>();

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveCorsOrigins() {
  const configured = trimValue(process.env.DRIVEREADY_CORS_ORIGINS);

  if (!configured) {
    return [];
  }

  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveRedirectAllowlist() {
  const configured = trimValue(process.env.DRIVEREADY_AUTH_REDIRECT_ALLOWLIST);

  if (!configured) {
    return [];
  }

  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveTrustProxy() {
  const configured = trimValue(process.env.DRIVEREADY_TRUST_PROXY).toLowerCase();

  if (!configured) {
    return false;
  }

  if (configured === 'true') {
    return true;
  }

  if (configured === 'false') {
    return false;
  }

  const numeric = Number(configured);

  if (Number.isInteger(numeric) && numeric >= 0) {
    return numeric;
  }

  return configured;
}

function getJobSecret() {
  return trimValue(process.env.DRIVEREADY_JOB_SECRET);
}

const allowedCorsOrigins = resolveCorsOrigins();
const allowedRedirectPrefixes = resolveRedirectAllowlist();

function isAllowedRedirectTarget(redirectTo?: string) {
  if (!redirectTo) {
    return true;
  }

  if (allowedRedirectPrefixes.length === 0) {
    return true;
  }

  return allowedRedirectPrefixes.some((prefix) => redirectTo.startsWith(prefix));
}

function isPublicPath(requestPath: string) {
  return publicPaths.has(requestPath) || publicPathPrefixes.some((prefix) => requestPath.startsWith(prefix));
}

function getBearerToken(request: Request) {
  const authorization = request.header('authorization');

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token?.trim()) {
    return null;
  }

  return token.trim();
}

function hasValidSessionToken(request: Request) {
  const token = getBearerToken(request);
  const session = appData.session;

  if (!token || !session) {
    return false;
  }

  return token === session.token && Date.parse(session.expires_at) > Date.now();
}

function getRequestState(response: Response) {
  return (response.locals.appData as AppData | undefined) ?? appData;
}

function getRequestUserId(response: Response) {
  return response.locals.authUserId as string | undefined;
}

function ensureLocalAuthState(state: AppData) {
  if (usesSupabaseAuth()) {
    return false;
  }

  if (!trimValue(state.user.email)) {
    return false;
  }

  if (state.local_auth) {
    return false;
  }

  state.local_auth = defaultLocalAuthState();
  return true;
}

function mergeUserProfile(state: AppData, nextProfile: AppData['user']) {
  const current = state.user;
  const merged = {
    ...current,
    ...nextProfile,
    id: nextProfile.id || current.id,
    first_name: nextProfile.first_name || current.first_name,
    last_name: nextProfile.last_name || current.last_name,
    email: nextProfile.email || current.email,
    phone: nextProfile.phone || current.phone,
    address_line: nextProfile.address_line || current.address_line,
  };
  const changed =
    merged.id !== current.id ||
    merged.first_name !== current.first_name ||
    merged.last_name !== current.last_name ||
    merged.email !== current.email ||
    merged.phone !== current.phone ||
    merged.address_line !== current.address_line;

  state.user = merged;
  return changed;
}

async function loadSupabaseAppStateForUser(user: AppData['user']) {
  if (!supportsPerUserAppData()) {
    throw new Error('Supabase auth requires per-user storage support.');
  }

  const state = createEmptyUserAppData(user);
  await hydrateUserAppData(user.id, state);

  const profileChanged = mergeUserProfile(state, user);
  const derivedStateChanged = syncDerivedState(state);

  if (profileChanged || derivedStateChanged) {
    await persistUserAppData(user.id, state);
  }

  return state;
}

app.set('trust proxy', resolveTrustProxy());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedCorsOrigins.length === 0 || allowedCorsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS.'));
    },
  }),
);
app.use(morgan('dev'));
app.use((request, response, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  response.on('finish', () => {
    recordRequestMetric({
      durationMs: Date.now() - startedAt,
      method: request.method,
      route: request.path,
      statusCode: response.statusCode,
    });
  });

  next();
});
app.use(express.json());
app.use(
  [
    '/api/v1/auth/sign-in',
    '/api/v1/auth/sign-up',
    '/api/v1/auth/password-reset/request',
    '/api/v1/auth/password-reset/confirm',
  ],
  authLimiter,
);
app.use('/api/v1', (request, response, next) => {
  void (async () => {
    if (isPublicPath(request.path)) {
      next();
      return;
    }

    if (usesSupabaseAuth()) {
      const token = getBearerToken(request);

      if (!token) {
        response.status(401).json(apiError('Authentication required.'));
        return;
      }

      const authUser = await getSupabaseUserForToken(token);

      if (!authUser) {
        response.status(401).json(apiError('Authentication required.'));
        return;
      }

      response.locals.authUserId = authUser.id;
      response.locals.appData = await loadSupabaseAppStateForUser(authUser.profile);
      next();
      return;
    }

    if (!hasValidSessionToken(request)) {
      response.status(401).json(apiError('Authentication required.'));
      return;
    }

    response.locals.appData = appData;
    if (syncDerivedState(appData)) {
      await persistAppData(appData);
    }
    next();
  })().catch(next);
});

type AsyncRouteHandler = (request: Request, response: Response) => Promise<void>;

function asyncRoute(handler: AsyncRouteHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

if (!usesSupabaseAuth()) {
  await hydrateAppData(appData);
  const authChanged = ensureLocalAuthState(appData);
  const derivedStateChanged = syncDerivedState(appData);

  if (authChanged || derivedStateChanged) {
    await persistAppData(appData);
  }
}

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function sessionExpiry() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString();
}

function createSession() {
  return {
    token: `driveready_${randomUUID()}`,
    expires_at: sessionExpiry(),
  };
}

function createDeletedLocalUser() {
  return {
    id: 'deleted-local-user',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address_line: '',
  };
}

function apiError(message: string, fields?: Record<string, string>) {
  return {
    error: {
      code: 'validation_failed',
      message,
      fields,
    },
  };
}

async function saveState() {
  ensureLocalAuthState(appData);
  syncDerivedState(appData);
  await persistAppData(appData);
}

async function saveRequestState(response: Response) {
  const authUserId = getRequestUserId(response);
  const state = getRequestState(response);

  if (!authUserId) {
    ensureLocalAuthState(state);
  }
  syncDerivedState(state);

  if (authUserId) {
    await persistUserAppData(authUserId, state);
    if (normalizedProjectionEnabled()) {
      await projectUserAppData(authUserId, state);
    }
    return;
  }

  await persistAppData(state);
}

async function deleteDocumentFilesForState(state: AppData) {
  await Promise.all(state.documents.map((document) => deleteStoredDocument(document.file_key)));
}

app.get('/api/v1/health', (_request, response) => {
  const reminderSummary = summarizeReminderSchedule(appData);

  response.json({
    ok: true,
    vehicle_enquiry: getDvlaVesTargetLabel(),
    mot: getDvsaMotTargetLabel(),
    location_search: getLocationSearchTargetLabel(),
    notifications: getNotificationTargetLabel(),
    refuel: getRefuelTargetLabel(),
    storage: getStorageTargetLabel(),
    uploads: getUploadTargetLabel(),
    normalized_storage: usesNormalizedSupabaseStorage(),
    normalized_projection: normalizedProjectionEnabled(),
    background_jobs: getBackgroundJobStatus(),
    reminders: {
      next_scheduled_for: reminderSummary.nextScheduled?.scheduled_for ?? null,
      scheduled_count: reminderSummary.scheduledCount,
      suppressed_count: reminderSummary.suppressedCount,
      delivered_count: reminderSummary.deliveredCount,
      failed_count: reminderSummary.failedCount,
    },
    metrics: metricsSnapshot(),
  });
});

app.get('/api/v1/metrics', (_request, response) => {
  response.json(metricsSnapshot());
});

app.get('/api/v1/files/download', (request, response) => {
  if (usesSupabaseUploads()) {
    response.status(404).json(apiError('Local download route is not available for Supabase uploads.'));
    return;
  }

  const fileKey = trimValue(String(request.query.key ?? ''));
  const expires = trimValue(String(request.query.expires ?? ''));
  const signature = trimValue(String(request.query.signature ?? ''));
  const filePath = resolveLocalDownloadFile({
    expires,
    fileKey,
    signature,
  });

  if (!filePath) {
    response.status(401).json(apiError('Download link is invalid or has expired.'));
    return;
  }

  response.setHeader('Cache-Control', 'private, no-store');
  response.sendFile(filePath, (error) => {
    if (!error) {
      return;
    }

    if (!response.headersSent) {
      response.status(404).json(apiError('File not found.'));
    }
  });
});

app.post('/api/v1/auth/sign-in', asyncRoute(async (request, response) => {
  const parsed = parseBody(signInSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  if (usesSupabaseAuth()) {
    const result = await signInWithSupabasePassword(parsed.data);
    const state = await loadSupabaseAppStateForUser(result.user.profile);
    writeAuditEntry('auth.sign_in', { email: result.user.profile.email, user_id: result.user.id });
    response.json({
      user: state.user,
      session: result.session,
    });
    return;
  }

  ensureLocalAuthState(appData);
  const { email, password } = parsed.data;

  if (!appData.user.email || appData.user.email.toLowerCase() !== email.toLowerCase()) {
    response.status(401).json(apiError('Incorrect email or password.'));
    return;
  }

  if (!verifyLocalPassword(password, appData.local_auth)) {
    response.status(401).json(apiError('Incorrect email or password.'));
    return;
  }

  appData.session = createSession();
  await saveState();
  writeAuditEntry('auth.sign_in', { email });

  response.json({
    user: appData.user,
    session: appData.session,
  });
}));

app.post('/api/v1/auth/sign-up', asyncRoute(async (request, response) => {
  const parsed = parseBody(signUpSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  if (usesSupabaseAuth()) {
    const result = await signUpWithSupabasePassword(parsed.data);
    const state = await loadSupabaseAppStateForUser(result.user.profile);
    writeAuditEntry('auth.sign_up', { email: result.user.profile.email, user_id: result.user.id });
    response.status(201).json({
      user: state.user,
      session: result.session,
    });
    return;
  }

  const { first_name, last_name, email, password } = parsed.data;

  appData.user = {
    ...appData.user,
    first_name,
    last_name,
    email,
  };
  appData.local_auth = createLocalAuthState(password);
  appData.session = createSession();
  await saveState();
  writeAuditEntry('auth.sign_up', { email });

  response.status(201).json({
    user: appData.user,
    session: appData.session,
  });
}));

app.post('/api/v1/auth/sign-out', asyncRoute(async (_request, response) => {
  if (usesSupabaseAuth()) {
    response.status(204).send();
    return;
  }

  if (appData.session && hasValidSessionToken(_request)) {
    writeAuditEntry('auth.sign_out', { user_id: appData.user.id });
    appData.session = null;
    await saveState();
  }

  response.status(204).send();
}));

app.post('/api/v1/auth/password-reset/request', asyncRoute(async (request, response) => {
  const parsed = parseBody(passwordResetRequestSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  if (!isAllowedRedirectTarget(parsed.data.redirect_to)) {
    response.status(400).json(apiError('Password reset redirect URL is not allowed.'));
    return;
  }

  if (usesSupabaseAuth()) {
    try {
      await requestSupabasePasswordReset(parsed.data.email, parsed.data.redirect_to);
    } catch (error) {
      response.status(400).json(apiError(error instanceof Error ? error.message : 'Unable to request password reset.'));
      return;
    }
  }

  response.status(202).json({
    message: 'Password reset request accepted.',
  });
}));

app.post('/api/v1/auth/password-reset/confirm', asyncRoute(async (request, response) => {
  const parsed = parseBody(passwordResetConfirmSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  if (usesSupabaseAuth()) {
    try {
      await confirmSupabasePasswordReset(parsed.data);
    } catch (error) {
      response.status(400).json(apiError(error instanceof Error ? error.message : 'Unable to update password.'));
      return;
    }

    response.status(200).json({
      message: 'Password updated.',
    });
    return;
  }

  appData.local_auth = createLocalAuthState(parsed.data.password);
  appData.session = createSession();
  await saveState();

  response.status(200).json({
    message: 'Password updated.',
    user: appData.user,
    session: appData.session,
  });
}));

app.post('/api/v1/auth/refresh', asyncRoute(async (request, response) => {
  const parsed = parseBody(refreshSessionSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  if (!usesSupabaseAuth()) {
    response.status(400).json(apiError('Session refresh is only available when Supabase auth is enabled.'));
    return;
  }

  const result = await refreshSupabaseSession(parsed.data.refresh_token);
  const state = await loadSupabaseAppStateForUser(result.user.profile);

  response.json({
    user: state.user,
    session: result.session,
  });
}));

app.get('/api/v1/auth/session', asyncRoute(async (request, response) => {
  if (usesSupabaseAuth()) {
    const token = getBearerToken(request);

    if (!token) {
      response.json({ user: null, session: null });
      return;
    }

    const authUser = await getSupabaseUserForToken(token);

    if (!authUser) {
      response.json({ user: null, session: null });
      return;
    }

    const state = await loadSupabaseAppStateForUser(authUser.profile);

    response.json({
      user: state.user,
      session: authUser.session,
    });
    return;
  }

  const isAuthorized = hasValidSessionToken(request);

  response.json({
    user: isAuthorized ? appData.user : null,
    session: isAuthorized ? appData.session : null,
  });
}));

app.get('/api/v1/me', (_request, response) => {
  const state = getRequestState(response);

  response.json({
    user: state.user,
    notification_preferences: state.notification_preferences,
    permission_states: state.permission_states,
    push_devices: state.push_devices,
  });
});

app.patch('/api/v1/me', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(profilePatchSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  if (usesSupabaseAuth()) {
    const authUserId = getRequestUserId(response);

    if (!authUserId) {
      response.status(401).json(apiError('Authentication required.'));
      return;
    }

    state.user = await updateSupabaseAuthProfile({
      userId: authUserId,
      existingProfile: state.user,
      email: parsed.data.email,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
    });
  } else {
    state.user = {
      ...state.user,
      ...parsed.data,
    };
  }
  state.user = {
    ...state.user,
    ...parsed.data,
  };
  await saveRequestState(response);
  writeAuditEntry('profile.updated', { user_id: state.user.id });
  response.json({ user: state.user });
}));

app.patch('/api/v1/me/notification-preferences', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(notificationPreferencesSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  state.notification_preferences = {
    ...state.notification_preferences,
    ...parsed.data,
  };
  await saveRequestState(response);
  response.json({ notification_preferences: state.notification_preferences });
}));

app.patch('/api/v1/me/permission-states', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(permissionStatesSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  state.permission_states = {
    ...state.permission_states,
    ...parsed.data,
  };
  await saveRequestState(response);
  response.json({ permission_states: state.permission_states });
}));

app.get('/api/v1/me/push-devices', (_request, response) => {
  const state = getRequestState(response);
  response.json({ devices: state.push_devices });
});

app.post('/api/v1/me/push-devices', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(pushDeviceSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const device = upsertPushDevice(state, parsed.data);
  await saveRequestState(response);
  writeAuditEntry('push_device.upserted', { device_id: device.id, platform: device.platform });
  response.status(201).json({ device });
}));

app.delete('/api/v1/me/push-devices/:deviceId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const removed = removePushDevice(state, String(request.params.deviceId));

  if (!removed) {
    response.status(404).json(apiError('Push device not found.'));
    return;
  }

  await saveRequestState(response);
  writeAuditEntry('push_device.deleted', { device_id: removed.id });
  response.status(204).send();
}));

app.delete('/api/v1/me', asyncRoute(async (_request, response) => {
  const state = getRequestState(response);
  const authUserId = getRequestUserId(response);

  await deleteDocumentFilesForState(state);

  if (usesSupabaseAuth()) {
    if (!authUserId) {
      response.status(401).json(apiError('Authentication required.'));
      return;
    }

    await deleteUserAppData(authUserId);
    await deleteProjectedUserData(authUserId);
    await deleteSupabaseAuthUser(authUserId);
    writeAuditEntry('account.deleted', { user_id: authUserId, email: state.user.email, auth_backend: 'supabase' });
    response.status(204).send();
    return;
  }

  Object.assign(appData, createEmptyUserAppData(createDeletedLocalUser()));
  appData.session = null;
  await saveState();
  writeAuditEntry('account.deleted', { user_id: state.user.id, email: state.user.email, auth_backend: 'local' });
  response.status(204).send();
}));

app.get('/api/v1/dashboard', (_request, response) => {
  const state = getRequestState(response);
  const dashboard = buildDashboard(state.vehicles, state.documents, state.alerts, state.selected_vehicle_id);
  const currentVehicle = state.vehicles.find((vehicle) => vehicle.id === dashboard.selected_vehicle_id) ?? state.vehicles[0];
  const selectedVehicle = currentVehicle ? summarizeVehicle(currentVehicle) : null;

  response.json({
    dashboard,
    selected_vehicle: selectedVehicle,
  });
});

app.get('/api/v1/vehicles', (_request, response) => {
  const state = getRequestState(response);
  response.json({
    vehicles: state.vehicles.map((vehicle) => summarizeVehicle(vehicle)),
  });
});

app.post('/api/v1/vehicles', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(vehicleSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const { registration_plate, nickname, make_model, fuel_type, mileage, mot_due_at, tax_due_at, insurance_due_at, notes } =
    parsed.data;

  let vehicle: VehicleRecord = {
    id: generateId('vehicle'),
    registration_plate: registration_plate.toUpperCase(),
    nickname: nickname?.trim() || registration_plate.toUpperCase(),
    make_model: make_model?.trim() || 'Vehicle details pending',
    fuel_type: fuel_type?.trim() || 'Unknown',
    mileage: mileage ?? 0,
    mot_due_at: mot_due_at ?? isoDateFromNow(30),
    tax_due_at: tax_due_at ?? isoDateFromNow(30),
    insurance_due_at: insurance_due_at ?? isoDateFromNow(30),
    notes: notes ?? '',
    image_url:
      'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=1200&q=80',
  };

  if (usesDvlaVes()) {
    try {
      vehicle = (await enrichVehicleWithDvlaVes(vehicle)).vehicle;
    } catch (error) {
      if (!(error instanceof DvlaVesError)) {
        throw error;
      }

      writeAuditEntry('vehicle.dvla_create_enrichment_skipped', {
        message: error.message,
        registration_plate: vehicle.registration_plate,
        status_code: error.statusCode,
      });
    }
  }

  state.vehicles.unshift(vehicle);
  state.selected_vehicle_id = vehicle.id;
  await saveRequestState(response);
  writeAuditEntry('vehicle.created', { vehicle_id: vehicle.id, registration_plate: vehicle.registration_plate });

  response.status(201).json({
    vehicle: summarizeVehicle(vehicle),
  });
}));

app.get('/api/v1/vehicles/:vehicleId', (request, response) => {
  const state = getRequestState(response);
  const vehicle = state.vehicles.find((entry) => entry.id === request.params.vehicleId);

  if (!vehicle) {
    response.status(404).json(apiError('Vehicle not found.'));
    return;
  }

  response.json({
    vehicle: summarizeVehicle(vehicle),
    service_history: state.service_history.filter((entry) => entry.vehicle_id === vehicle.id),
    linked_documents: state.documents.filter((document) => document.vehicle_id === vehicle.id).map((document) => summarizeDocument(document)),
    linked_zones: linkVehicleZones(vehicle, state.zones),
  });
});

app.patch('/api/v1/vehicles/:vehicleId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.vehicles.findIndex((entry) => entry.id === request.params.vehicleId);

  if (index === -1) {
    response.status(404).json(apiError('Vehicle not found.'));
    return;
  }

  const validated = parseBody(vehiclePatchSchema, request.body);

  if (!validated.success) {
    response.status(400).json(apiError(validated.message, validated.fields));
    return;
  }

  state.vehicles[index] = {
    ...state.vehicles[index],
    ...validated.data,
  };
  await saveRequestState(response);
  writeAuditEntry('vehicle.updated', { vehicle_id: state.vehicles[index].id });

  response.json({
    vehicle: summarizeVehicle(state.vehicles[index]),
  });
}));

app.delete('/api/v1/vehicles/:vehicleId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.vehicles.findIndex((entry) => entry.id === request.params.vehicleId);

  if (index === -1) {
    response.status(404).json(apiError('Vehicle not found.'));
    return;
  }

  const [removed] = state.vehicles.splice(index, 1);
  state.documents = state.documents.filter((document) => document.vehicle_id !== removed.id);
  state.alerts = state.alerts.filter((alert) => alert.vehicle_id !== removed.id);
  state.service_history = state.service_history.filter((item) => item.vehicle_id !== removed.id);
  state.selected_vehicle_id = state.vehicles[0]?.id ?? '';
  await saveRequestState(response);
  writeAuditEntry('vehicle.deleted', { vehicle_id: removed.id });

  response.status(204).send();
}));

app.post('/api/v1/vehicles/:vehicleId/enrich', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.vehicles.findIndex((entry) => entry.id === request.params.vehicleId);

  if (index === -1) {
    response.status(404).json(apiError('Vehicle not found.'));
    return;
  }

  try {
    if (!usesDvlaVes() && !hasDvsaMotSetup()) {
      response.status(503).json(apiError('No live vehicle data providers are configured.'));
      return;
    }

    let vehicle = state.vehicles[index];
    let sourceNames: string[] = [];
    let freshestAt = new Date(0).toISOString();
    let motTestsSynced = 0;

    if (usesDvlaVes()) {
      const dvlaEnrichment = await enrichVehicleWithDvlaVes(vehicle);
      vehicle = dvlaEnrichment.vehicle;
      sourceNames.push(dvlaEnrichment.sourceName);
      freshestAt = dvlaEnrichment.freshnessAt;
    }

    if (hasDvsaMotSetup()) {
      const dvsaEnrichment = await enrichVehicleWithDvsaMot(vehicle);
      vehicle = dvsaEnrichment.vehicle;
      sourceNames.push(dvsaEnrichment.sourceName);
      freshestAt = dvsaEnrichment.freshnessAt > freshestAt ? dvsaEnrichment.freshnessAt : freshestAt;
      motTestsSynced = dvsaEnrichment.motHistoryEntries.length;
      state.service_history = state.service_history.filter(
        (entry) => !(entry.vehicle_id === dvsaEnrichment.vehicle.id && entry.id.startsWith(`mot-history-${dvsaEnrichment.vehicle.id}-`)),
      );
      state.service_history.push(...dvsaEnrichment.motHistoryEntries);
      state.service_history.sort((left, right) => right.event_date.localeCompare(left.event_date));
    }

    state.vehicles[index] = vehicle;
    await saveRequestState(response);
    writeAuditEntry('vehicle.enriched', {
      freshness_at: freshestAt,
      mot_tests_synced: motTestsSynced,
      source_name: sourceNames.join(' + '),
      vehicle_id: vehicle.id,
    });

    response.json({
      vehicle: summarizeVehicle(vehicle),
      mot_tests_synced: motTestsSynced,
      source_name: sourceNames.join(' + '),
      freshness_at: freshestAt,
    });
  } catch (error) {
    if (error instanceof DvlaVesError || error instanceof DvsaMotError) {
      response.status(error.statusCode).json(apiError(error.message));
      return;
    }

    throw error;
  }
}));

app.get('/api/v1/alerts', (request, response) => {
  const state = getRequestState(response);
  const status = String(request.query.status ?? 'all');
  const search = String(request.query.search ?? '').toLowerCase();

  let alerts = state.alerts.map((alert) => summarizeAlert(alert));

  if (status === 'open' || status === 'handled') {
    alerts = alerts.filter((alert) => alert.status === status);
  }

  if (search) {
    alerts = alerts.filter((alert) =>
      [alert.title, alert.subtitle, alert.detail].some((value) => value.toLowerCase().includes(search)),
    );
  }

  response.json({ alerts });
});

app.get('/api/v1/alerts/:alertId', (request, response) => {
  const state = getRequestState(response);
  const alert = state.alerts.find((entry) => entry.id === request.params.alertId);

  if (!alert) {
    response.status(404).json(apiError('Alert not found.'));
    return;
  }

  response.json({ alert: summarizeAlert(alert) });
});

app.patch('/api/v1/alerts/:alertId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.alerts.findIndex((entry) => entry.id === request.params.alertId);

  if (index === -1) {
    response.status(404).json(apiError('Alert not found.'));
    return;
  }

  const parsed = parseBody(alertPatchSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  state.alerts[index] = {
    ...state.alerts[index],
    ...parsed.data,
  };
  await saveRequestState(response);
  writeAuditEntry('alert.updated', { alert_id: state.alerts[index].id });

  response.json({ alert: summarizeAlert(state.alerts[index]) });
}));

app.get('/api/v1/documents', (request, response) => {
  const state = getRequestState(response);
  const status = String(request.query.status ?? 'all');
  const vehicleId = String(request.query.vehicle_id ?? '');

  let documents = state.documents.map((document) => summarizeDocument(document));

  if (vehicleId) {
    documents = documents.filter((document) => document.vehicle_id === vehicleId);
  }

  if (status !== 'all') {
    documents = documents.filter((document) => document.status === status);
  }

  response.json({ documents });
});

app.post('/api/v1/documents/upload-init', (_request, response) => {
  const uploadId = generateId('upload');
  uploadSessions.set(uploadId, { createdAt: new Date().toISOString() });

  response.status(201).json({
    upload: {
      upload_id: uploadId,
      status: 'ready',
      upload_url: `/api/v1/documents/upload-binary/${uploadId}`,
    },
  });
});

app.post('/api/v1/documents/upload-binary/:uploadId', uploadMiddleware.single('file'), asyncRoute(async (request, response) => {
  const uploadId = String(request.params.uploadId);
  const uploadSession = uploadSessions.get(uploadId);
  const file = request.file;

  if (!uploadSession) {
    response.status(404).json(apiError('Upload session not found.'));
    return;
  }

  if (!file) {
    response.status(400).json(apiError('No file was uploaded.'));
    return;
  }

  uploadSessions.delete(uploadId);
  const storedUpload = await storeUploadedDocument(file, getRequestUserId(response));
  writeAuditEntry('document.file_uploaded', {
    upload_id: uploadId,
    file_name: file.originalname,
    stored_name: storedUpload.fileKey,
  });

  response.status(201).json({
    upload: {
      upload_id: uploadId,
      ...(uploadSession.replacesDocumentId ? { replaces_document_id: uploadSession.replacesDocumentId } : {}),
      file_key: storedUpload.fileKey,
      file_name: storedUpload.fileName,
      mime_type: storedUpload.mimeType,
      uploaded_at: uploadSession.createdAt,
      download_url: storedUpload.downloadUrl,
    },
  });
}));

app.post('/api/v1/documents', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(documentSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const { vehicle_id, title, document_type, expires_at, source_type, file_name, file_key, mime_type } = parsed.data;

  const document: DocumentRecord = {
    id: generateId('document'),
    vehicle_id,
    title,
    document_type,
    uploaded_at: new Date().toISOString(),
    expires_at,
    source_type,
    file_name: file_name ?? `${title}.pdf`,
    file_key,
    mime_type,
  };

  state.documents.unshift(document);
  await saveRequestState(response);
  writeAuditEntry('document.created', { document_id: document.id, vehicle_id: document.vehicle_id });
  response.status(201).json({ document: summarizeDocument(document) });
}));

app.get('/api/v1/documents/:documentId', (request, response) => {
  const state = getRequestState(response);
  const document = state.documents.find((entry) => entry.id === request.params.documentId);

  if (!document) {
    response.status(404).json(apiError('Document not found.'));
    return;
  }

  response.json({
    document: summarizeDocument(document),
    linked_vehicle: state.vehicles.find((vehicle) => vehicle.id === document.vehicle_id),
  });
});

app.patch('/api/v1/documents/:documentId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.documents.findIndex((entry) => entry.id === request.params.documentId);

  if (index === -1) {
    response.status(404).json(apiError('Document not found.'));
    return;
  }

  const parsed = parseBody(documentPatchSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const previousFileKey = state.documents[index].file_key;

  state.documents[index] = {
    ...state.documents[index],
    ...parsed.data,
  };
  await saveRequestState(response);
  if (parsed.data.file_key && previousFileKey && previousFileKey !== parsed.data.file_key) {
    await deleteStoredDocument(previousFileKey);
  }
  writeAuditEntry('document.updated', { document_id: state.documents[index].id });
  response.json({ document: summarizeDocument(state.documents[index]) });
}));

app.post('/api/v1/documents/:documentId/replace-init', (request, response) => {
  const state = getRequestState(response);
  const document = state.documents.find((entry) => entry.id === request.params.documentId);

  if (!document) {
    response.status(404).json(apiError('Document not found.'));
    return;
  }

  const uploadId = generateId('replace');
  uploadSessions.set(uploadId, {
    createdAt: new Date().toISOString(),
    replacesDocumentId: document.id,
  });

  response.status(201).json({
    upload: {
      upload_id: uploadId,
      replaces_document_id: document.id,
      status: 'ready',
      upload_url: `/api/v1/documents/upload-binary/${uploadId}`,
    },
  });
});

app.delete('/api/v1/documents/:documentId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.documents.findIndex((entry) => entry.id === request.params.documentId);

  if (index === -1) {
    response.status(404).json(apiError('Document not found.'));
    return;
  }

  const [document] = state.documents.splice(index, 1);
  await saveRequestState(response);
  await deleteStoredDocument(document.file_key);
  writeAuditEntry('document.deleted', { document_id: document.id });
  response.status(204).send();
}));

app.post('/api/v1/documents/:documentId/share', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const document = state.documents.find((entry) => entry.id === request.params.documentId);

  if (!document) {
    response.status(404).json(apiError('Document not found.'));
    return;
  }

  response.json({
    share_url: document.file_key
      ? await createDocumentShareUrl(document.file_key)
      : `https://driveready.local/share/${document.id}`,
  });
}));

app.get('/api/v1/zones', (_request, response) => {
  const state = getRequestState(response);
  response.json({ zones: state.zones });
});

app.post('/api/v1/zones', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(zoneSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const { name, route_label, charge_amount_label } = parsed.data;

  const zone: SavedZone = {
    id: generateId('zone'),
    name,
    route_label,
    charge_amount_label,
    compliance_status: 'unknown',
    monitored: true,
    source_name: 'manual',
    freshness_at: new Date().toISOString(),
  };

  state.zones.unshift(zone);
  await saveRequestState(response);
  writeAuditEntry('zone.created', { zone_id: zone.id, name: zone.name });
  response.status(201).json({ zone });
}));

app.patch('/api/v1/zones/:zoneId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.zones.findIndex((entry) => entry.id === request.params.zoneId);

  if (index === -1) {
    response.status(404).json(apiError('Zone not found.'));
    return;
  }

  const parsed = parseBody(zonePatchSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  state.zones[index] = {
    ...state.zones[index],
    ...parsed.data,
  };
  await saveRequestState(response);
  writeAuditEntry('zone.updated', { zone_id: state.zones[index].id });

  response.json({ zone: state.zones[index] });
}));

app.delete('/api/v1/zones/:zoneId', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const index = state.zones.findIndex((entry) => entry.id === request.params.zoneId);

  if (index === -1) {
    response.status(404).json(apiError('Zone not found.'));
    return;
  }

  const [zone] = state.zones.splice(index, 1);
  await saveRequestState(response);
  writeAuditEntry('zone.deleted', { zone_id: zone.id });
  response.status(204).send();
}));

app.get('/api/v1/location-suggestions', asyncRoute(async (request, response) => {
  const parsed = parseBody(querySchema, request.query);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const suggestions = await searchLocationSuggestions(parsed.data.q);
  response.json({ suggestions });
}));

app.post('/api/v1/trip-checks', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(tripCheckSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const {
    vehicle_id,
    input_type,
    destination_query,
    latitude,
    longitude,
    saved_zone_id,
    persist_result,
  } = parsed.data;

  if (input_type === 'destination' && !destination_query?.trim()) {
    response.status(400).json(apiError('Enter a destination for this trip check.', {
      destination_query: 'Enter a destination.',
    }));
    return;
  }

  if (input_type === 'saved_zone' && !saved_zone_id?.trim()) {
    response.status(400).json(apiError('Select a saved zone for this trip check.', {
      saved_zone_id: 'Select a saved zone.',
    }));
    return;
  }

  const vehicle = state.vehicles.find((entry) => entry.id === vehicle_id);

  if (!vehicle) {
    response.status(404).json(apiError('Vehicle not found.'));
    return;
  }

  const savedZone = state.zones.find((entry) => entry.id === saved_zone_id);

  if (input_type === 'saved_zone' && !savedZone) {
    response.status(404).json(apiError('Saved zone not found.'));
    return;
  }

  const result = await buildTripCheck({
    destinationQuery: destination_query,
    inputType: input_type,
    latitude,
    longitude,
    savedZone,
    vehicle,
  });

  if (persist_result) {
    state.trip_checks.unshift(result.trip_check);
    await saveRequestState(response);
  }
  writeAuditEntry('trip_check.ran', {
    trip_check_id: result.trip_check.id,
    vehicle_id,
    compliance_status: result.trip_check.compliance_status,
    matched_zone: result.matched_zone?.name ?? null,
  });

  response.status(201).json({
    trip_check: result.trip_check,
    degraded: result.degraded,
    matched_zone: result.matched_zone,
    resolved_destination: result.resolved_destination,
  });
}));

app.get('/api/v1/trip-checks', (_request, response) => {
  const state = getRequestState(response);
  response.json({ trip_checks: state.trip_checks });
});

app.get('/api/v1/trip-checks/:tripCheckId', (request, response) => {
  const state = getRequestState(response);
  const tripCheck = state.trip_checks.find((entry) => entry.id === request.params.tripCheckId);

  if (!tripCheck) {
    response.status(404).json(apiError('Trip check not found.'));
    return;
  }

  response.json({ trip_check: tripCheck });
});

app.post('/api/v1/refuel-options', asyncRoute(async (request, response) => {
  const parsed = parseBody(refuelSearchSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const result = await searchRefuelOptions({
    energyType: parsed.data.energy_type,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    originQuery: parsed.data.origin_query,
    sortBy: parsed.data.sort_by,
  });

  response.status(200).json(result);
}));

app.post('/api/v1/internal/jobs/run-reminders', asyncRoute(async (request, response) => {
  const secret = getJobSecret();

  if (secret && request.header('x-driveready-job-secret') !== secret) {
    response.status(401).json(apiError('Invalid job secret.'));
    return;
  }

  const parsed = parseBody(jobRunSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const result = await runReminderDispatchJob({
    dryRun: parsed.data.dry_run,
    localState: appData,
  });
  if (result.sent_count > 0) {
    recordProviderMetric(getNotificationTargetLabel(), 'success');
  }
  if (result.failed_count > 0) {
    recordProviderMetric(getNotificationTargetLabel(), 'failure');
  }
  writeAuditEntry('job.run_reminders', {
    sent_count: result.sent_count,
    failed_count: result.failed_count,
  });
  response.json(result);
}));

app.post('/api/v1/internal/jobs/refresh-vehicle-data', asyncRoute(async (request, response) => {
  const secret = getJobSecret();

  if (secret && request.header('x-driveready-job-secret') !== secret) {
    response.status(401).json(apiError('Invalid job secret.'));
    return;
  }

  const parsed = parseBody(jobRunSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const result = await runVehicleRefreshJob({
    dryRun: parsed.data.dry_run,
    localState: appData,
  });
  writeAuditEntry('job.refresh_vehicle_data', {
    refreshed_count: result.refreshed_count,
    failed_count: result.failed_count,
  });
  response.json(result);
}));

app.get('/api/v1/support/content', (_request, response) => {
  const state = getRequestState(response);
  const reminderSummary = summarizeReminderSchedule(state);

  response.json({
    items: [
      {
        id: 'help',
        title: 'Help Centre',
        body: 'Need help? Contact DriveReady support with your account email, vehicle registration, the screen you were using, and the error message you saw.',
      },
      {
        id: 'privacy',
        title: 'Privacy',
        body: 'DriveReady stores your account profile, vehicles, reminder preferences, uploaded document metadata, and private document files. Vehicle lookups are sent from our backend to configured providers such as DVLA VES and, after approval, DVSA MOT History.',
      },
      {
        id: 'terms',
        title: 'Terms',
        body: 'DriveReady is an organisation and reminder tool, not legal, insurance, tax, parking, or roadworthiness advice. Always verify MOT, tax, insurance, parking, charge-zone, and restriction decisions with the official provider before driving.',
      },
      {
        id: 'providers',
        title: 'Live provider status',
        body: `Vehicle enquiry: ${getDvlaVesTargetLabel()}. MOT history: ${getDvsaMotTargetLabel()}. Location search: ${getLocationSearchTargetLabel()}. Notifications: ${getNotificationTargetLabel()}. Refuel: ${getRefuelTargetLabel()}. Parking provider: pending contract/API access.`,
      },
      {
        id: 'reminders',
        title: 'Reminder scheduler',
        body: reminderSummary.nextScheduled
          ? `${reminderSummary.scheduledCount} reminders are scheduled. Next reminder: ${reminderSummary.nextScheduled.alert_title} at ${reminderSummary.nextScheduled.scheduled_for}. ${reminderSummary.deliveredCount} have been delivered, ${reminderSummary.failedCount} failed, and ${reminderSummary.suppressedCount} are currently suppressed by permissions or settings.`
          : `${reminderSummary.scheduledCount} reminders are scheduled. ${reminderSummary.deliveredCount} have been delivered, ${reminderSummary.failedCount} failed, and ${reminderSummary.suppressedCount} are currently suppressed by permissions or settings.`,
      },
    ],
  });
});

app.get('/api/v1/support/exports', (_request, response) => {
  const state = getRequestState(response);
  response.json({ exports: state.data_exports });
});

app.post('/api/v1/support/export-request', asyncRoute(async (_request, response) => {
  const state = getRequestState(response);
  const exportRecord = await generateUserDataExport({
    state,
    userId: getRequestUserId(response),
  });
  state.data_exports.unshift(exportRecord);
  await saveRequestState(response);
  recordJobMetric('data_exports_generated');
  writeAuditEntry('support.export_generated', { export_id: exportRecord.id });

  response.status(201).json({
    message: 'Export generated.',
    export: exportRecord,
  });
}));

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error('DriveReady backend error', {
    error,
    request_id: response.locals.requestId,
  });

  if (response.headersSent) {
    return;
  }

  response.status(500).json({
    ...apiError('Internal server error.'),
    request_id: response.locals.requestId,
  });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  startBackgroundJobs(appData);
  app.listen(port, () => {
    console.log(`DriveReady backend listening on http://localhost:${port}`);
    console.log(`DriveReady storage: ${getStorageTargetLabel()}`);
  });
}
