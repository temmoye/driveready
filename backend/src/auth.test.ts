import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClientMock, fetchMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fetchMock: vi.fn<typeof fetch>(),
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
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DRIVEREADY_AUTH_BACKEND;
    delete process.env.DRIVEREADY_STORAGE_BACKEND;
    delete process.env.DRIVEREADY_SUPABASE_URL;
    delete process.env.DRIVEREADY_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.DRIVEREADY_SUPABASE_SECRET_KEY;
  });

  it('requests a verified Supabase email change through the authenticated user endpoint', async () => {
    createClientMock
      .mockReturnValueOnce({})
      .mockReturnValueOnce({});
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: {
            id: 'user-1',
            email: 'old@example.com',
            user_metadata: {
              first_name: 'Jamie',
              last_name: 'Driver',
            },
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const { updateSupabaseAuthProfile } = await import('./auth.js');
    const result = await updateSupabaseAuthProfile({
      accessToken: 'access-token',
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
      redirectTo: 'drivereadyuk://profile',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe('https://example.supabase.co/auth/v1/user?redirect_to=drivereadyuk%3A%2F%2Fprofile');
    expect(calledOptions).toEqual({
      method: 'PUT',
      headers: {
        apikey: 'publishable-key',
        authorization: 'Bearer access-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'new@example.com',
        data: {
          first_name: 'Jamie',
          last_name: 'Driver',
        },
      }),
    });
    expect(result).toEqual({
      emailChangeRequested: true,
      profile: {
        id: 'user-1',
        first_name: 'Jamie',
        last_name: 'Driver',
        email: 'old@example.com',
        phone: '+44 7000 111222',
        address_line: '1 Test Street',
      },
    });
  });

  it('returns the existing profile when nothing changed', async () => {
    createClientMock
      .mockReturnValueOnce({})
      .mockReturnValueOnce({});

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
      accessToken: 'access-token',
      existingProfile,
      email: 'james@example.com',
      first_name: 'James',
      last_name: 'Harrington',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      emailChangeRequested: false,
      profile: existingProfile,
    });
  });
});
