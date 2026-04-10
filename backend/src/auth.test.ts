import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

describe('updateSupabaseAuthProfile', () => {
  beforeEach(() => {
    process.env.DRIVEREADY_AUTH_BACKEND = 'supabase';
    process.env.DRIVEREADY_STORAGE_BACKEND = 'supabase';
    process.env.DRIVEREADY_SUPABASE_URL = 'https://example.supabase.co';
    process.env.DRIVEREADY_SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
    process.env.DRIVEREADY_SUPABASE_SECRET_KEY = 'secret-key';
    createClientMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DRIVEREADY_AUTH_BACKEND;
    delete process.env.DRIVEREADY_STORAGE_BACKEND;
    delete process.env.DRIVEREADY_SUPABASE_URL;
    delete process.env.DRIVEREADY_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.DRIVEREADY_SUPABASE_SECRET_KEY;
  });

  it('updates Supabase email and name metadata', async () => {
    const authClient = {
      auth: {},
    };
    const updateUserById = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'new@example.com',
          user_metadata: {
            first_name: 'Jamie',
            last_name: 'Driver',
          },
        },
      },
      error: null,
    });
    const adminClient = {
      auth: {
        admin: {
          updateUserById,
        },
      },
    };

    createClientMock
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(adminClient);

    const { updateSupabaseAuthProfile } = await import('./auth.js');
    const result = await updateSupabaseAuthProfile({
      userId: 'user-1',
      existingProfile: {
        id: 'user-1',
        first_name: 'James',
        last_name: 'Harrington',
        email: 'old@example.com',
        phone: '+44 7000 111222',
        address_line: '1 Test Street',
      },
      email: 'new@example.com',
      first_name: 'Jamie',
      last_name: 'Driver',
    });

    expect(updateUserById).toHaveBeenCalledWith('user-1', {
      email: 'new@example.com',
      email_confirm: true,
      user_metadata: {
        first_name: 'Jamie',
        last_name: 'Driver',
      },
    });
    expect(result).toEqual({
      id: 'user-1',
      first_name: 'Jamie',
      last_name: 'Driver',
      email: 'new@example.com',
      phone: '+44 7000 111222',
      address_line: '1 Test Street',
    });
  });

  it('returns the existing profile when nothing changed', async () => {
    const authClient = {
      auth: {},
    };
    const updateUserById = vi.fn();
    const adminClient = {
      auth: {
        admin: {
          updateUserById,
        },
      },
    };

    createClientMock
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(adminClient);

    const { updateSupabaseAuthProfile } = await import('./auth.js');
    const existingProfile = {
      id: 'user-1',
      first_name: 'James',
      last_name: 'Harrington',
      email: 'james@example.com',
      phone: '+44 7000 111222',
      address_line: '1 Test Street',
    };
    const result = await updateSupabaseAuthProfile({
      userId: 'user-1',
      existingProfile,
      email: 'james@example.com',
      first_name: 'James',
      last_name: 'Harrington',
    });

    expect(updateUserById).not.toHaveBeenCalled();
    expect(result).toEqual(existingProfile);
  });
});
