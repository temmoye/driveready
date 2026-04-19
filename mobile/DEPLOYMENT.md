# DriveReady Mobile Deployment

This Expo app is ready for EAS builds.

## One-time setup

1. Install EAS CLI or use `npx eas-cli`.
2. Sign in with the Expo account that owns the project.
3. Run `eas init` inside `mobile` if this app is not already linked to an Expo project.
4. Set `EXPO_PUBLIC_API_BASE_URL` to the live backend URL, for example:

```env
EXPO_PUBLIC_API_BASE_URL=https://api.driveready.xyz/api/v1
EXPO_PUBLIC_EXPO_PROJECT_ID=your-eas-project-id
```

For App Store metadata and in-app legal links, set either:

```env
DRIVEREADY_PUBLIC_DOCS_BASE_URL=https://github.com/temmoye/driveready/blob/main/legal
```

or explicit URLs:

```env
DRIVEREADY_SUPPORT_URL=https://example.com/support
DRIVEREADY_PRIVACY_POLICY_URL=https://example.com/privacy
DRIVEREADY_TERMS_URL=https://example.com/terms
DRIVEREADY_MARKETING_URL=https://example.com
```

## Build profiles

- `development`: local native debugging with a development client
- `preview`: internal install link for same-day testing and limited user rollout
- `production`: store-ready build with auto-incremented build numbers

## Same-day distribution

If you need users on the app today, the fastest path is:

1. Deploy the backend first.
2. Build Android with the internal `preview` profile:

```bash
npx eas-cli build --platform android --profile preview
```

3. Share the generated install link with testers or use Play internal testing.

For iOS, internal device installs require Apple developer provisioning. TestFlight external rollout can take additional Apple review time, so do not assume public iOS availability the same day.

## Personal iPhone development build

For your own device before App Store review:

```bash
npx eas-cli login
npx eas-cli device:create
npm run eas:build:ios:development
```

After install, run:

```bash
npm run start:dev-client
```

Make sure the iPhone and laptop are on the same Wi-Fi network.

## Store builds

Build production artifacts with:

```bash
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios --profile production
```

Submit with:

```bash
npx eas-cli metadata:push --profile production
npx eas-cli submit --platform android --profile production
npx eas-cli submit --platform ios --profile production
```

For iOS, `eas submit` sends the build to App Store Connect. Releasing to the public App Store still depends on Apple review and manual release settings in App Store Connect.

## Release checks

Before building:

1. Confirm the backend health endpoint is green.
2. Confirm sign-up, sign-in, password reset, add vehicle, document upload, and export request against the live API.
3. Confirm push registration works on a physical device.
4. Confirm the app copy does not promise parking suggestions yet.
5. Confirm the app icon, splash, and notification icon are correct in the generated build.
6. Confirm App Store metadata is pushed successfully from `mobile/store.config.js`.
