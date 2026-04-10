import type {
  ComplianceStatus,
  SavedZone,
  TripCheckConfidence,
  VehicleRecord,
} from './types.js';

interface ZonePolicy {
  id: string;
  aliases: string[];
  display_name: string;
  charge_amount_label: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  source_name: string;
}

interface ZoneMatchInput {
  latitude?: number;
  longitude?: number;
  query?: string;
}

export interface ZoneMatchResult {
  zone: SavedZone;
  matched_by: 'name' | 'coordinates' | 'saved_zone';
}

export interface ZoneComplianceResult {
  compliance_status: ComplianceStatus;
  confidence_label: TripCheckConfidence;
  reason: string;
}

const EARTH_RADIUS_METERS = 6371_000;
const ZONE_POLICIES: ZonePolicy[] = [
  {
    id: 'zone-policy-london-ulez',
    display_name: 'London ULEZ',
    aliases: ['london ulez', 'ulez', 'central london'],
    charge_amount_label: 'GBP 12.50 daily charge',
    latitude: 51.5074,
    longitude: -0.1278,
    radius_km: 22,
    source_name: 'tfl-ulez-policy',
  },
  {
    id: 'zone-policy-birmingham-caz',
    display_name: 'Birmingham CAZ',
    aliases: ['birmingham caz', 'birmingham clean air zone'],
    charge_amount_label: 'GBP 8.00 daily charge',
    latitude: 52.4862,
    longitude: -1.8904,
    radius_km: 4,
    source_name: 'birmingham-caz-policy',
  },
  {
    id: 'zone-policy-bristol-caz',
    display_name: 'Bristol CAZ',
    aliases: ['bristol caz', 'bristol clean air zone'],
    charge_amount_label: 'GBP 9.00 daily charge',
    latitude: 51.4545,
    longitude: -2.5879,
    radius_km: 3,
    source_name: 'bristol-caz-policy',
  },
  {
    id: 'zone-policy-bath-caz',
    display_name: 'Bath CAZ',
    aliases: ['bath caz', 'bath clean air zone'],
    charge_amount_label: 'GBP 9.00 daily charge',
    latitude: 51.3813,
    longitude: -2.359,
    radius_km: 2,
    source_name: 'bath-caz-policy',
  },
  {
    id: 'zone-policy-bradford-caz',
    display_name: 'Bradford CAZ',
    aliases: ['bradford caz', 'bradford clean air zone'],
    charge_amount_label: 'Charge may apply - check official Bradford CAZ rates',
    latitude: 53.7939,
    longitude: -1.7521,
    radius_km: 5,
    source_name: 'bradford-caz-policy',
  },
  {
    id: 'zone-policy-portsmouth-caz',
    display_name: 'Portsmouth CAZ',
    aliases: ['portsmouth caz', 'portsmouth clean air zone'],
    charge_amount_label: 'Charge may apply - check official Portsmouth CAZ rates',
    latitude: 50.8198,
    longitude: -1.088,
    radius_km: 3,
    source_name: 'portsmouth-caz-policy',
  },
  {
    id: 'zone-policy-sheffield-caz',
    display_name: 'Sheffield CAZ',
    aliases: ['sheffield caz', 'sheffield clean air zone'],
    charge_amount_label: 'Charge may apply - check official Sheffield CAZ rates',
    latitude: 53.3811,
    longitude: -1.4701,
    radius_km: 3,
    source_name: 'sheffield-caz-policy',
  },
  {
    id: 'zone-policy-tyneside-caz',
    display_name: 'Tyneside CAZ',
    aliases: ['tyneside caz', 'newcastle clean air zone', 'gateshead clean air zone', 'newcastle caz'],
    charge_amount_label: 'Charge may apply - check official Tyneside CAZ rates',
    latitude: 54.9783,
    longitude: -1.6178,
    radius_km: 3,
    source_name: 'tyneside-caz-policy',
  },
  {
    id: 'zone-policy-glasgow-lez',
    display_name: 'Glasgow LEZ',
    aliases: ['glasgow lez', 'glasgow low emission zone'],
    charge_amount_label: 'Restricted access / penalty risk if non-compliant',
    latitude: 55.8642,
    longitude: -4.2518,
    radius_km: 3,
    source_name: 'glasgow-lez-policy',
  },
  {
    id: 'zone-policy-edinburgh-lez',
    display_name: 'Edinburgh LEZ',
    aliases: ['edinburgh lez', 'edinburgh low emission zone'],
    charge_amount_label: 'Restricted access / penalty risk if non-compliant',
    latitude: 55.9533,
    longitude: -3.1883,
    radius_km: 3,
    source_name: 'edinburgh-lez-policy',
  },
  {
    id: 'zone-policy-dundee-lez',
    display_name: 'Dundee LEZ',
    aliases: ['dundee lez', 'dundee low emission zone'],
    charge_amount_label: 'Restricted access / penalty risk if non-compliant',
    latitude: 56.462,
    longitude: -2.9707,
    radius_km: 2,
    source_name: 'dundee-lez-policy',
  },
  {
    id: 'zone-policy-aberdeen-lez',
    display_name: 'Aberdeen LEZ',
    aliases: ['aberdeen lez', 'aberdeen low emission zone'],
    charge_amount_label: 'Restricted access / penalty risk if non-compliant',
    latitude: 57.1497,
    longitude: -2.0943,
    radius_km: 2,
    source_name: 'aberdeen-lez-policy',
  },
];

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function normalizeText(value?: string) {
  return trimValue(value).toLowerCase();
}

function toRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

function distanceMetersBetween(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  const latDelta = toRadians(right.latitude - left.latitude);
  const lonDelta = toRadians(right.longitude - left.longitude);
  const leftLat = toRadians(left.latitude);
  const rightLat = toRadians(right.latitude);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lonDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function zoneFromPolicy(policy: ZonePolicy): SavedZone {
  return {
    id: policy.id,
    name: policy.display_name,
    route_label: 'Policy dataset',
    charge_amount_label: policy.charge_amount_label,
    compliance_status: 'unknown',
    monitored: true,
    source_name: policy.source_name,
    freshness_at: new Date().toISOString(),
  };
}

function parseEuroStandard(value?: string) {
  const match = value?.match(/(\d+)/);

  if (!match) {
    return undefined;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferVehicleYear(vehicle: VehicleRecord) {
  if (typeof vehicle.dvla_ves?.year_of_manufacture === 'number') {
    return vehicle.dvla_ves.year_of_manufacture;
  }

  const fromMonth =
    vehicle.dvla_ves?.month_of_first_registration ??
    vehicle.dvla_ves?.month_of_first_dvla_registration;

  if (!fromMonth) {
    return undefined;
  }

  const year = Number(fromMonth.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function vehicleFuelCategory(vehicle: VehicleRecord) {
  const fuelType = normalizeText(vehicle.dvla_ves?.fuel_type ?? vehicle.fuel_type);

  if (!fuelType) {
    return 'unknown' as const;
  }

  if (fuelType.includes('electric')) {
    return 'electric' as const;
  }

  if (fuelType.includes('diesel')) {
    return 'diesel' as const;
  }

  if (fuelType.includes('petrol') || fuelType.includes('hybrid')) {
    return 'petrol' as const;
  }

  return 'unknown' as const;
}

export function getSupportedZonePolicies() {
  return ZONE_POLICIES.map((policy) => zoneFromPolicy(policy));
}

export function findSupportedZone(input: ZoneMatchInput): ZoneMatchResult | null {
  const normalizedQuery = normalizeText(input.query);

  if (normalizedQuery) {
    const nameMatch = ZONE_POLICIES.find((policy) =>
      policy.aliases.some((alias) => normalizedQuery.includes(alias)),
    );

    if (nameMatch) {
      return {
        zone: zoneFromPolicy(nameMatch),
        matched_by: 'name',
      };
    }
  }

  if (typeof input.latitude !== 'number' || typeof input.longitude !== 'number') {
    return null;
  }

  const latitude = input.latitude;
  const longitude = input.longitude;

  const closest = ZONE_POLICIES
    .map((policy) => ({
      distance_meters: distanceMetersBetween(
        {
          latitude,
          longitude,
        },
        {
          latitude: policy.latitude,
          longitude: policy.longitude,
        },
      ),
      policy,
    }))
    .sort((left, right) => left.distance_meters - right.distance_meters)[0];

  if (!closest || closest.distance_meters > closest.policy.radius_km * 1000) {
    return null;
  }

  return {
    zone: zoneFromPolicy(closest.policy),
    matched_by: 'coordinates',
  };
}

export function mergeZoneWithPolicy(zone: SavedZone) {
  const normalizedName = normalizeText(zone.name);
  const policy = ZONE_POLICIES.find((entry) =>
    entry.aliases.some((alias) => normalizedName.includes(alias)),
  );

  if (!policy) {
    return zone;
  }

  return {
    ...zone,
    charge_amount_label: zone.charge_amount_label || policy.charge_amount_label,
    source_name: zone.source_name || policy.source_name,
  };
}

export function evaluateVehicleAgainstZone(vehicle: VehicleRecord, zone: SavedZone): ZoneComplianceResult {
  const mergedZone = mergeZoneWithPolicy(zone);
  const fuelCategory = vehicleFuelCategory(vehicle);
  const euroStandard = parseEuroStandard(vehicle.dvla_ves?.euro_status);
  const vehicleYear = inferVehicleYear(vehicle);

  if (fuelCategory === 'electric') {
    return {
      compliance_status: 'compliant',
      confidence_label: 'high',
      reason: `${vehicle.nickname} is electric, so DriveReady treats it as compliant for ${mergedZone.name}.`,
    };
  }

  if (fuelCategory === 'unknown') {
    return {
      compliance_status: 'unknown',
      confidence_label: 'low',
      reason: `DriveReady needs DVLA vehicle data before it can estimate ${mergedZone.name} compliance.`,
    };
  }

  if (typeof euroStandard === 'number') {
    const threshold = fuelCategory === 'diesel' ? 6 : 4;
    return euroStandard >= threshold
      ? {
          compliance_status: 'compliant',
          confidence_label: 'high',
          reason: `${vehicle.nickname} is recorded as Euro ${euroStandard}, which meets the current ${mergedZone.name} threshold.`,
        }
      : {
          compliance_status: 'charge_risk',
          confidence_label: 'high',
          reason: `${vehicle.nickname} is recorded as Euro ${euroStandard}, which is below the current ${mergedZone.name} threshold.`,
        };
  }

  if (typeof vehicleYear === 'number') {
    const thresholdYear = fuelCategory === 'diesel' ? 2015 : 2006;
    return vehicleYear >= thresholdYear
      ? {
          compliance_status: 'compliant',
          confidence_label: 'medium',
          reason: `${vehicle.nickname} was first registered around ${vehicleYear}, so DriveReady estimates it is compliant for ${mergedZone.name}.`,
        }
      : {
          compliance_status: 'charge_risk',
          confidence_label: 'medium',
          reason: `${vehicle.nickname} was first registered around ${vehicleYear}, so DriveReady estimates a charge risk for ${mergedZone.name}.`,
        };
  }

  return {
    compliance_status: fuelCategory === 'diesel' ? 'charge_risk' : 'unknown',
    confidence_label: fuelCategory === 'diesel' ? 'low' : 'low',
    reason:
      fuelCategory === 'diesel'
        ? `DriveReady has only partial emissions data for ${vehicle.nickname}, so diesel charge risk is being shown conservatively.`
        : `DriveReady needs richer DVLA emissions data before it can estimate ${mergedZone.name} compliance with confidence.`,
  };
}
