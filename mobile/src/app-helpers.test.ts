import { describe, expect, it, vi } from 'vitest';

import {
  energyTypeFromFuelType,
  getPasswordRecoveryFromUrl,
  registerForPushNotifications,
  resolvePasswordResetSession,
  resolveRecoveryExpiry,
} from './app-helpers';

describe('resolveRecoveryExpiry', () => {
  it('prefers expires_at when present', () => {
    const params = new URLSearchParams({
      expires_at: '1715798400',
      expires_in: '120',
    });

    expect(resolveRecoveryExpiry(params, 1_700_000_000_000)).toBe('2024-05-15T18:40:00.000Z');
  });

  it('falls back to expires_in and then the default hour window', () => {
    expect(
      resolveRecoveryExpiry(
        new URLSearchParams({
          expires_in: '120',
        }),
        1_700_000_000_000,
      ),
    ).toBe('2023-11-14T22:15:20.000Z');

    expect(resolveRecoveryExpiry(new URLSearchParams(), 1_700_000_000_000)).toBe('2023-11-14T23:13:20.000Z');
  });
});

describe('getPasswordRecoveryFromUrl', () => {
  it('returns a decoded error when the link contains an auth error', () => {
    const parseUrl = vi.fn().mockReturnValue({
      queryParams: {
        error_description: 'Link%20expired',
      },
    });

    expect(getPasswordRecoveryFromUrl('drivereadyuk://reset-password', parseUrl)).toEqual({
      error: 'Link expired',
    });
  });

  it('extracts recovery tokens from the hash fragment', () => {
    const parseUrl = vi.fn().mockReturnValue({
      queryParams: {},
    });

    expect(
      getPasswordRecoveryFromUrl(
        'drivereadyuk://reset-password#type=recovery&access_token=token-123&refresh_token=refresh-456&expires_in=60',
        parseUrl,
      ),
    ).toEqual({
      recovery: {
        access_token: 'token-123',
        refresh_token: 'refresh-456',
        expires_at: expect.any(String),
      },
    });
  });

  it('ignores non-recovery links', () => {
    const parseUrl = vi.fn().mockReturnValue({
      queryParams: {
        access_token: 'token-123',
        type: 'signup',
      },
    });

    expect(getPasswordRecoveryFromUrl('drivereadyuk://welcome', parseUrl)).toBeNull();
  });
});

describe('energyTypeFromFuelType', () => {
  it('maps common fuel types to the expected refuel search', () => {
    expect(energyTypeFromFuelType('Electric')).toBe('electric');
    expect(energyTypeFromFuelType('Diesel')).toBe('diesel');
    expect(energyTypeFromFuelType('Petrol Plug-in Hybrid Electric Vehicle')).toBe('electric');
    expect(energyTypeFromFuelType(undefined)).toBe('petrol');
  });
});

describe('resolvePasswordResetSession', () => {
  it('prefers the backend session when one is returned', () => {
    expect(
      resolvePasswordResetSession(
        {
          session: {
            token: 'fresh-token',
            refresh_token: 'fresh-refresh',
            expires_at: '2026-04-10T10:00:00.000Z',
          },
        },
        {
          access_token: 'fallback-token',
          refresh_token: 'fallback-refresh',
          expires_at: '2026-04-10T09:00:00.000Z',
        },
      ),
    ).toEqual({
      token: 'fresh-token',
      refresh_token: 'fresh-refresh',
      expires_at: '2026-04-10T10:00:00.000Z',
    });
  });

  it('falls back to the recovery link session when the backend only confirms the password', () => {
    expect(
      resolvePasswordResetSession(
        {},
        {
          access_token: 'fallback-token',
          refresh_token: 'fallback-refresh',
          expires_at: '2026-04-10T09:00:00.000Z',
        },
      ),
    ).toEqual({
      token: 'fallback-token',
      refresh_token: 'fallback-refresh',
      expires_at: '2026-04-10T09:00:00.000Z',
    });

    expect(
      resolvePasswordResetSession(
        {},
        {
          access_token: 'fallback-token',
          expires_at: '2026-04-10T09:00:00.000Z',
        },
      ),
    ).toBeNull();
  });
});

describe('registerForPushNotifications', () => {
  it('returns early when permission is denied and does not request a token', async () => {
    const getExpoPushToken = vi.fn();

    await expect(
      registerForPushNotifications({
        getExpoPushToken,
        getPermissions: vi.fn().mockResolvedValue({ status: 'denied' }),
        isDevice: true,
        platform: 'ios',
        requestPermissions: vi.fn().mockResolvedValue({ status: 'denied' }),
      }),
    ).resolves.toEqual({
      permissionState: 'denied',
    });

    expect(getExpoPushToken).not.toHaveBeenCalled();
  });

  it('creates an android channel and requests a token when permission is granted', async () => {
    const setAndroidChannel = vi.fn().mockResolvedValue(undefined);

    await expect(
      registerForPushNotifications({
        getExpoPushToken: vi.fn().mockResolvedValue('ExponentPushToken[test-token]'),
        getPermissions: vi.fn().mockResolvedValue({ status: 'granted' }),
        isDevice: true,
        platform: 'android',
        projectId: 'project-123',
        requestPermissions: vi.fn(),
        setAndroidChannel,
      }),
    ).resolves.toEqual({
      permissionState: 'granted',
      platform: 'android',
      token: 'ExponentPushToken[test-token]',
    });

    expect(setAndroidChannel).toHaveBeenCalledTimes(1);
  });
});
