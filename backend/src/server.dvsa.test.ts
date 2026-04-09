import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tempDir = '';
let app: Awaited<typeof import('./server.js')>['app'];

const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'driveready-dvsa-'));
  process.env.NODE_ENV = 'test';
  process.env.DRIVEREADY_DATA_FILE = path.join(tempDir, 'app-data.json');
  process.env.DRIVEREADY_AUDIT_FILE = path.join(tempDir, 'audit.log');
  process.env.DRIVEREADY_UPLOAD_DIR = path.join(tempDir, 'uploads');
  process.env.DRIVEREADY_DVSA_MOT_BASE_URL = 'https://history.mot.api.gov.uk';
  process.env.DRIVEREADY_DVSA_MOT_TOKEN_URL = 'https://login.microsoftonline.com/example-tenant/oauth2/v2.0/token';
  process.env.DRIVEREADY_DVSA_MOT_CLIENT_ID = 'client-id';
  process.env.DRIVEREADY_DVSA_MOT_CLIENT_SECRET = 'client-secret';
  process.env.DRIVEREADY_DVSA_MOT_API_KEY = 'api-key';
  process.env.DRIVEREADY_DVSA_MOT_SCOPE = 'https://tapi.dvsa.gov.uk/.default';

  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  ({ app } = await import('./server.js'));
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.DRIVEREADY_DVSA_MOT_BASE_URL;
  delete process.env.DRIVEREADY_DVSA_MOT_TOKEN_URL;
  delete process.env.DRIVEREADY_DVSA_MOT_CLIENT_ID;
  delete process.env.DRIVEREADY_DVSA_MOT_CLIENT_SECRET;
  delete process.env.DRIVEREADY_DVSA_MOT_API_KEY;
  delete process.env.DRIVEREADY_DVSA_MOT_SCOPE;

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

describe('DVSA MOT enrich route', () => {
  it('hydrates vehicle MOT metadata and history from the DVSA response', async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'dvsa-access-token',
            expires_in: 1199,
            token_type: 'Bearer',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            registration: 'LR19ABC',
            make: 'Ford',
            model: 'Focus',
            fuelType: 'Petrol',
            primaryColour: 'Blue',
            registrationDate: '2019-06-01',
            firstUsedDate: '2019-06-10',
            hasOutstandingRecall: 'No',
            motTests: [
              {
                registrationAtTimeOfTest: 'LR19ABC',
                completedDate: '2025-02-17T09:17:46.000Z',
                testResult: 'PASSED',
                expiryDate: '2026-02-17',
                odometerValue: '45210',
                odometerUnit: 'MI',
                odometerResultType: 'READ',
                motTestNumber: '123456789012',
                dataSource: 'DVSA',
                defects: [
                  {
                    text: 'Nearside front tyre worn close to legal limit',
                    type: 'ADVISORY',
                    dangerous: false,
                  },
                ],
              },
              {
                registrationAtTimeOfTest: 'LR19ABC',
                completedDate: '2024-02-15T08:00:00.000Z',
                testResult: 'PASSED',
                expiryDate: '2025-02-17',
                odometerValue: '38900',
                odometerUnit: 'MI',
                odometerResultType: 'READ',
                motTestNumber: '987654321098',
                dataSource: 'DVSA',
                defects: [],
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      );

    const token = await signInAndGetToken();
    const enrich = await request(app)
      .post('/api/v1/vehicles/vehicle-family/enrich')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(enrich.status).toBe(200);
    expect(enrich.body.source_name).toBe('dvsa-mot-history-api');
    expect(enrich.body.mot_tests_synced).toBe(2);
    expect(enrich.body.vehicle.make_model).toBe('Ford Focus');
    expect(enrich.body.vehicle.fuel_type).toBe('Petrol');
    expect(enrich.body.vehicle.mot_due_at).toBe('2026-02-17');
    expect(enrich.body.vehicle.dvsa_mot.recall_status).toBe('No');
    expect(enrich.body.vehicle.dvsa_mot.test_count).toBe(2);
    expect(enrich.body.vehicle.dvsa_mot.last_test.mot_test_number).toBe('123456789012');

    const detail = await request(app)
      .get('/api/v1/vehicles/vehicle-family')
      .set('Authorization', `Bearer ${token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.service_history.some((entry: { id: string; title: string }) => entry.id.includes('mot-history-vehicle-family') && entry.title === 'MOT passed')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
