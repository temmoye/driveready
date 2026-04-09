# DriveReady Backend Deployment

This backend is ready to run as a single Node service behind a public API host such as `api.driveready.xyz`.

## Recommended target

- Backend host: Railway, Render, Fly.io, or any Node host that supports persistent environment variables
- Public API URL: `https://api.driveready.xyz`
- Mobile API base URL: `https://api.driveready.xyz/api/v1`

There is no separate web frontend in this repo today. You do not need `app.driveready.xyz` yet unless you later add a landing page or web app.

## Railway deployment

Use the `backend` directory as the Railway service root. This repo now includes [backend/railway.json](/Users/tayo/Documents/laptop improvements/creating with ai/Digital Trust Product/Testing gpt 5.4/Ideas generation/backend/railway.json), so Railway will:

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
DRIVEREADY_UPLOAD_BACKEND=supabase

DRIVEREADY_SUPABASE_URL=...
DRIVEREADY_SUPABASE_PUBLISHABLE_KEY=...
DRIVEREADY_SUPABASE_SECRET_KEY=...
DRIVEREADY_SUPABASE_UPLOAD_BUCKET=driveready-documents

DRIVEREADY_DVLA_VES_BASE_URL=https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry
DRIVEREADY_DVLA_VES_API_KEY=...
```

Add the DVSA MOT variables later when DVSA approves access.

For fuel/charging discovery, set `DRIVEREADY_MAPBOX_ACCESS_TOKEN` on the backend. This enables origin geocoding and fallback nearby-station POI lookup.

Petrol/diesel prices use supported UK retailer-published price feeds by default. Override the comma-separated feed list with `DRIVEREADY_UK_FUEL_PRICE_FEED_URLS` if you want to pin or extend sources. Charging tariffs still require a dedicated charging-price provider.

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
```

For live API testing:

```env
EXPO_PUBLIC_API_BASE_URL=https://api.driveready.xyz/api/v1
```

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
2. Sign up a fresh account from the app
3. Sign in
4. Request password reset
5. Add a vehicle
6. Refresh DVLA vehicle data
7. Upload a document
