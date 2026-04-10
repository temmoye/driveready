import { evaluateVehicleAgainstZone, findSupportedZone, mergeZoneWithPolicy } from './compliance.js';
import { resolveLocationQuery, type ResolvedLocation } from './location-search.js';
import type {
  DegradedNote,
  ParkingSuggestion,
  SavedZone,
  TripCheckRecord,
  TripInputType,
  VehicleRecord,
} from './types.js';

interface BuildTripCheckInput {
  destinationQuery?: string;
  inputType: TripInputType;
  latitude?: number;
  longitude?: number;
  savedZone?: SavedZone;
  vehicle: VehicleRecord;
}

export interface TripCheckBuildResult {
  degraded: DegradedNote[];
  matched_zone: SavedZone | null;
  resolved_destination: ResolvedLocation | null;
  trip_check: TripCheckRecord;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

async function resolveDestination(input: BuildTripCheckInput) {
  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    return {
      label: trimValue(input.destinationQuery) || 'Selected destination',
      latitude: input.latitude,
      longitude: input.longitude,
    } satisfies ResolvedLocation;
  }

  if (!trimValue(input.destinationQuery)) {
    return null;
  }

  return resolveLocationQuery(input.destinationQuery ?? '');
}

function freeChargeLabel(complianceStatus: TripCheckRecord['compliance_status']) {
  return complianceStatus === 'compliant' ? 'GBP 0.00' : 'Charge may apply';
}

export async function buildTripCheck(input: BuildTripCheckInput): Promise<TripCheckBuildResult> {
  const degraded: DegradedNote[] = [
    {
      code: 'parking_provider_pending',
      message: 'Parking suggestions are unavailable until a parking data provider is connected.',
    },
  ];
  const freshnessAt = new Date().toISOString();
  let matchedZone: SavedZone | null = input.savedZone ? mergeZoneWithPolicy(input.savedZone) : null;
  let resolvedDestination: ResolvedLocation | null = null;

  if (input.inputType === 'destination') {
    resolvedDestination = await resolveDestination(input);

    if (!resolvedDestination) {
      degraded.push({
        code: 'trip_check_destination_not_resolved',
        message: 'Enter a more specific postcode, town, or destination so DriveReady can estimate charge-zone impact.',
      });
    } else if (!matchedZone) {
      matchedZone = findSupportedZone({
        latitude: resolvedDestination.latitude,
        longitude: resolvedDestination.longitude,
        query: resolvedDestination.label,
      })?.zone ?? null;
    }
  }

  if (!matchedZone && trimValue(input.destinationQuery)) {
    matchedZone = findSupportedZone({
      query: input.destinationQuery,
    })?.zone ?? null;
  }

  if (!matchedZone) {
    degraded.push({
      code: 'trip_check_zone_dataset_gap',
      message: 'DriveReady could not match this destination to a supported charge-zone dataset, so compliance is being shown as unknown.',
    });
  }

  const compliance = matchedZone
    ? evaluateVehicleAgainstZone(input.vehicle, matchedZone)
    : {
        compliance_status: 'unknown' as const,
        confidence_label: 'low' as const,
        reason: `DriveReady could not find a supported zone dataset for this destination yet.`,
      };

  if (matchedZone && compliance.confidence_label !== 'high') {
    degraded.push({
      code: 'trip_check_compliance_inferred',
      message: compliance.reason,
    });
  }

  if (!matchedZone) {
    degraded.push({
      code: 'trip_check_compliance_unknown',
      message: compliance.reason,
    });
  }

  const parkingSuggestions: ParkingSuggestion[] = [];

  return {
    degraded,
    matched_zone: matchedZone,
    resolved_destination: resolvedDestination,
    trip_check: {
      id: `trip-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      vehicle_id: input.vehicle.id,
      input_type: input.inputType,
      ...(input.inputType === 'destination'
        ? { destination_query: resolvedDestination?.label ?? trimValue(input.destinationQuery) }
        : {}),
      ...(input.savedZone ? { saved_zone_id: input.savedZone.id } : {}),
      compliance_status: compliance.compliance_status,
      charge_amount_label:
        compliance.compliance_status === 'charge_risk'
          ? matchedZone?.charge_amount_label ?? 'Charge may apply'
          : freeChargeLabel(compliance.compliance_status),
      confidence_label: compliance.confidence_label,
      freshness_at: freshnessAt,
      source_name: matchedZone?.source_name ?? 'trip-check-derived-rules',
      parking_suggestions: parkingSuggestions,
    },
  };
}
