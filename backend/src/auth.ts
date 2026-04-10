import { createClient, type Session, type User } from '@supabase/supabase-js';

import type { SessionState, UserProfile } from './types.js';

type AuthBackend = 'local' | 'supabase';

interface SupabaseAuthConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

export interface AuthenticatedUser {
  id: string;
  profile: UserProfile;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveAuthBackend(): AuthBackend {
  const backend = trimValue(process.env.DRIVEREADY_AUTH_BACKEND).toLowerCase();

  if (!backend) {
    return 'local';
  }

  if (backend === 'local' || backend === 'supabase') {
    return backend;
  }

  throw new Error('DRIVEREADY_AUTH_BACKEND must be either "local" or "supabase".');
}

function resolveSupabaseConfig(): SupabaseAuthConfig | null {
  if (authBackend !== 'supabase') {
    return null;
  }

  const url = trimValue(process.env.DRIVEREADY_SUPABASE_URL) || trimValue(process.env.SUPABASE_URL);
  const publishableKey =
    trimValue(process.env.DRIVEREADY_SUPABASE_PUBLISHABLE_KEY) ||
    trimValue(process.env.SUPABASE_PUBLISHABLE_KEY);
  const secretKey =
    trimValue(process.env.DRIVEREADY_SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SECRET_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    trimValue(process.env.SUPABASE_SERVICE_KEY);

  if (!url || !publishableKey || !secretKey) {
    throw new Error(
      'Supabase auth requires DRIVEREADY_SUPABASE_URL, DRIVEREADY_SUPABASE_PUBLISHABLE_KEY, and DRIVEREADY_SUPABASE_SECRET_KEY.',
    );
  }

  return {
    url,
    publishableKey,
    secretKey,
  };
}

function decodeJwtPayload(token: string) {
  const parts = token.split('.');

  if (parts.length < 2) {
    return null;
  }

  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function expiresAtFromToken(token: string) {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;

  if (!exp) {
    const fallback = new Date();
    fallback.setHours(fallback.getHours() + 1);
    return fallback.toISOString();
  }

  return new Date(exp * 1000).toISOString();
}

function profileFromUser(user: User, existing?: Partial<UserProfile>): UserProfile {
  const metadata = user.user_metadata ?? {};

  return {
    id: user.id,
    first_name:
      typeof metadata.first_name === 'string'
        ? metadata.first_name
        : existing?.first_name ?? '',
    last_name:
      typeof metadata.last_name === 'string'
        ? metadata.last_name
        : existing?.last_name ?? '',
    email: user.email ?? existing?.email ?? '',
    phone: existing?.phone ?? '',
    address_line: existing?.address_line ?? '',
  };
}

function sessionStateFromSession(session: Session): SessionState {
  return {
    token: session.access_token,
    refresh_token: session.refresh_token ?? undefined,
    expires_at: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : expiresAtFromToken(session.access_token),
  };
}

const authBackend = resolveAuthBackend();
const supabaseConfig = resolveSupabaseConfig();
const supabaseAuthClient = supabaseConfig
  ? createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;
const supabaseAdminClient = supabaseConfig
  ? createClient(supabaseConfig.url, supabaseConfig.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;

function requireSupabaseClients() {
  if (!supabaseAuthClient || !supabaseAdminClient) {
    throw new Error('Supabase auth is not configured.');
  }

  if ((process.env.DRIVEREADY_STORAGE_BACKEND ?? 'local').trim().toLowerCase() !== 'supabase') {
    throw new Error('Supabase auth requires DRIVEREADY_STORAGE_BACKEND=supabase.');
  }

  return {
    authClient: supabaseAuthClient,
    adminClient: supabaseAdminClient,
  };
}

export function usesSupabaseAuth() {
  return authBackend === 'supabase';
}

export async function signInWithSupabasePassword(credentials: { email: string; password: string }) {
  const { authClient } = requireSupabaseClients();
  const { data, error } = await authClient.auth.signInWithPassword(credentials);

  if (error || !data.user || !data.session) {
    throw new Error(error?.message ?? 'Unable to sign in.');
  }

  return {
    user: {
      id: data.user.id,
      profile: profileFromUser(data.user),
    },
    session: sessionStateFromSession(data.session),
  };
}

export async function signUpWithSupabasePassword(input: {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}) {
  const { adminClient } = requireSupabaseClients();
  const { error } = await adminClient.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      first_name: input.first_name,
      last_name: input.last_name,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return signInWithSupabasePassword({
    email: input.email,
    password: input.password,
  });
}

export async function refreshSupabaseSession(refreshToken: string) {
  const { authClient } = requireSupabaseClients();
  const { data, error } = await authClient.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.user || !data.session) {
    throw new Error(error?.message ?? 'Unable to refresh session.');
  }

  return {
    user: {
      id: data.user.id,
      profile: profileFromUser(data.user),
    },
    session: sessionStateFromSession(data.session),
  };
}

export async function getSupabaseUserForToken(accessToken: string) {
  const { authClient } = requireSupabaseClients();
  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return {
    id: data.user.id,
    profile: profileFromUser(data.user),
    session: {
      token: accessToken,
      expires_at: expiresAtFromToken(accessToken),
    } satisfies SessionState,
  };
}

export async function requestSupabasePasswordReset(email: string, redirectTo?: string) {
  const { authClient } = requireSupabaseClients();
  const { error } = await authClient.auth.resetPasswordForEmail(
    email,
    redirectTo
      ? {
          redirectTo,
        }
      : undefined,
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function confirmSupabasePasswordReset(input: {
  access_token: string;
  password: string;
}) {
  const { adminClient } = requireSupabaseClients();
  const authUser = await getSupabaseUserForToken(input.access_token);

  if (!authUser) {
    throw new Error('Invalid or expired recovery link.');
  }

  const { error } = await adminClient.auth.admin.updateUserById(authUser.id, {
    password: input.password,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateSupabaseAuthProfile(input: {
  userId: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  existingProfile: UserProfile;
}) {
  const { adminClient } = requireSupabaseClients();
  const updates: {
    email?: string;
    email_confirm?: boolean;
    user_metadata?: {
      first_name: string;
      last_name: string;
    };
  } = {};

  if (input.email && input.email !== input.existingProfile.email) {
    updates.email = input.email;
    updates.email_confirm = true;
  }

  if (
    (input.first_name && input.first_name !== input.existingProfile.first_name) ||
    (input.last_name && input.last_name !== input.existingProfile.last_name)
  ) {
    updates.user_metadata = {
      first_name: input.first_name ?? input.existingProfile.first_name,
      last_name: input.last_name ?? input.existingProfile.last_name,
    };
  }

  if (Object.keys(updates).length === 0) {
    return input.existingProfile;
  }

  const { data, error } = await adminClient.auth.admin.updateUserById(input.userId, updates);

  if (error || !data.user) {
    throw new Error(error?.message ?? 'Unable to update Supabase profile.');
  }

  return profileFromUser(data.user, {
    ...input.existingProfile,
    ...(updates.user_metadata ?? {}),
    ...(updates.email ? { email: updates.email } : {}),
  });
}

export async function deleteSupabaseAuthUser(userId: string) {
  const { adminClient } = requireSupabaseClients();
  const { error } = await adminClient.auth.admin.deleteUser(userId);

  if (error) {
    throw new Error(error.message);
  }
}
