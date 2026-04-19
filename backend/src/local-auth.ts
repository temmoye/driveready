import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type { LocalAuthState } from './types.js';

const DEFAULT_LOCAL_PASSWORD = 'demo1234';
const KEY_LENGTH = 64;

function createHash(password: string, salt: string) {
  return scryptSync(password, salt, KEY_LENGTH);
}

export function createLocalAuthState(password: string): LocalAuthState {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash(password, salt);

  return {
    password_hash: hash.toString('hex'),
    password_salt: salt,
    password_updated_at: new Date().toISOString(),
  };
}

export function defaultLocalAuthState() {
  return createLocalAuthState(DEFAULT_LOCAL_PASSWORD);
}

export function verifyLocalPassword(password: string, auth: LocalAuthState | undefined) {
  if (!auth?.password_hash || !auth.password_salt) {
    return false;
  }

  const expected = Buffer.from(auth.password_hash, 'hex');
  const actual = createHash(password, auth.password_salt);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
