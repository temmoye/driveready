# DriveReady Implementation Pack

## 1. Purpose
This document is the single engineering handoff for DriveReady v1. It consolidates product scope, UI fidelity requirements, service boundaries, API inventory, delivery milestones, and release gates into one build-ready reference.

Use this pack alongside the detailed source docs:
- `driveready-prd.md`
- `driveready-engineering-breakdown.md`
- `driveready-system-architecture.md`
- `driveready-database-api-spec.md`

## 2. Product Summary
DriveReady is an iOS-first vehicle admin and trip-assist product for UK drivers. It helps users manage MOT, tax, insurance, documents, charge-zone risk, and parking decisions in one place.

The product must feel like a standard mobile app, not a prototype lab. Core flows are screen-based, data is backend-backed, and production-critical domains use real parsed data.

## 3. Final V1 Scope

### In Scope
- New-user onboarding
- Existing-user sign-in
- Reset-password flow
- Profile and account settings
- Multi-vehicle garage
- Add, edit, view, and delete vehicle flows
- Dashboard with backend-calculated MOT, tax, and insurance summaries
- Alerts list with search, open/handled filters, and alert detail editing
- Document vault with upload, detail, edit, replace, share, and delete
- Manual Trip Check using selected vehicle plus destination or saved zone
- Saved zones list, add zone, and monitoring toggle
- Parking suggestions returned as part of Trip Check
- Notification preferences and permission-state UI
- Support and legal screens
- Backend persistence for all user data
- Real-data parsing for vehicle enrichment, zone/compliance, destination resolution, and parking domains where applicable
- Degraded-data handling and fallback UI

### Out of Scope For V1
- True telematics-based automatic vehicle tracking
- In-app payment flows
- Guaranteed real-time parking occupancy
- Heavy internal admin tooling
- OCR as a hard dependency

## 4. UI Fidelity Contract
The build must follow the visual and structural patterns in `driveready-prototype-screens.html`.

### Required UI Rules
- Preserve the screen-based navigation model.
- Do not replace major flows with bottom sheets.
- Do not add prototype chrome such as sidebars, screen jumpers, scenario panels, or lab controls.
- Preserve the app’s tabbed mobile structure for `Home`, `Garage`, `Alerts`, `Docs`, and `Settings`.
- Preserve the prototype’s card-based hierarchy, hero states, compact status blocks, segmented controls, and full-screen form/detail flows.
- Keep interactions mobile-first, scrollable, and touch-friendly.
- Preserve confirmation UI for destructive actions.
- Preserve explicit empty, loading, error, and degraded-data states.

### Required Screen Inventory
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

### UI Acceptance Rule
If a screen, component pattern, or navigation behavior materially departs from the prototype, it must be treated as a product/design decision and not introduced silently during engineering.

## 5. Delivery Milestones

### Milestone 0: Contract Lock
- Freeze v1 scope
- Freeze screen inventory
- Freeze domain models and enum set
- Freeze API contract format
- Confirm provider approach for vehicle enrichment, destination lookup, zone/compliance, and parking data

Exit criteria:
- PRD approved
- implementation pack approved
- route map approved
- service list approved

### Milestone 1: App Shell and Auth
- Build screen navigation shell
- Implement onboarding, sign in, sign up, reset password
- Implement profile/settings skeleton
- Ship backend auth, sessions, and profile endpoints
- Wire authenticated app entry

Exit criteria:
- users can sign up, sign in, sign out, reset password
- session state persists correctly
- primary navigation shell is stable

### Milestone 2: Vehicles and Dashboard
- Implement garage listing
- Implement add vehicle, vehicle detail, edit vehicle, delete vehicle
- Build vehicle CRUD backend
- Add vehicle enrichment adapter boundary
- Build backend summary/status calculation for dashboard

Exit criteria:
- users can fully manage vehicles
- dashboard reads backend-calculated readiness state
- garage and dashboard match prototype structure

### Milestone 3: Alerts and Documents
- Implement alerts list and alert detail
- Implement alert calculation engine and persistence
- Implement document vault and document detail flows
- Implement secure upload-init, finalize, replace, delete, and share flows
- Add fallback handling for failed document operations

Exit criteria:
- alerts are backend-calculated and editable
- documents persist through backend storage
- document states are date-driven

