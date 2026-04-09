# DriveReady Database Schema and API Spec

## 1. Purpose
Define the initial production-oriented persistence model and API surface for DriveReady.

This spec is aligned with:
- [driveready-prd.md](/Users/tayo/Documents/laptop improvements/creating with ai/Digital Trust Product/Testing gpt 5.4/Ideas generation/driveready-prd.md)
- [driveready-prototype-screens.html](/Users/tayo/Documents/laptop improvements/creating with ai/Digital Trust Product/Testing gpt 5.4/Ideas generation/driveready-prototype-screens.html)

## 2. Data Store Assumptions
- Primary relational database: Postgres
- File storage: object storage
- Optional cache/queue support: Redis-compatible layer
- Timestamps stored in UTC
- IDs use UUIDs unless otherwise noted

## 3. Core Tables

### users
| column | type | notes |
|---|---|---|
| id | uuid pk | user id |
| email | text unique | normalized lowercase |
| password_hash | text | server-side only |
| first_name | text | required |
| last_name | text | required |
| phone | text | nullable |
| address_line | text | nullable |
| plan_tier | text | default `premium_concierge` or product default |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### sessions
| column | type | notes |
|---|---|---|
| id | uuid pk | session id |
| user_id | uuid fk users.id | required |
| token_hash | text | or equivalent opaque session key |
| expires_at | timestamptz | required |
| created_at | timestamptz | required |
| revoked_at | timestamptz | nullable |

### notification_preferences
| column | type | notes |
|---|---|---|
| user_id | uuid pk fk users.id | one row per user |
| mot_enabled | boolean | default true |
| tax_enabled | boolean | default true |
| insurance_enabled | boolean | default true |
| docs_enabled | boolean | default true |
| zones_enabled | boolean | default true |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### permission_states
| column | type | notes |
|---|---|---|
| user_id | uuid pk fk users.id | one row per user |
| notifications_state | text | `prompt`, `granted`, `denied` |
| camera_state | text | `prompt`, `granted`, `denied` |
| files_state | text | `prompt`, `granted`, `denied` |
| biometrics_state | text | `prompt`, `granted`, `denied` |
| updated_at | timestamptz | required |

### vehicles
| column | type | notes |
|---|---|---|
| id | uuid pk | vehicle id |
| user_id | uuid fk users.id | required |
| registration_plate | text | normalized uppercase |
| nickname | text | required |
| make_model | text | required |
| fuel_type | text | required |
| mileage | integer | nullable |
| mot_due_at | date | nullable |
| tax_due_at | date | nullable |
| insurance_due_at | date | nullable |
| notes | text | nullable |
| image_url | text | nullable |
| enrichment_status | text | `pending`, `complete`, `failed`, `not_available` |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### vehicle_service_history
| column | type | notes |
|---|---|---|
| id | uuid pk | history id |
| vehicle_id | uuid fk vehicles.id | required |
| event_date | date | required |
| title | text | required |
| note | text | nullable |
| created_at | timestamptz | required |

### documents
| column | type | notes |
|---|---|---|
| id | uuid pk | document id |
| user_id | uuid fk users.id | required |
| vehicle_id | uuid fk vehicles.id | required |
| title | text | required |
| document_type | text | `insurance_policy`, `mot_certificate`, `v5c_logbook`, `service_invoice`, etc |
| status | text | `current`, `needs_review`, `expired`, `unknown` |
| uploaded_at | timestamptz | required |
| expires_at | date | nullable |
| source_type | text | `files`, `camera`, `provider_import` |
| file_key | text | object storage reference |
| mime_type | text | nullable |
| preview_text | text | nullable |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### alerts
| column | type | notes |
|---|---|---|
| id | uuid pk | alert id |
| user_id | uuid fk users.id | required |
| vehicle_id | uuid fk vehicles.id | nullable |
| document_id | uuid fk documents.id | nullable |
| zone_id | uuid fk saved_zones.id | nullable |
| alert_type | text | `mot`, `tax`, `insurance`, `document`, `zone` |
| title | text | required |
| subtitle | text | required |
| detail | text | required |
| due_at | date | required |
| lead_days | integer | required |
| tone | text | `good`, `warn`, `danger`, `neutral` |
| muted | boolean | default false |
| handled | boolean | default false |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### saved_zones
| column | type | notes |
|---|---|---|
| id | uuid pk | zone id |
| user_id | uuid fk users.id | required |
| name | text | required |
| route_label | text | required |
| charge_amount_label | text | nullable |
| monitored | boolean | default true |
| image_url | text | nullable |
| source_name | text | nullable |
| freshness_at | timestamptz | nullable |
| created_at | timestamptz | required |
| updated_at | timestamptz | required |

