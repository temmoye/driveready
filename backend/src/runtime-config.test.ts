import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('runtime config validation', () => {
  it('throws on missing production secrets and base URL', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DRIVEREADY_PUBLIC_BASE_URL = 'http://localhost:4000';
    process.env.DRIVEREADY_NOTIFICATION_PROVIDER = 'expo';
    process.env.DRIVEREADY_REMINDER_RUNNER_ENABLED = 'true';

    const runtimeConfig = await import('./runtime-config.js');

    expect(() => runtimeConfig.validateRuntimeConfigOrThrow()).toThrow(/Production configuration is incomplete/);
  });

  it('returns warnings for optional pending providers', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DRIVEREADY_PUBLIC_BASE_URL = 'https://api.driveready.xyz';
    process.env.DRIVEREADY_JOB_SECRET = 'job-secret';
    process.env.DRIVEREADY_FILE_URL_SECRET = 'file-secret';
    process.env.DRIVEREADY_AUTH_BACKEND = 'supabase';
    process.env.DRIVEREADY_STORAGE_BACKEND = 'supabase';
    process.env.DRIVEREADY_UPLOAD_BACKEND = 'supabase';
    process.env.DRIVEREADY_AUTH_REDIRECT_ALLOWLIST = 'drivereadyuk://';

    const runtimeConfig = await import('./runtime-config.js');
    const checks = runtimeConfig.getRuntimeConfigChecks();

    expect(checks.some((entry) => entry.code === 'parking_provider_pending' && entry.level === 'warning')).toBe(true);
    expect(checks.some((entry) => entry.code === 'ev_tariff_provider_missing' && entry.level === 'warning')).toBe(true);
  });
});
