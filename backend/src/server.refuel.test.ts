import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tempDir = '';
let app: Awaited<typeof import('./server.js')>['app'];

const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'driveready-refuel-'));
  process.env.NODE_ENV = 'test';
  process.env.DRIVEREADY_DATA_FILE = path.join(tempDir, 'app-data.json');
  process.env.DRIVEREADY_AUDIT_FILE = path.join(tempDir, 'audit.log');
  process.env.DRIVEREADY_UPLOAD_DIR = path.join(tempDir, 'uploads');
  process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN = 'mapbox-token';
  process.env.DRIVEREADY_UK_FUEL_PRICE_FEED_URLS = 'https://fuel.example/feed-a.json,https://fuel.example/feed-b.json';

  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  ({ app } = await import('./server.js'));
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN;
  delete process.env.DRIVEREADY_UK_FUEL_PRICE_FEED_URLS;

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

async function resetRefuelState() {
  const { resetRefuelCachesForTest } = await import('./refuel.js');
  resetRefuelCachesForTest();
}

describe('Refuel search route', () => {
  it('returns retailer-published fuel prices sorted by cheapest', async () => {
    await resetRefuelState();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                id: 'origin-leeds',
                geometry: {
                  coordinates: [-1.548567, 53.801277],
                },
                properties: {
                  full_address: 'Leeds Station, Leeds',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            last_updated: '09/04/2026 11:00:00',
            stations: [
              {
                site_id: 'expensive-site',
                brand: 'Example Fuel',
                address: '1 Expensive Road',
                postcode: 'LS1 1AA',
                location: {
                  latitude: 53.802,
                  longitude: -1.55,
                },
                prices: {
                  E10: 159.9,
                  B7: 188.9,
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            last_updated: '09/04/2026 11:05:00',
            stations: [
              {
                site_id: 'cheap-site',
                brand: 'Cheaper Fuel',
                address: '2 Value Street',
                postcode: 'LS2 2BB',
                location: {
                  latitude: 53.81,
                  longitude: -1.56,
                },
                prices: {
                  E10: 149.9,
                  B7: 181.9,
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
      .post('/api/v1/refuel-options')
      .set('Authorization', `Bearer ${token}`)
      .send({
        energy_type: 'petrol',
        origin_query: 'Leeds station',
        sort_by: 'cheapest',
      });

    expect(response.status).toBe(200);
    expect(response.body.search.price_status).toBe('live');
    expect(response.body.stations).toHaveLength(2);
    expect(response.body.stations[0].label).toContain('Cheaper Fuel');
    expect(response.body.stations[0].price_label).toContain('149.9p/L E10');
    expect(response.body.stations[0].price_is_available).toBe(true);
    expect(response.body.degraded).toEqual([]);
  });

  it('returns retailer-published diesel prices sorted by cheapest', async () => {
    await resetRefuelState();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                id: 'origin-leeds',
                geometry: {
                  coordinates: [-1.548567, 53.801277],
                },
                properties: {
                  full_address: 'Leeds Station, Leeds',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stations: [
              {
                site_id: 'premium-diesel-site',
                brand: 'Premium Diesel',
                address: '1 Expensive Road',
                postcode: 'LS1 1AA',
                location: {
                  latitude: 53.802,
                  longitude: -1.55,
                },
                prices: {
                  B7: 191.9,
                  SDV: 205.9,
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stations: [
              {
                site_id: 'cheap-diesel-site',
                brand: 'Cheaper Diesel',
                address: '2 Value Street',
                postcode: 'LS2 2BB',
                location: {
                  latitude: 53.81,
                  longitude: -1.56,
                },
                prices: {
                  B7: 181.9,
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
      .post('/api/v1/refuel-options')
      .set('Authorization', `Bearer ${token}`)
      .send({
        energy_type: 'diesel',
        origin_query: 'Leeds station',
        sort_by: 'cheapest',
      });

    expect(response.status).toBe(200);
    expect(response.body.search.price_status).toBe('live');
    expect(response.body.stations[0].label).toContain('Cheaper Diesel');
    expect(response.body.stations[0].price_label).toContain('181.9p/L B7');
  });

  it('returns nearest electric chargers while tariff pricing is still pending', async () => {
    await resetRefuelState();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                id: 'origin-leeds',
                geometry: {
                  coordinates: [-1.548567, 53.801277],
                },
                properties: {
                  full_address: 'Leeds Station, Leeds',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                id: 'charger-fast',
                properties: {
                  name: 'Fastned Leeds',
                  full_address: 'A1(M) Services, Leeds',
                  distance: 1200,
                  mapbox_id: 'charger-fast',
                },
                geometry: {
                  coordinates: [-1.56, 53.81],
                },
              },
              {
                id: 'charger-slow',
                properties: {
                  name: 'Pod Point Retail Park',
                  full_address: 'Retail Park, Leeds',
                  distance: 2400,
                  mapbox_id: 'charger-slow',
                },
                geometry: {
                  coordinates: [-1.57, 53.82],
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
      .post('/api/v1/refuel-options')
      .set('Authorization', `Bearer ${token}`)
      .send({
        energy_type: 'electric',
        origin_query: 'Leeds station',
        sort_by: 'cheapest',
      });

    expect(response.status).toBe(200);
    expect(response.body.search.price_status).toBe('provider_pending');
    expect(response.body.stations).toHaveLength(2);
    expect(response.body.stations[0].label).toContain('Fastned Leeds');
    expect(response.body.stations[0].price_is_available).toBe(false);
    expect(response.body.degraded.map((entry: { code: string }) => entry.code)).toContain('ev_tariff_provider_pending');
  });

  it('returns live electric tariffs when a tariff provider is configured', async () => {
    process.env.DRIVEREADY_EV_TARIFF_PROVIDER = 'drive-tariffs';
    process.env.DRIVEREADY_EV_TARIFF_API_BASE_URL = 'https://tariffs.example';
    process.env.DRIVEREADY_EV_TARIFF_API_KEY = 'tariff-key';

    await resetRefuelState();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                id: 'origin-leeds',
                geometry: {
                  coordinates: [-1.548567, 53.801277],
                },
                properties: {
                  full_address: 'Leeds Station, Leeds',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                id: 'charger-fast',
                properties: {
                  name: 'Fastned Leeds',
                  full_address: 'A1(M) Services, Leeds',
                  distance: 1200,
                  mapbox_id: 'charger-fast',
                },
                geometry: {
                  coordinates: [-1.56, 53.81],
                },
              },
              {
                id: 'charger-slow',
                properties: {
                  name: 'Pod Point Retail Park',
                  full_address: 'Retail Park, Leeds',
                  distance: 2400,
                  mapbox_id: 'charger-slow',
                },
                geometry: {
                  coordinates: [-1.57, 53.82],
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tariffs: [
              {
                station_id: 'charger-fast',
                price_pence_per_kwh: 59,
                connector_summary: 'CCS up to 150kW',
                updated_at: '2026-04-09T11:10:00.000Z',
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
      .post('/api/v1/refuel-options')
      .set('Authorization', `Bearer ${token}`)
      .send({
        energy_type: 'electric',
        origin_query: 'Leeds station',
        sort_by: 'cheapest',
      });

    delete process.env.DRIVEREADY_EV_TARIFF_PROVIDER;
    delete process.env.DRIVEREADY_EV_TARIFF_API_BASE_URL;
    delete process.env.DRIVEREADY_EV_TARIFF_API_KEY;

    expect(response.status).toBe(200);
    expect(response.body.search.price_status).toBe('live');
    expect(response.body.stations[0].label).toContain('Fastned Leeds');
    expect(response.body.stations[0].price_is_available).toBe(true);
    expect(response.body.stations[0].price_label).toContain('59.0p/kWh');
    expect(response.body.degraded).toEqual([
      expect.objectContaining({
        code: 'ev_tariff_provider_partial_match',
      }),
    ]);
  });
});
