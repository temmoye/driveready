import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tempDir = '';
let app: Awaited<typeof import('./server.js')>['app'];

const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'driveready-dvla-'));
  process.env.NODE_ENV = 'test';
  process.env.DRIVEREADY_DATA_FILE = path.join(tempDir, 'app-data.json');
  process.env.DRIVEREADY_AUDIT_FILE = path.join(tempDir, 'audit.log');
  process.env.DRIVEREADY_UPLOAD_DIR = path.join(tempDir, 'uploads');
  process.env.DRIVEREADY_DVLA_VES_BASE_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry';
  process.env.DRIVEREADY_DVLA_VES_API_KEY = 'dvla-api-key';

  delete process.env.DRIVEREADY_DVSA_MOT_BASE_URL;
  delete process.env.DRIVEREADY_DVSA_MOT_TOKEN_URL;
  delete process.env.DRIVEREADY_DVSA_MOT_CLIENT_ID;
  delete process.env.DRIVEREADY_DVSA_MOT_CLIENT_SECRET;
  delete process.env.DRIVEREADY_DVSA_MOT_API_KEY;
  delete process.env.DRIVEREADY_DVSA_MOT_SCOPE;

  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  ({ app } = await import('./server.js'));
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.DRIVEREADY_DVLA_VES_BASE_URL;
  delete process.env.DRIVEREADY_DVLA_VES_API_KEY;

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

describe('DVLA VES enrich route', () => {
  it('hydrates vehicle tax and enquiry metadata from the DVLA response', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          registrationNumber: 'LR19ABC',
          taxStatus: 'Taxed',
          taxDueDate: '2026-03-01',
          motStatus: 'Valid',
          motExpiryDate: '2026-02-17',
          make: 'LAND ROVER',
          fuelType: 'PETROL',
          colour: 'BLACK',
          yearOfManufacture: 2019,
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
    expect(enrich.body.source_name).toBe('dvla-vehicle-enquiry-service');
    expect(enrich.body.mot_tests_synced).toBe(0);
    expect(enrich.body.vehicle.fuel_type).toBe('Petrol');
    expect(enrich.body.vehicle.tax_due_at).toBe('2026-03-01');
    expect(enrich.body.vehicle.mot_due_at).toBe('2026-02-17');
    expect(enrich.body.vehicle.dvla_ves.tax_status).toBe('Taxed');
    expect(enrich.body.vehicle.dvla_ves.colour).toBe('Black');
    expect(enrich.body.vehicle.dvla_ves.registration_checked).toBe('LR19ABC');

    const detail = await request(app)
      .get('/api/v1/vehicles/vehicle-family')
      .set('Authorization', `Bearer ${token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.vehicle.dvla_ves.mot_status).toBe('Valid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
