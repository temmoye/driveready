# DriveReady PRD

## 1. Product Summary
DriveReady is an iOS-first vehicle admin and trip-assist app for UK drivers. It helps users manage MOT, tax, insurance, documents, charge-zone risk, and parking decisions in one place.

This PRD is for the next build phase and assumes a production-oriented implementation rather than a mock-only prototype.

## 2. Build Target
- Platform: iOS-first product with production backend support.
- Build type: production-oriented frontend plus backend-integrated application.
- Backend: required in v1.
- Live integrations: required where data accuracy matters.
- Primary output: a realistic, screen-based product flow backed by real data pipelines and service architecture suitable for production rollout.

## 3. Product Goal
- Help users avoid missed vehicle deadlines.
- Help users keep key vehicle documents organized.
- Help users understand whether a selected vehicle is likely compliant for a charge zone.
- Help users identify lower-cost or free parking near a destination.
- Reduce manual checking across multiple apps and websites.

## 4. Non-Goals For This Build
- True automatic vehicle tracking via telematics or OEM integrations.
- In-app payments for parking or charge zones.
- Full marketplace functionality for garages, insurers, or parking operators.
- Advanced back-office admin tooling.

## 5. Definitions
- `MOT`: UK roadworthiness test required for most vehicles over a certain age.
- `ULEZ`: Ultra Low Emission Zone.
- `CAZ`: Clean Air Zone.
- `Charge-zone compliance`: whether a selected vehicle is considered compliant or at risk of a charge for a given zone.
- `Trip Check`: a user flow where a destination or zone is checked against a selected vehicle and parking suggestions are shown.
- `Real data`: data sourced from backend integrations, public datasets, or trusted providers and normalized by backend services before client use.

## 6. Target Users
- UK drivers with one vehicle.
- UK drivers managing multiple vehicles.
- Users who struggle to remember MOT, tax, insurance, or document deadlines.
- Users who regularly drive into ULEZ/CAZ areas.
- Users who want cheaper or free parking options near destinations.

## 7. V1 Product Assumptions
- Vehicle data starts with user-entered registration and profile data, then is enriched by backend integrations where possible.
- Reminder logic is date-driven from stored vehicle, document, and integration-backed data.
- Charge-zone and parking results must come from real datasets or provider-backed services in production.
- Parking suggestions are advisory and must include confidence/freshness when exact availability is not guaranteed.
- Users manually run a trip check in v1.
- Users can save frequent zones and destinations in v1.
- Background location monitoring is deferred from must-have scope.
- All third-party integrations must be abstracted behind backend services and not called directly from the client.

## 8. Must-Have Scope
- New-user onboarding flow.
- Existing-user sign-in flow.
- Reset-password flow.
- Multi-vehicle garage.
- Add vehicle flow.
- Edit vehicle flow.
- Delete vehicle flow.
- Vehicle detail screen.
- Dashboard with date-driven status summaries.
- Alerts list with open and handled states.
- Alert detail screen with editable reminder settings.
- Document vault.
- Upload document flow.
- Document detail screen.
- Edit, replace, share, and delete document actions.
- Manual Trip Check flow for destination or saved zone.
- Saved zones list and add-zone flow.
- Parking suggestions for a trip check using real backend-sourced data.
- Settings screen.
- Profile screen.
- Permissions screen/state handling for notifications, files, camera, biometrics.
- Support and legal screen.
- Frontend implementation must follow the screen hierarchy and UI elements established in the screen-based prototype reference.
- Backend persistence.
- Authenticated user accounts and sessions.
- Secure document metadata storage and document upload pipeline.
- Real data ingestion and parsing for vehicle, zone, and parking-related data where applicable.
- Notification scheduling backend or service integration.
- Error states, empty states, degraded-data states, and confirmation states for destructive actions.

