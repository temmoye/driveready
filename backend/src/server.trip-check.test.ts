import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tempDir = '';
let app: Awaited<typeof import('./server.js')>['app'];

const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'driveready-trip-check-'));
  process.env.NODE_ENV = 'test';
  process.env.DRIVEREADY_DATA_FILE = path.join(tempDir, 'app-data.json');
  process.env.DRIVEREADY_AUDIT_FILE = path.join(tempDir, 'audit.log');
  process.env.DRIVEREADY_UPLOAD_DIR = path.join(tempDir, 'uploads');
  process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN = 'mapbox-token';

  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  ({ app } = await import('./server.js'));
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN;

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

describe('Trip Check location routes', () => {
  it('returns backend location suggestions', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            {
              id: 'mapbox.1',
              place_name: 'London Bridge Station, London',
              geometry: {
                coordinates: [-0.0855, 51.5055],
              },
              properties: {
                place_formatted: 'London',
              },
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
    const response = await request(app)
      .get('/api/v1/location-suggestions?q=london%20bridge')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.suggestions).toHaveLength(1);
    expect(response.body.suggestions[0].label).toBe('London Bridge Station, London');
  });

  it('runs a destination trip check using resolved backend location data', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            {
              id: 'mapbox.2',
              place_name: 'Liverpool Street Station, London',
              geometry: {
                coordinates: [-0.0829, 51.5178],
              },
              properties: {
                full_address: 'Liverpool Street Station, London',
              },
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
    const response = await request(app)
      .post('/api/v1/trip-checks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicle_id: 'vehicle-work',
        input_type: 'destination',
        destination_query: 'Liverpool Street Station',
        persist_result: false,
      });

    expect(response.status).toBe(201);
    expect(response.body.trip_check.compliance_status).toBe('charge_risk');
    expect(response.body.trip_check.charge_amount_label).toBe('GBP 12.50 daily charge');
    expect(response.body.matched_zone.name).toBe('London ULEZ');
    expect(response.body.resolved_destination.label).toBe('Liverpool Street Station, London');
    expect(response.body.degraded.map((entry: { code: string }) => entry.code)).toContain('parking_provider_pending');
  });
});
