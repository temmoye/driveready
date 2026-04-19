# DriveReady Backend Deployment

This backend is ready to run as a single Node service behind a public API host such as `api.driveready.xyz`.

## Recommended target

- Backend host: Railway, Render, Fly.io, or any Node host that supports persistent environment variables
- Public API URL: `https://api.driveready.xyz`
- Mobile API base URL: `https://api.driveready.xyz/api/v1`

There is no separate web frontend in this repo today. You do not need `app.driveready.xyz` yet unless you later add a landing page or web app.

## Railway deployment

Use the `backend` directory as the Railway service root. This repo now includes `backend/railway.json`, so Railway will:

- build with `npm run build`
- start with `npm run start`
- health check `/api/v1/health`

You can deploy either way:

1. Railway dashboard
- Create a new project
- Connect the repo
- Set the service root directory to `/backend`

2. Railway CLI
- Run `railway login`
- Run `railway init`
- Run `railway up --path-as-root backend`

## Required environment variables

Set these in the deployment platform:

```env
PORT=4000
DRIVEREADY_TRUST_PROXY=true
DRIVEREADY_PUBLIC_BASE_URL=https://api.driveready.xyz
DRIVEREADY_CORS_ORIGINS=
DRIVEREADY_AUTH_REDIRECT_ALLOWLIST=drivereadyuk://,exp://127.0.0.1:8081,exp://localhost:8081

DRIVEREADY_AUTH_BACKEND=supabase
DRIVEREADY_STORAGE_BACKEND=supabase
DRIVEREADY_SUPABASE_STORAGE_MODE=normalized
DRIVEREADY_UPLOAD_BACKEND=supabase
DRIVEREADY_PROJECTION_ENABLED=false
DRIVEREADY_NOTIFICATION_PROVIDER=expo
DRIVEREADY_JOB_SECRET=...
DRIVEREADY_FILE_URL_SECRET=...
DRIVEREADY_STRICT_STARTUP=true
DRIVEREADY_PUBLIC_DOCS_BASE_URL=https://github.com/temmoye/driveready/blob/codex/driveready-review/legal
DRIVEREADY_SUPPORT_URL=
DRIVEREADY_PRIVACY_POLICY_URL=
DRIVEREADY_TERMS_URL=
DRIVEREADY_REMINDER_RUNNER_ENABLED=true
DRIVEREADY_REMINDER_RUNNER_INTERVAL_MINUTES=15
DRIVEREADY_PROVIDER_REFRESH_RUNNER_ENABLED=true
DRIVEREADY_PROVIDER_REFRESH_INTERVAL_HOURS=24

DRIVEREADY_SUPABASE_URL=...
DRIVEREADY_SUPABASE_PUBLISHABLE_KEY=...
DRIVEREADY_SUPABASE_SECRET_KEY=...
DRIVEREADY_SUPABASE_UPLOAD_BUCKET=driveready-documents

DRIVEREADY_DVLA_VES_BASE_URL=https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry
DRIVEREADY_DVLA_VES_API_KEY=...
```

Add the DVSA MOT variables later when DVSA approves access.

In production, DriveReady now performs fail-fast startup validation for public base URL, job secret, Supabase redirect allowlist, and local upload signing. Keep `DRIVEREADY_STRICT_STARTUP=true`.

DriveReady also exposes support, privacy, and terms links in-app. Set explicit URLs if you have your own public site. If you leave them empty, the deployment can fall back to the public repo-hosted legal pages.

For normalized Supabase storage, run `backend/supabase/driveready_projection.sql`. That file now contains the primary normalized table set, including reminder dispatch history.

Only run `backend/supabase/driveready_state.sql` and `backend/supabase/driveready_user_state.sql` if you intentionally want the older JSON state storage mode.

If you switch an existing deployment from JSON state storage to `DRIVEREADY_SUPABASE_STORAGE_MODE=normalized`, DriveReady will migrate any existing per-user `driveready_user_state` record into the normalized tables the first time that user is loaded.

For fuel/charging discovery and Trip Check destination search, set `DRIVEREADY_MAPBOX_ACCESS_TOKEN` on the backend. The mobile app now expects location suggestions and geocoding to stay server-side.

Petrol/diesel prices use supported UK retailer-published price feeds by default. Override the comma-separated feed list with `DRIVEREADY_UK_FUEL_PRICE_FEED_URLS` if you want to pin or extend sources. Charging tariffs still require a dedicated charging-price provider.

When you choose an EV tariff source, set:

```env
DRIVEREADY_EV_TARIFF_PROVIDER=...
DRIVEREADY_EV_TARIFF_API_BASE_URL=...
DRIVEREADY_EV_TARIFF_API_KEY=...
```

DriveReady now posts nearby charger candidates to `POST {DRIVEREADY_EV_TARIFF_API_BASE_URL}/tariffs` with a bearer token and expects a JSON payload shaped like:

```json
{
  "tariffs": [
    {
      "station_id": "charger-fast",
      "price_pence_per_kwh": 59,
      "connector_summary": "CCS up to 150kW",
      "updated_at": "2026-04-09T11:10:00.000Z"
    }
  ]
}
```

`station_id` should match the station `id` that DriveReady sends in the request body.

Leave `DRIVEREADY_CORS_ORIGINS` empty if the app is only calling the API from native mobile clients. Set it once you add a browser-based client, for example:

```env
DRIVEREADY_CORS_ORIGINS=https://app.driveready.xyz
```

## DNS

Point `api.driveready.xyz` at your backend host:

- Railway/Render/Fly custom domain: use the CNAME or A/AAAA records the provider gives you
- Keep `driveready.xyz` itself unchanged unless you want a marketing site

## Mobile config

For local simulator development:

```env
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000/api/v1
EXPO_PUBLIC_EXPO_PROJECT_ID=
```

For live API testing:

```env
EXPO_PUBLIC_API_BASE_URL=https://api.driveready.xyz/api/v1
EXPO_PUBLIC_EXPO_PROJECT_ID=...
```

Set `EXPO_PUBLIC_EXPO_PROJECT_ID` to your Expo/EAS project ID so the app can register a real Expo push token from the Settings screen.

## Supabase settings to update after deployment

- `Authentication` -> `URL Configuration`
- Keep local redirect URLs for Expo development
- Add any production deep-link or native scheme prefixes you want to allow

If you later ship a standalone mobile build, extend `DRIVEREADY_AUTH_REDIRECT_ALLOWLIST` with that app scheme, for example:

```env
DRIVEREADY_AUTH_REDIRECT_ALLOWLIST=drivereadyuk://,exp://127.0.0.1:8081,exp://localhost:8081
```

## Smoke test after deploy

1. `GET /api/v1/health`
   - Confirm `configuration.errors` is empty
2. Sign up a fresh account from the app
3. Sign in
4. Request password reset
5. Add a vehicle
6. Refresh DVLA vehicle data
7. Upload a document
8. Enable notifications from Settings and confirm a push device is registered
9. `POST /api/v1/internal/jobs/run-reminders` with `x-driveready-job-secret`
10. `POST /api/v1/internal/jobs/refresh-vehicle-data` with `x-driveready-job-secret`
