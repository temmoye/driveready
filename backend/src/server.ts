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
  usesSupabaseAuth,
} from './auth.js';
import { writeAuditEntry } from './audit.js';
import { appData, createEmptyUserAppData } from './data.js';
import { DvlaVesError, enrichVehicleWithDvlaVes, getDvlaVesTargetLabel, usesDvlaVes } from './dvla-ves.js';
import { DvsaMotError, enrichVehicleWithDvsaMot, getDvsaMotTargetLabel, hasDvsaMotSetup } from './dvsa-mot.js';
import {
  deleteUserAppData,
  getStorageTargetLabel,
  hydrateAppData,
  hydrateUserAppData,
  persistAppData,
  persistUserAppData,
  supportsPerUserAppData,
} from './persistence.js';
import { buildDashboard, linkVehicleZones, summarizeAlert, summarizeDocument, summarizeVehicle } from './status.js';
import type {
  AppData,
  DocumentRecord,
  ParkingSuggestion,
  SavedZone,
  TripCheckRecord,
  VehicleRecord,
} from './types.js';
import {
  createDocumentShareUrl,
  deleteStoredDocument,
  getUploadTargetLabel,
  getUploadsDir,
  storeUploadedDocument,
  uploadMiddleware,
  usesSupabaseUploads,
} from './uploads.js';
import {
  alertPatchSchema,
  documentSchema,
  notificationPreferencesSchema,
  parseBody,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  permissionStatesSchema,
  profilePatchSchema,
  refreshSessionSchema,
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
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/sign-out',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  '/auth/refresh',
  '/auth/session',
]);
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const uploadSessions = new Map<string, { createdAt: string }>();

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

  if (mergeUserProfile(state, user)) {
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
app.use(express.json());
if (!usesSupabaseUploads()) {
  app.use('/uploads', express.static(getUploadsDir()));
}
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
    if (publicPaths.has(request.path)) {
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
  await persistAppData(appData);
}

async function saveRequestState(response: Response) {
  const authUserId = getRequestUserId(response);
  const state = getRequestState(response);

  if (authUserId) {
    await persistUserAppData(authUserId, state);
    return;
  }

  await persistAppData(state);
}

async function deleteDocumentFilesForState(state: AppData) {
  await Promise.all(state.documents.map((document) => deleteStoredDocument(document.file_key)));
}

app.get('/api/v1/health', (_request, response) => {
  response.json({
    ok: true,
    vehicle_enquiry: getDvlaVesTargetLabel(),
    mot: getDvsaMotTargetLabel(),
    storage: getStorageTargetLabel(),
    uploads: getUploadTargetLabel(),
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

  const { email } = parsed.data;

  appData.session = createSession();
  appData.user.email = email;
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

  const { first_name, last_name, email } = parsed.data;

  appData.user = {
    ...appData.user,
    first_name,
    last_name,
    email,
  };
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
  }

  response.status(200).json({
    message: 'Password updated.',
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
  });
});

app.patch('/api/v1/me', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(profilePatchSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  if (usesSupabaseAuth() && parsed.data.email && parsed.data.email !== state.user.email) {
    response.status(400).json(apiError('Email changes are not supported yet when Supabase auth is enabled.'));
    return;
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

  response.status(201).json({
    upload: {
      upload_id: generateId('replace'),
      replaces_document_id: document.id,
      status: 'ready',
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

app.post('/api/v1/trip-checks', asyncRoute(async (request, response) => {
  const state = getRequestState(response);
  const parsed = parseBody(tripCheckSchema, request.body);

  if (!parsed.success) {
    response.status(400).json(apiError(parsed.message, parsed.fields));
    return;
  }

  const { vehicle_id, input_type, destination_query, saved_zone_id, persist_result } = parsed.data;

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

  const compliance = vehicle.fuel_type.toLowerCase().includes('diesel') ? 'charge_risk' : 'compliant';
  const zone = state.zones.find((entry) => entry.id === saved_zone_id) ?? state.zones[0];
  const destinationLabel = destination_query ?? zone.name;
  const freshness = new Date().toISOString();
  const parkingSuggestions: ParkingSuggestion[] = [];

  const tripCheck: TripCheckRecord = {
    id: generateId('trip'),
    vehicle_id,
    input_type,
    destination_query,
    saved_zone_id,
    compliance_status: compliance,
    charge_amount_label: compliance === 'charge_risk' ? zone.charge_amount_label : '£0.00',
    confidence_label: 'medium',
    freshness_at: freshness,
    source_name: 'trip-check-beta',
    parking_suggestions: parkingSuggestions,
  };

  if (persist_result) {
    state.trip_checks.unshift(tripCheck);
    await saveRequestState(response);
  }
  writeAuditEntry('trip_check.ran', { trip_check_id: tripCheck.id, vehicle_id });

  response.status(201).json({
    trip_check: tripCheck,
    degraded: {
      code: 'parking_provider_pending',
      message: 'Parking suggestions are unavailable until a parking data provider is connected.',
    },
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

app.get('/api/v1/support/content', (_request, response) => {
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
        body: `Vehicle enquiry: ${getDvlaVesTargetLabel()}. MOT history: ${getDvsaMotTargetLabel()}. Parking provider: pending contract/API access.`,
      },
    ],
  });
});

app.post('/api/v1/support/export-request', (_request, response) => {
  response.status(202).json({
    message: 'Export request queued.',
  });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error('DriveReady backend error', error);

  if (response.headersSent) {
    return;
  }

  response.status(500).json(apiError('Internal server error.'));
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`DriveReady backend listening on http://localhost:${port}`);
    console.log(`DriveReady storage: ${getStorageTargetLabel()}`);
  });
}