## 9. Should-Have Scope
- Save favorite parking locations.
- Mark parking suggestions as preferred.
- Route labels like `home`, `office`, `school`, `airport`.
- Saved trip checks history.
- Better trip cost summary combining charge-zone risk and parking cost estimate.
- iPhone background monitoring for saved zones and routes.
- Parking filters such as `free only`, `max price`, `max walking distance`, `covered`, `EV charging`.
- More detailed confidence and freshness labels on zone and parking data.
- Background job retries, audit logs, and lightweight support tooling for integration failures.

## 10. Won’t-Build-Now
- True automatic vehicle tracking via telematics.
- In-app payments for parking or charge zones.
- Real-time parking occupancy as a hard v1 dependency.
- OCR-first document extraction as a dependency for v1 completion.
- Large-scale internal admin panels or operations tooling.

## 11. Core Entities

### Vehicle
- Registration plate.
- Nickname.
- Make/model.
- Fuel type.
- Mileage.
- MOT due date.
- Tax due date.
- Insurance due date.
- Notes.
- Linked documents.
- Saved zones/routes.
- Optional enriched metadata from backend.

### Document
- Title.
- Type.
- Vehicle link.
- Upload date.
- Expiry/review date.
- Source.
- Status.
- File location reference.

### Alert
- Alert type.
- Linked vehicle.
- Optional linked document.
- Due date.
- Lead time.
- Muted state.
- Handled state.

### Zone
- Zone name.
- Charge amount.
- Route label.
- Compliance status for the selected vehicle.
- Monitoring on/off state.
- Source metadata.
- Freshness timestamp.

### Parking Suggestion
- Name/area.
- Price band.
- Free/paid status.
- Walking distance.
- Restriction note.
- Confidence note.
- Source metadata.
- Freshness timestamp.

## 12. Primary Screens
- Onboarding Welcome
- Onboarding Features
- Sign In
- Create Account
- Reset Password
- Dashboard
- Garage
- Add Vehicle
- Vehicle Detail
- Edit Vehicle
- Alerts
- Alert Detail
- Docs
- Upload Document
- Document Detail
- Trip Check
- Saved Zones
- Settings
- Profile
- Support & Legal

## 13. UI Fidelity Requirements
- The production frontend must follow the visual and structural patterns in [driveready-prototype-screens.html](/Users/tayo/Documents/laptop improvements/creating with ai/Digital Trust Product/Testing gpt 5.4/Ideas generation/driveready-prototype-screens.html).
- Screen-based navigation is required for all core flows. Bottom sheets must not be used as the primary pattern for onboarding, auth, vehicle management, alerts, documents, Trip Check, zones, or settings.
- The app must preserve the prototype’s iOS-first top bar pattern with title, subtitle, and context action.
- The dashboard must preserve the hero treatment used in the prototype:
  - full-width vehicle image
  - registration plate treatment
  - primary vehicle identity and status pill
- The bottom-tab navigation pattern from the prototype must be preserved for `Home`, `Garage`, `Alerts`, `Docs`, and `Settings`.
- The implementation must preserve the prototype’s major component patterns:
  - rounded cards for content groupings
  - list-item cards for vehicles, alerts, and documents
  - segmented controls for filters
  - pill/badge status indicators for `ready`, `needs attention`, `expired`, `compliant`, and `charge risk`
  - quick-action cards on the dashboard
  - full-screen forms for add/edit flows
  - confirmation modals for destructive actions
- The registration plate visual treatment from the prototype must be preserved on dashboard, vehicle detail, and add-vehicle flows.
- The app must preserve the prototype’s visual hierarchy:
  - hero content first
  - status summaries second
  - actionable lists and quick actions after
- The app must preserve iOS-style spacing, rounded geometry, and compact mobile layout behavior from the prototype.
- The implementation must not introduce prototype-only scaffolding such as sidebars, screen jumpers, scenario labs, or inspection panels.

## 14. Backend and Data Architecture Requirements

