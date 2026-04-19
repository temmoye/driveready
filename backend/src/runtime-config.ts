interface RuntimeConfigCheck {
  code: string;
  level: 'error' | 'warning';
  message: string;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function isProduction() {
  return trimValue(process.env.NODE_ENV).toLowerCase() === 'production';
}

function isTruthy(value?: string) {
  return trimValue(value).toLowerCase() === 'true';
}

function requiresStrictValidation() {
  return isProduction() || isTruthy(process.env.DRIVEREADY_STRICT_STARTUP);
}

function usesSupabaseAuth() {
  return trimValue(process.env.DRIVEREADY_AUTH_BACKEND).toLowerCase() === 'supabase';
}

function usesLocalStorage() {
  const configured = trimValue(process.env.DRIVEREADY_STORAGE_BACKEND).toLowerCase();
  return !configured || configured === 'local';
}

function usesLocalUploads() {
  const configured = trimValue(process.env.DRIVEREADY_UPLOAD_BACKEND).toLowerCase();
  return !configured || configured === 'local';
}

function usesExpoNotifications() {
  return trimValue(process.env.DRIVEREADY_NOTIFICATION_PROVIDER).toLowerCase() === 'expo';
}

function publicBaseUrl() {
  return trimValue(process.env.DRIVEREADY_PUBLIC_BASE_URL);
}

function hasHttpsPublicBaseUrl() {
  return publicBaseUrl().startsWith('https://');
}

function usesLoopbackPublicBaseUrl() {
  return /localhost|127\.0\.0\.1/i.test(publicBaseUrl());
}

function hasRedirectAllowlist() {
  return trimValue(process.env.DRIVEREADY_AUTH_REDIRECT_ALLOWLIST).length > 0;
}

function hasJobSecret() {
  return trimValue(process.env.DRIVEREADY_JOB_SECRET).length > 0;
}

function hasLocalFileSecret() {
  return trimValue(process.env.DRIVEREADY_FILE_URL_SECRET).length > 0;
}

function hasMapboxToken() {
  return (
    trimValue(process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN).length > 0 ||
    trimValue(process.env.MAPBOX_ACCESS_TOKEN).length > 0
  );
}

function hasDvlaSetup() {
  return trimValue(process.env.DRIVEREADY_DVLA_VES_API_KEY).length > 0;
}

function hasDvsaSetup() {
  return [
    trimValue(process.env.DRIVEREADY_DVSA_MOT_TOKEN_URL),
    trimValue(process.env.DRIVEREADY_DVSA_MOT_CLIENT_ID),
    trimValue(process.env.DRIVEREADY_DVSA_MOT_CLIENT_SECRET),
    trimValue(process.env.DRIVEREADY_DVSA_MOT_API_KEY),
  ].every((value) => value.length > 0);
}

function hasEvTariffProvider() {
  return [
    trimValue(process.env.DRIVEREADY_EV_TARIFF_PROVIDER),
    trimValue(process.env.DRIVEREADY_EV_TARIFF_API_BASE_URL),
    trimValue(process.env.DRIVEREADY_EV_TARIFF_API_KEY),
  ].every((value) => value.length > 0);
}

export function getRuntimeConfigChecks(): RuntimeConfigCheck[] {
  const checks: RuntimeConfigCheck[] = [];
  const production = isProduction();
  const strict = requiresStrictValidation();

  if (strict && (!publicBaseUrl() || usesLoopbackPublicBaseUrl())) {
    checks.push({
      code: 'public_base_url_missing',
      level: 'error',
      message: 'Set DRIVEREADY_PUBLIC_BASE_URL to the public HTTPS API origin before starting production.',
    });
  } else if (strict && !hasHttpsPublicBaseUrl()) {
    checks.push({
      code: 'public_base_url_not_https',
      level: 'error',
      message: 'DRIVEREADY_PUBLIC_BASE_URL must use HTTPS in production.',
    });
  }

  if (strict && !hasJobSecret()) {
    checks.push({
      code: 'job_secret_missing',
      level: 'error',
      message: 'Set DRIVEREADY_JOB_SECRET before exposing internal job endpoints in production.',
    });
  }

  if (strict && usesLocalUploads() && !hasLocalFileSecret()) {
    checks.push({
      code: 'file_url_secret_missing',
      level: 'error',
      message: 'Set DRIVEREADY_FILE_URL_SECRET when using local uploads in production.',
    });
  }

  if (strict && usesSupabaseAuth() && !hasRedirectAllowlist()) {
    checks.push({
      code: 'auth_redirect_allowlist_missing',
      level: 'error',
      message: 'Set DRIVEREADY_AUTH_REDIRECT_ALLOWLIST for Supabase auth password reset and email flows.',
    });
  }

  if (production && trimValue(process.env.DRIVEREADY_AUTH_BACKEND).toLowerCase() !== 'supabase') {
    checks.push({
      code: 'local_auth_in_production',
      level: 'warning',
      message: 'Production is configured without Supabase auth. This is acceptable only for a tightly controlled single-instance deployment.',
    });
  }

  if (production && usesLocalStorage()) {
    checks.push({
      code: 'local_storage_in_production',
      level: 'warning',
      message: 'Production is using local file storage. Verify the host has durable disk and single-writer guarantees.',
    });
  }

  if (production && usesLocalUploads()) {
    checks.push({
      code: 'local_uploads_in_production',
      level: 'warning',
      message: 'Production is using local file uploads. Use Supabase storage if you need multi-instance deployment or managed object storage.',
    });
  }

  if (production && !hasMapboxToken()) {
    checks.push({
      code: 'mapbox_not_configured',
      level: 'warning',
      message: 'Mapbox is not configured. Destination search and refuel origin search will degrade.',
    });
  }

  if (production && !hasDvlaSetup()) {
    checks.push({
      code: 'dvla_not_configured',
      level: 'warning',
      message: 'DVLA VES is not configured. Live vehicle enquiry will be unavailable.',
    });
  }

  if (production && !hasDvsaSetup()) {
    checks.push({
      code: 'dvsa_not_configured',
      level: 'warning',
      message: 'DVSA MOT is not configured. Live MOT history refresh will be unavailable.',
    });
  }

  if (production && usesExpoNotifications() && !isTruthy(process.env.DRIVEREADY_REMINDER_RUNNER_ENABLED)) {
    checks.push({
      code: 'reminder_runner_disabled',
      level: 'warning',
      message: 'Expo notifications are enabled but the reminder runner is disabled. Push reminders will not dispatch automatically.',
    });
  }

  if (production && !hasEvTariffProvider()) {
    checks.push({
      code: 'ev_tariff_provider_missing',
      level: 'warning',
      message: 'An EV tariff provider is not configured. Electric charger pricing will stay in provider-pending mode.',
    });
  }

  checks.push({
    code: 'parking_provider_pending',
    level: 'warning',
    message: 'Parking suggestions are intentionally disabled until a parking provider is integrated.',
  });

  return checks;
}

export function validateRuntimeConfigOrThrow() {
  if (!requiresStrictValidation()) {
    return;
  }

  const errors = getRuntimeConfigChecks().filter((entry) => entry.level === 'error');

  if (errors.length === 0) {
    return;
  }

  throw new Error(
    `Production configuration is incomplete:\n${errors.map((entry) => `- [${entry.code}] ${entry.message}`).join('\n')}`,
  );
}