### Milestone 4: Trip Check, Zones, Parking
- Implement Trip Check screen
- Implement saved zones screen and CRUD
- Build destination resolution
- Build zone/compliance orchestration
- Build parking recommendation aggregation
- Return confidence and freshness metadata
- Handle degraded upstream states safely

Exit criteria:
- users can run Trip Check against vehicle + destination/zone
- Trip Check returns compliance status and parking suggestions
- saved zones persist and can be monitored

### Milestone 5: Notifications, Hardening, Release
- Implement reminder scheduling
- Implement background refresh/recalculation jobs
- Add logging, metrics, and tracing
- Validate degraded-data behavior
- QA all acceptance criteria
- Complete release readiness checks

Exit criteria:
- must-have acceptance criteria pass
- critical observability is live
- degraded-data states are tested
- release checklist is signed off

## 6. Service Inventory

### Client Application
Responsibilities:
- render all primary screens
- manage local form/view state
- cache server responses where appropriate
- surface loading, empty, error, and degraded states
- never call external providers directly

### API Gateway / BFF
Responsibilities:
- authenticate requests
- route calls to domain services
- normalize response envelope and error mapping
- aggregate domain results where it simplifies the client

### Auth Service
Responsibilities:
- sign up
- sign in
- sign out
- password reset request/confirm
- session validation

### Profile Service
Responsibilities:
- profile read/update
- notification preference persistence
- permission-state persistence where required by product

### Vehicle Service
Responsibilities:
- vehicle CRUD
- registration validation
- optional enrichment orchestration
- readiness/status summary calculation inputs

### Alert Service
Responsibilities:
- alert generation
- lead-time logic
- mute/handled state persistence
- notification schedule generation inputs

### Document Service
Responsibilities:
- document metadata CRUD
- upload-init/finalize
- replace/delete/share actions
- secure file access control

### Trip Check Service
Responsibilities:
- destination resolution
- charge-zone lookup
- compliance evaluation for selected vehicle
- parking suggestion aggregation
- confidence and freshness mapping
- Trip Check result persistence

### Saved Zones Service
Responsibilities:
- saved zone CRUD
- route label support
- monitoring preference persistence

### Notification Service
Responsibilities:
- notification scheduling and cancellation
- push provider integration
- delivery event handling if supported

### Background Workers
Responsibilities:
- reminder recalculation
- alert refresh
- provider sync
- upload housekeeping
- retry and dead-letter handling

## 7. External Data Domains and Parsing Rules

### Vehicle Enrichment
Purpose:
- enrich vehicle details from registration-based lookups where supported

Backend responsibilities:
- call provider through adapter
- normalize provider-specific fields into internal vehicle model
- store freshness/source metadata where useful

### Destination Resolution
Purpose:
- resolve typed destination input into a normalized location

Backend responsibilities:
- geocode or normalize destination input
- return stable display label and coordinates/reference for downstream Trip Check logic

### Charge-Zone / Compliance Data
Purpose:
- determine whether selected vehicle is `compliant`, `charge_risk`, or `unknown`

Backend responsibilities:
- parse provider or dataset response
- map raw values into app-safe compliance states
- return charge amount label, freshness, source, and optional confidence

### Parking Data
Purpose:
- return low-cost or free parking suggestions relevant to a destination

Backend responsibilities:
- parse provider responses into normalized suggestion objects
- map rules into user-readable restriction notes
- return price band/cost hint, walking distance, free/paid state, freshness, source, and confidence

### Parsing Rules
- never return raw provider payloads to the client
- handle missing or malformed fields without breaking the response
- use normalized enums for legal/compliance meaning
- return degraded-but-valid results when upstream systems fail

## 8. Endpoint Inventory

### Auth
- `POST /api/v1/auth/sign-up`
- `POST /api/v1/auth/sign-in`
- `POST /api/v1/auth/sign-out`
- `POST /api/v1/auth/password-reset/request`
- `POST /api/v1/auth/password-reset/confirm`
- `GET /api/v1/auth/session`

### Profile
- `GET /api/v1/me`
- `PATCH /api/v1/me`
- `PATCH /api/v1/me/notification-preferences`
- `PATCH /api/v1/me/permission-states`