### Core Backend Services
- Authentication service for sign up, sign in, sign out, password reset, and session validation.
- User profile service.
- Vehicle service for CRUD, enrichment, and status calculation.
- Alert service for due-date evaluation, reminder state, and notification scheduling.
- Document service for metadata management and secure file upload handling.
- Trip Check service for destination lookup, charge-zone evaluation, and parking recommendation assembly.
- Saved Zones service for user-managed routes and monitoring preferences.
- Notification service or provider integration for push/event delivery.

### Data Integration Layer
- All third-party and public data integrations must be routed through backend adapters.
- Provider-specific response formats must be normalized into internal models.
- Integration failures must not break the client UI; the backend must return graceful fallbacks.
- The system must store freshness timestamps and source references for integration-backed results.

### Parsing and Normalization
- The backend must parse and normalize all external vehicle, zone, and parking data before returning it to clients.
- Parsing logic must support inconsistent field names, missing fields, partial data, and provider-specific status values.
- The backend must translate raw provider values into app-ready enums and statuses such as `current`, `needs review`, `expired`, `compliant`, `charge risk`, and `unknown`.
- The backend must validate incoming registration, date, and location-related data before persistence.

### Storage
- Persistent storage is required for users, vehicles, alerts, saved zones, documents, and trip-check history.
- File storage is required for uploaded documents.
- The backend must separate document metadata from binary file storage.

### Security
- User authentication and authorization are required.
- Sensitive data must be stored securely.
- Document access must be restricted to the owning user.
- Integration secrets and provider credentials must never be exposed to the client.

### Reliability
- Integration calls must include retry/failure handling where appropriate.
- Background processing must be supported for reminder evaluation and data refresh tasks.
- The backend must surface degraded-data states instead of silently failing.

## 15. User Flows

### Flow 1: New User
1. User lands on `Onboarding Welcome`.
2. User selects `I’m new`.
3. User sees `Onboarding Features`.
4. User optionally enables notifications.
5. User proceeds to `Create Account`.
6. User creates an account.
7. User lands on `Dashboard`.
8. User is prompted to add first vehicle if garage is empty.

### Flow 2: Existing User
1. User lands on `Onboarding Welcome`.
2. User selects `I already have an account`.
3. User goes to `Sign In`.
4. User signs in or uses biometrics.
5. User lands on `Dashboard`.

### Flow 3: Add Vehicle
1. User opens `Add Vehicle`.
2. User enters registration, nickname, make/model, and fuel type.
3. App validates required fields and registration format.
4. Backend stores the vehicle and enriches where possible.
5. New vehicle appears in `Garage`.
6. User can open `Vehicle Detail`.

### Flow 4: Manage Vehicle
1. User opens `Garage`.
2. User selects a vehicle.
3. User views `Vehicle Detail`.
4. User can edit vehicle data.
5. User can delete the vehicle after confirmation.

### Flow 5: Manage Alerts
1. User opens `Alerts`.
2. User searches or filters alerts.
3. User opens one alert.
4. User changes lead time, mute state, or handled state.
5. Updated alert behavior is saved to the backend.

### Flow 6: Manage Documents
1. User opens `Docs`.
2. User filters by status if needed.
3. User opens `Upload Document`.
4. User selects vehicle, type, title, source, and expiry date.
5. App validates required inputs and permission state.
6. Backend stores metadata and file references.
7. User opens `Document Detail`.
8. User can edit metadata, replace, share, or delete the document.

### Flow 7: Run Trip Check
1. User opens `Trip Check`.
2. User selects a vehicle.
3. User enters a destination or chooses a saved zone.
4. Backend resolves and parses destination/zone data.
5. App shows:
   - likely charge-zone compliance result
   - estimated charge risk
   - parking suggestions
   - confidence/freshness where applicable
6. User can save the checked destination/zone.

