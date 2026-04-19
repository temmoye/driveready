# DriveReady Launch Checklist

This repo is production-ready for launch once the environment and distribution steps below are completed.

## Code and config already handled

- Backend deploy config exists in `backend/DEPLOYMENT.md`
- Mobile EAS build config exists in `mobile/eas.json`
- Mobile deployment steps exist in `mobile/DEPLOYMENT.md`
- CI runs backend and mobile tests
- Backend now fails fast in production when critical env is missing

## Manual launch steps

1. Set production backend env from `backend/.env.example` and `backend/DEPLOYMENT.md`
2. Run the normalized Supabase SQL from `backend/supabase/driveready_projection.sql`
3. Deploy the backend and confirm the smoke tests in `backend/DEPLOYMENT.md`
4. Set mobile env from `mobile/.env.example`
5. Build an Android `preview` artifact for same-day installs, or `production` artifacts for store submission

## Apple App Store steps that still require your account

1. Join the Apple Developer Program
2. Create the app record in App Store Connect with bundle id `com.tayo.drivereadyuk`
3. Get the Apple ID / `ascAppId` from App Store Connect
4. Configure Expo/EAS auth and App Store Connect API access
5. Push store metadata from `mobile/store.config.js`
6. Build and submit the iOS production build
7. Complete App Privacy answers in App Store Connect and submit for Apple review

Public App Store release is not instant. Even after submission, Apple review and release settings still control when the app becomes available.

## Known intentional gaps

- Parking provider integration is still pending
- EV charger pricing remains provider-pending until a live tariff source is configured
