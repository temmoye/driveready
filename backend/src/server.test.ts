import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tempDir = '';
let app: Awaited<typeof import('./server.js')>['app'];

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'driveready-backend-'));
  process.env.NODE_ENV = 'test';
  process.env.DRIVEREADY_AUTH_REDIRECT_ALLOWLIST = 'drivereadyuk://,exp://127.0.0.1:8081';
  process.env.DRIVEREADY_DATA_FILE = path.join(tempDir, 'app-data.json');
  process.env.DRIVEREADY_AUDIT_FILE = path.join(tempDir, 'audit.log');
  process.env.DRIVEREADY_UPLOAD_DIR = path.join(tempDir, 'uploads');

  ({ app } = await import('./server.js'));
});

afterAll(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function signInAndGetToken() {
  const signIn = await request(app).post('/api/v1/auth/sign-in').send({
    email: 'james@driveready.uk',
    password: 'demo1234',
  });

  expect(signIn.status).toBe(200);

  return signIn.body.session.token as string;
}

describe('DriveReady backend', () => {
  it('accepts password reset requests for allowed redirect targets', async () => {
    const response = await request(app).post('/api/v1/auth/password-reset/request').send({
      email: 'james@driveready.uk',
      redirect_to: 'drivereadyuk://reset-password',
    });

    expect(response.status).toBe(202);
  });

  it('rejects password reset requests for disallowed redirect targets', async () => {
    const response = await request(app).post('/api/v1/auth/password-reset/request').send({
      email: 'james@driveready.uk',
      redirect_to: 'https://evil.example/reset-password',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Password reset redirect URL is not allowed.');
  });

  it('blocks protected endpoints before sign in', async () => {
    const response = await request(app).get('/api/v1/me');

    expect(response.status).toBe(401);
  });

  it('supports sign in and zone creation with a bearer token', async () => {
    const token = await signInAndGetToken();

    const createZone = await request(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Manchester CAZ',
        route_label: 'Airport',
        charge_amount_label: '£10.00 daily charge',
      });

    expect(createZone.status).toBe(201);
    expect(createZone.body.zone.name).toBe('Manchester CAZ');
  });

  it('creates a vehicle from a registration-only payload', async () => {
    const token = await signInAndGetToken();

    const createVehicle = await request(app)
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        registration_plate: 'AB12 CDE',
      });

    expect(createVehicle.status).toBe(201);
    expect(createVehicle.body.vehicle.registration_plate).toBe('AB12 CDE');
    expect(createVehicle.body.vehicle.nickname).toBe('AB12 CDE');
    expect(createVehicle.body.vehicle.make_model).toBe('Vehicle details pending');
  });

  it('does not fabricate parking suggestions while the parking provider is pending', async () => {
    const token = await signInAndGetToken();

    const tripCheck = await request(app)
      .post('/api/v1/trip-checks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicle_id: 'vehicle-family',
        input_type: 'destination',
        destination_query: 'Leeds station',
        persist_result: false,
      });

    expect(tripCheck.status).toBe(201);
    expect(tripCheck.body.trip_check.parking_suggestions).toEqual([]);
    expect(tripCheck.body.degraded.code).toBe('parking_provider_pending');
  });

  it('creates an upload session and accepts a document file', async () => {
    const token = await signInAndGetToken();

    const uploadInit = await request(app)
      .post('/api/v1/documents/upload-init')
      .set('Authorization', `Bearer ${token}`);

    expect(uploadInit.status).toBe(201);

    const uploadBinary = await request(app)
      .post(`/api/v1/documents/upload-binary/${uploadInit.body.upload.upload_id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('demo pdf content'), 'demo.pdf');

    expect(uploadBinary.status).toBe(201);
    expect(uploadBinary.body.upload.file_name).toBe('demo.pdf');
    expect(uploadBinary.body.upload.file_key).toContain('demo.pdf');
  });

  it('deletes the local account state and clears the current session', async () => {
    const token = await signInAndGetToken();

    const deleteAccount = await request(app)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${token}`);

    expect(deleteAccount.status).toBe(204);

    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    expect(me.status).toBe(401);
  });
});