### Flow 8: Manage Saved Zones
1. User opens `Saved Zones`.
2. User views saved zones and monitoring state.
3. User adds a new zone/route.
4. User can toggle monitoring on or off.

### Flow 9: Data Refresh and Reminder Generation
1. Backend ingests or refreshes relevant external data.
2. Backend parses and normalizes the data into internal models.
3. Backend recalculates compliance states, parking suggestions, and reminders.
4. Updated results are stored and made available to clients.
5. Notification events are scheduled or dispatched where required.

## 16. Functional Requirements

### Onboarding and Auth
- The app must provide a distinct path for new users and existing users.
- The app must allow sign in, sign up, and reset password flows.
- The app must support a biometric sign-in shortcut in the UI.
- The backend must support authenticated account creation, login, logout, and password reset workflows.

### Dashboard
- The app must show the currently selected vehicle.
- The app must show date-driven summaries for insurance, MOT, and tax.
- The app must surface top pending actions.
- The app must expose shortcuts to Add Vehicle, Docs, Trip Check, and Saved Zones.
- Dashboard data must be sourced from backend-calculated status values.

### Garage
- The app must list all vehicles.
- The app must support multi-vehicle selection.
- The app must let the user open a full vehicle detail screen.
- Vehicle data must persist to the backend.
- Vehicle registration input must support backend enrichment where available.

### Vehicle Detail
- The app must show linked documents.
- The app must show service history.
- The app must show saved zones related to the vehicle.
- The app must provide a path to edit or delete the vehicle.

### Alerts
- Alerts must be generated from vehicle and document dates.
- Alerts must support search.
- Alerts must support `open` and `handled` filters.
- Each alert must support editable reminder settings.
- Reminder state must persist to the backend.
- Backend must support recalculation of alerts when source data changes.

### Documents
- The vault must support upload, view, edit, replace, share, and delete.
- Document status must be driven by dates.
- Documents must be linked to a vehicle.
- Document metadata must persist to the backend.
- Document files must be uploaded through a secure backend-supported storage flow.

### Trip Check
- The app must provide a dedicated screen for trip planning.
- The user must select a vehicle before running a trip check.
- The app must support either manual destination entry or saved zone selection.
- The app must show a compliance result state for the selected vehicle.
- The compliance result must come from backend-parsed real data in production.
- The app must show parking suggestions in the same flow.
- Parking suggestions must come from backend-parsed real data in production.
- The app must show source-confidence or freshness where the data is not guaranteed real time.

### Saved Zones
- The app must list saved zones/routes.
- The app must support add-zone.
- The app must support monitoring on/off.
- Saved zones must persist to the backend.

### Parking Suggestions
- Each parking suggestion must include:
  - label/name
  - free or paid state
  - price band or cost hint
  - walking distance
  - restriction note
  - source metadata
  - freshness timestamp where available
- Parking suggestions must be assembled from real parsed data in production.

### Settings and Profile
- Users must be able to edit profile information.
- Users must be able to toggle reminder categories.
- Users must be able to review permission states.
- Users must be able to access support and legal information.
- Profile and settings changes must persist to the backend.

### UI Fidelity
- The production UI must preserve the screen composition and component vocabulary of the screen-based prototype reference.
- Dashboard, Garage, Alerts, Docs, Settings, and detail/edit screens must remain visually and structurally recognizable against the prototype.
- New backend-connected states such as loading, error, and degraded-data messaging must be added without breaking the established component system.

### Backend and Real Data
- The backend must expose APIs for auth, profile, vehicles, alerts, docs, trip checks, zones, and parking suggestions.
- The backend must normalize provider/public dataset payloads into internal models before sending them to the client.
- The backend must preserve raw-source traceability for debugging and support.
- The backend must return degraded-but-valid responses when upstream data is unavailable.

## 17. Acceptance Criteria