### trip_checks
| column | type | notes |
|---|---|---|
| id | uuid pk | trip check id |
| user_id | uuid fk users.id | required |
| vehicle_id | uuid fk vehicles.id | required |
| input_type | text | `destination`, `saved_zone` |
| destination_query | text | nullable |
| saved_zone_id | uuid fk saved_zones.id | nullable |
| compliance_status | text | `compliant`, `charge_risk`, `unknown` |
| charge_amount_label | text | nullable |
| confidence_label | text | nullable |
| freshness_at | timestamptz | nullable |
| source_name | text | nullable |
| created_at | timestamptz | required |

### trip_check_parking_suggestions
| column | type | notes |
|---|---|---|
| id | uuid pk | suggestion id |
| trip_check_id | uuid fk trip_checks.id | required |
| label | text | required |
| price_band | text | nullable |
| is_free | boolean | default false |
| walking_distance_meters | integer | nullable |
| restriction_note | text | nullable |
| confidence_label | text | nullable |
| source_name | text | nullable |
| freshness_at | timestamptz | nullable |
| sort_order | integer | required |

### provider_snapshots
| column | type | notes |
|---|---|---|
| id | uuid pk | snapshot id |
| domain | text | `vehicle`, `zone`, `parking`, `destination` |
| external_provider | text | provider identifier |
| reference_key | text | provider correlation id |
| payload_json | jsonb | raw source payload |
| parsed_status | text | `success`, `partial`, `failed` |
| created_at | timestamptz | required |

## 4. Core Relationships
- `users` 1 -> many `vehicles`
- `users` 1 -> many `documents`
- `users` 1 -> many `alerts`
- `users` 1 -> many `saved_zones`
- `users` 1 -> many `trip_checks`
- `vehicles` 1 -> many `documents`
- `vehicles` 1 -> many `vehicle_service_history`
- `trip_checks` 1 -> many `trip_check_parking_suggestions`

## 5. Derived Status Rules
- Vehicle readiness is not stored as a single permanent source-of-truth field. It is calculated from MOT, tax, insurance, and related alert state.
- Document status is derived from `expires_at`.
- Alert tone is derived from due date proximity and alert type.
- Zone compliance in Trip Check responses comes from parsed provider or dataset results, not fixed frontend logic.

## 6. API Conventions
- Base path: `/api/v1`
- All authenticated endpoints require session/token auth.
- All responses should return normalized domain objects, never raw provider payloads.
- Integration-backed responses should include:
  - `source`
  - `freshness_at`
  - optional `confidence`

## 7. Auth APIs

### POST `/api/v1/auth/sign-up`
Create a user account.

Request:
```json
{
  "first_name": "James",
  "last_name": "Harrington",
  "email": "james@driveready.uk",
  "password": "demo1234"
}
```

Response:
```json
{
  "user": {
    "id": "uuid",
    "first_name": "James",
    "last_name": "Harrington",
    "email": "james@driveready.uk"
  },
  "session": {
    "expires_at": "2025-01-01T00:00:00Z"
  }
}
```

### POST `/api/v1/auth/sign-in`
Authenticate a user.

### POST `/api/v1/auth/sign-out`
Invalidate current session.

### POST `/api/v1/auth/password-reset/request`
Request password reset.

### POST `/api/v1/auth/password-reset/confirm`
Complete password reset.

### GET `/api/v1/auth/session`
Return current authenticated user and session state.

## 8. Profile APIs

### GET `/api/v1/me`
Return profile, plan, notification preferences, and permission-state record.

### PATCH `/api/v1/me`
Update profile.

Request:
```json
{
  "first_name": "James",
  "last_name": "Harrington",
  "phone": "07700 900123",
  "address_line": "14 Camden Mews, London NW1"
}
```

### PATCH `/api/v1/me/notification-preferences`
Update reminder category preferences.

### PATCH `/api/v1/me/permission-states`
Persist UI-visible permission states where product chooses to store them server-side.

## 9. Vehicle APIs

### GET `/api/v1/vehicles`
List user vehicles plus summary status fields.

Response fields:
- id
- registration_plate
- nickname
- make_model
- fuel_type
- mileage
- mot_due_at
- tax_due_at
- insurance_due_at
- readiness_status
- readiness_tone

### POST `/api/v1/vehicles`
Create vehicle.

Request:
```json
{
  "registration_plate": "LM21 KPR",
  "nickname": "City Saloon",
  "make_model": "Audi A4 Avant",
  "fuel_type": "Euro 6 Diesel"
}
```

### GET `/api/v1/vehicles/:vehicle_id`
Return full vehicle detail including:
- summary fields
- service history
- linked documents
- linked saved zones

### PATCH `/api/v1/vehicles/:vehicle_id`
Update vehicle.

### DELETE `/api/v1/vehicles/:vehicle_id`
Delete vehicle and optionally cascade linked document references per business rules.

### POST `/api/v1/vehicles/:vehicle_id/enrich`
Trigger or re-trigger backend enrichment from provider data.

## 10. Alert APIs

