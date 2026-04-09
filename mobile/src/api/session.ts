import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SessionState } from './types';

const SESSION_STATE_KEY = 'driveready.session-state';

let sessionState: SessionState | null = null;

export function getStoredSession() {
  return sessionState;
}

export function getSessionToken() {
  return sessionState?.token ?? null;
}

export async function loadStoredSession() {
  const raw = await AsyncStorage.getItem(SESSION_STATE_KEY);

  if (!raw) {
    sessionState = null;
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SessionState;
    sessionState = parsed?.token ? parsed : null;
  } catch {
    sessionState = null;
  }

  if (!sessionState) {
    await AsyncStorage.removeItem(SESSION_STATE_KEY);
  }

  return sessionState;
}

export async function storeSession(session: SessionState) {
  sessionState = session;
  await AsyncStorage.setItem(SESSION_STATE_KEY, JSON.stringify(session));
}

export async function clearStoredSession() {
  sessionState = null;
  await AsyncStorage.removeItem(SESSION_STATE_KEY);
}