### Onboarding and Auth
- A user can reach `Create Account` from the new-user onboarding path.
- A user can reach `Sign In` directly from the welcome screen.
- A user can complete sign-in and land in the app.
- A user can complete sign-up and land in the app.
- A user can complete reset-password flow and return to sign-in.
- Authenticated state is preserved by the backend/session layer after refresh or app reopen according to product rules.

### Garage and Vehicle Management
- A user can add a vehicle with valid inputs.
- Invalid registration input shows an inline validation error.
- A saved vehicle appears in Garage immediately.
- A user can open a vehicle detail screen from Garage.
- A user can edit vehicle fields and see updates reflected after saving.
- A user can delete a vehicle only after confirmation.
- Vehicle changes persist after refresh from backend-backed storage.

### Dashboard
- Dashboard shows a selected vehicle hero state.
- Dashboard shows date-driven MOT, tax, and insurance summaries.
- Dashboard shows at least one entry point to alerts and docs.

### Alerts
- Alerts appear automatically based on backend-calculated due-date data.
- A user can search alerts and see filtered results.
- A user can filter alerts by `open` and `handled`.
- A user can edit lead time, mute, and handled states for a selected alert.
- Saving alert changes persists after refresh.

### Documents
- A user can upload a document with required fields.
- Missing required upload fields show inline validation.
- Upload source respects permission state in the UI.
- A user can open a document detail screen.
- A user can edit document metadata and see changes reflected after saving.
- A user can delete a document only after confirmation.
- Uploaded document metadata persists after refresh from backend-backed storage.

### Trip Check
- A user can open a dedicated Trip Check screen.
- A user can select a vehicle and a destination/zone.
- The app returns a compliance result state.
- The app returns parking suggestions in the same flow.
- The user can save the checked destination/zone for later reuse.
- Compliance and parking outputs are served via backend endpoints in production mode.
- Trip Check responses include source-confidence or freshness metadata where applicable.

### Saved Zones
- A user can see saved zones on a dedicated screen.
- A user can add a zone with required fields.
- Missing zone fields show inline validation.
- A user can toggle monitoring on or off for a saved zone.
- Saved zone changes persist after refresh from backend-backed storage.

### Settings and Profile
- A user can edit profile information and see it persisted after refresh.
- A user can toggle notification categories.
- A user can inspect and change permission states in the product.
- A user can reach Support & Legal from Settings.

### Backend and Parsing
- Backend endpoints exist for auth, profile, vehicles, alerts, documents, trip checks, zones, and parking suggestions.
- The backend normalizes at least one real external data source per required production data domain before client consumption.
- The system handles malformed or partial upstream data without crashing the client flow.
- When upstream data is unavailable, the backend returns a valid fallback state with explicit degraded-data messaging.

### General UX
- Core flows must work with screen-based navigation, not bottom sheets.
- Back navigation must work on detail and form screens.
- Destructive actions must use confirmation UI.
- The app must persist user changes through backend-backed storage.
- The app must include empty or fallback states where relevant.
- Implemented screens visibly match the prototype’s primary UI patterns for layout, navigation, component style, and hierarchy.

## 18. Technical Notes For Build
- Use backend-backed APIs as the source of truth for production mode.
- Local state may be used only for client caching, optimistic UI, or development mode.
- Keep route structure screen-based.
- Avoid prototype chrome like sidebars, screen jumpers, or scenario panels.
- Keep the UI iOS-first and mobile-only in behavior and spacing.
- Keep provider integrations behind backend abstraction layers.
- Design data models so mock mode and production mode can share the same client contracts.
- Use [driveready-prototype-screens.html](/Users/tayo/Documents/laptop improvements/creating with ai/Digital Trust Product/Testing gpt 5.4/Ideas generation/driveready-prototype-screens.html) as the baseline UI reference during implementation.

## 19. Deferred Questions
- Exact provider selection is deferred until implementation planning.
- Legal review may be required for compliance disclaimers and parking-data accuracy language.