### Vehicles
- `GET /api/v1/vehicles`
- `POST /api/v1/vehicles`
- `GET /api/v1/vehicles/:vehicle_id`
- `PATCH /api/v1/vehicles/:vehicle_id`
- `DELETE /api/v1/vehicles/:vehicle_id`
- `POST /api/v1/vehicles/:vehicle_id/enrich`

### Alerts
- `GET /api/v1/alerts`
- `GET /api/v1/alerts/:alert_id`
- `PATCH /api/v1/alerts/:alert_id`

### Documents
- `GET /api/v1/documents`
- `POST /api/v1/documents/upload-init`
- `POST /api/v1/documents`
- `GET /api/v1/documents/:document_id`
- `PATCH /api/v1/documents/:document_id`
- `POST /api/v1/documents/:document_id/replace-init`
- `DELETE /api/v1/documents/:document_id`
- `POST /api/v1/documents/:document_id/share`

### Saved Zones
- `GET /api/v1/zones`
- `POST /api/v1/zones`
- `PATCH /api/v1/zones/:zone_id`
- `DELETE /api/v1/zones/:zone_id`

### Trip Check
- `POST /api/v1/trip-checks`
- `GET /api/v1/trip-checks`
- `GET /api/v1/trip-checks/:trip_check_id`

### Support
- `GET /api/v1/support/content`
- `POST /api/v1/support/export-request`

## 9. Recommended Build Order

### Step 1
Finalize contracts:
- enum set
- screen map
- domain models
- auth/session model
- upload flow model
- Trip Check response model

### Step 2
Build frontend app shell and auth:
- route structure
- tabs
- onboarding/auth screens
- profile/settings shell

### Step 3
Build backend auth and profile:
- users
- sessions
- profile
- notification preferences

### Step 4
Build vehicle domain end to end:
- vehicle schema
- vehicle APIs
- garage UI
- vehicle forms
- dashboard summaries

### Step 5
Build alerts domain:
- alert schema
- alert calculation logic
- alert APIs
- alert screens

### Step 6
Build documents domain:
- object storage path
- document schema
- upload-init/finalize flow
- docs UI
- replace/delete/share paths

### Step 7
Build Trip Check and saved zones:
- zone schema
- Trip Check schema
- destination resolution
- zone/compliance normalization
- parking normalization
- Trip Check UI

### Step 8
Add background jobs and notifications:
- reminder recalculation
- notification scheduling
- provider refresh jobs
- failure handling

### Step 9
Hardening:
- degraded-data QA
- observability
- security pass
- performance pass
- release prep

## 10. Release Gates

### Product Gate
- all must-have screens implemented
- screen flows align with prototype
- no prototype-lab chrome present
- destructive flows confirm before commit

### Data Gate
- backend is source of truth for persisted data
- required real-data adapters are in place
- parser normalization is implemented
- degraded-data responses are explicit and tested

### Security Gate
- authenticated access enforced
- per-user authorization enforced
- document access is private by default
- secrets remain server-side only

### Reliability Gate
- critical background jobs are idempotent
- retry behavior exists for transient failures
- logs/metrics exist for auth, Trip Check, upload, and provider failures

### UX Gate
- back navigation works on detail/form screens
- mobile scroll behavior is stable
- empty/loading/error/degraded states are present
- key interactions remain touch-friendly and visually consistent

## 11. Risks and Deferred Decisions

### Top Risks
- provider selection changes late and forces contract changes
- real-data complexity expands Trip Check scope
- document storage decisions slip and block upload work
- UI drifts from prototype when real states are introduced

### Deferred Decisions
- exact provider selection for zone/compliance data
- exact provider selection for parking data
- session implementation choice
- queue/job infrastructure choice
- upload transport choice

## 12. Immediate Next Steps
- approve this implementation pack as the engineering handoff baseline
- lock the provider shortlist
- lock the route map and screen inventory
- lock the enum set and response model shapes
- create epics from the milestone structure
- start Milestone 1 with frontend shell plus auth service

## 13. Definition of Ready
Engineering can start build execution when:
- PRD is approved
- implementation pack is approved
- prototype UI is accepted as the visual contract
- backend domains are accepted
- API conventions are accepted
- v1 scope is frozen

## 14. Definition of Done
DriveReady v1 is complete when:
- must-have product scope is delivered
- the app visibly follows the screen-based prototype
- all core state persists through backend APIs
- Trip Check returns compliance and parking outputs from backend-backed logic
- degraded-data states render safely
- release gates are passed