### GET `/api/v1/alerts`
List alerts with query support.

Supported query params:
- `status=open|handled`
- `search=string`
- `vehicle_id=uuid`

Response item fields:
- id
- title
- subtitle
- detail
- due_at
- tone
- lead_days
- muted
- handled
- vehicle_id
- document_id
- zone_id

### GET `/api/v1/alerts/:alert_id`
Return a single alert.

### PATCH `/api/v1/alerts/:alert_id`
Update reminder settings.

Request:
```json
{
  "lead_days": 14,
  "muted": false,
  "handled": true
}
```

## 11. Document APIs

### GET `/api/v1/documents`
List documents with filters.

Supported query params:
- `status=current|needs_review|expired|all`
- `vehicle_id=uuid`

### POST `/api/v1/documents/upload-init`
Initialize an upload and return upload instructions.

Request:
```json
{
  "vehicle_id": "uuid",
  "title": "Insurance Policy",
  "document_type": "insurance_policy",
  "source_type": "files",
  "expires_at": "2025-02-01"
}
```

Response:
```json
{
  "upload_id": "uuid",
  "file_key": "documents/user-id/doc-id.pdf",
  "upload_url": "https://storage.example.com/...",
  "method": "PUT"
}
```

### POST `/api/v1/documents`
Finalize document metadata after upload.

### GET `/api/v1/documents/:document_id`
Return document detail.

### PATCH `/api/v1/documents/:document_id`
Update document metadata.

### POST `/api/v1/documents/:document_id/replace-init`
Start replace flow for an existing document.

### DELETE `/api/v1/documents/:document_id`
Delete document metadata and revoke file access according to retention rules.

### POST `/api/v1/documents/:document_id/share`
Create a share action or short-lived secure link if supported.

## 12. Saved Zone APIs

### GET `/api/v1/zones`
List saved zones for current user.

### POST `/api/v1/zones`
Create saved zone.

Request:
```json
{
  "name": "London ULEZ",
  "route_label": "Morning school route",
  "charge_amount_label": "£12.50",
  "monitored": true
}
```

### PATCH `/api/v1/zones/:zone_id`
Update monitoring state or zone metadata.

### DELETE `/api/v1/zones/:zone_id`
Delete saved zone.

## 13. Trip Check APIs

### POST `/api/v1/trip-checks`
Run Trip Check and optionally persist it.

Request:
```json
{
  "vehicle_id": "uuid",
  "input_type": "destination",
  "destination_query": "Shoreditch High Street, London",
  "persist_result": true
}
```

Response:
```json
{
  "trip_check": {
    "id": "uuid",
    "vehicle_id": "uuid",
    "input_type": "destination",
    "destination_query": "Shoreditch High Street, London",
    "compliance_status": "compliant",
    "charge_amount_label": "£0.00",
    "confidence_label": "high",
    "freshness_at": "2025-01-01T10:00:00Z",
    "source_name": "zone_provider_x"
  },
  "parking_suggestions": [
    {
      "label": "Boundary Street",
      "price_band": "free after 18:00",
      "is_free": false,
      "walking_distance_meters": 420,
      "restriction_note": "Permit-only before 18:00",
      "confidence_label": "medium",
      "source_name": "parking_provider_y",
      "freshness_at": "2025-01-01T09:45:00Z"
    }
  ]
}
```

### GET `/api/v1/trip-checks`
List saved trip checks.

### GET `/api/v1/trip-checks/:trip_check_id`
Return one saved trip check plus parking suggestions.

## 14. Support / Misc APIs

### GET `/api/v1/support/content`
Return support/legal content blocks for the app.

### POST `/api/v1/support/export-request`
Create user data export request.

## 15. Error Model

All API errors should return a normalized shape:
```json
{
  "error": {
    "code": "validation_failed",
    "message": "Registration plate is invalid.",
    "fields": {
      "registration_plate": "Enter a valid UK plate."
    }
  }
}
```

Degraded-data responses should remain successful where the screen can still render:
```json
{
  "data": {
    "compliance_status": "unknown",
    "parking_suggestions": []
  },
  "degraded": {
    "message": "Live parking data is temporarily unavailable.",
    "source": "parking_provider_y"
  }
}
```

## 16. API Contract Notes for UI Fidelity
- Route-level client screens should map cleanly to one or more backend endpoints without requiring provider-specific client logic.
- Response models should support the prototype’s UI elements directly:
  - hero state
  - pills/badges
  - list items
  - segmented filters
  - full-screen detail forms
- The client should not compute legal/compliance meaning from raw fields; it should consume normalized status values from backend APIs.

## 17. Schema / API Exit Criteria
- Schema covers all must-have domains in the PRD.
- APIs exist for every primary screen requiring persistence or real data.
- File upload path is defined.
- Trip Check supports compliance plus parking in one backend response.
- Source metadata and freshness are included where required.
- Error and degraded-data models are explicit.
