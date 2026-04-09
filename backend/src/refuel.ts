import type {
  RefuelEnergyType,
  RefuelSearchSummary,
  RefuelSortMode,
  RefuelStationOption,
} from './types.js';

interface RefuelSearchInput {
  energyType: RefuelEnergyType;
  latitude?: number;
  longitude?: number;
  originQuery?: string;
  sortBy?: RefuelSortMode;
}

interface RefuelSearchResult {
  degraded: Array<{
    code: string;
    message: string;
  }>;
  search: RefuelSearchSummary;
  stations: RefuelStationOption[];
}

interface MapboxFeature {
  id?: string;
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    address?: string;
    brand?: string | string[];
    coordinates?: {
      latitude?: number;
      longitude?: number;
    };
    distance?: number;
    full_address?: string;
    mapbox_id?: string;
    name?: string;
    place_formatted?: string;
  };
  text?: string;
}

interface MapboxFeatureCollection {
  features?: MapboxFeature[];
}

interface ResolvedOrigin {
  label: string;
  latitude: number;
  longitude: number;
}

const MAPBOX_SOURCE_NAME = 'mapbox-search';
const PROVIDER_PENDING_SOURCE_NAME = 'refuel-provider-pending';
const SEARCH_RADIUS_KILOMETERS = 10;

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function getMapboxToken() {
  return trimValue(process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN) || trimValue(process.env.MAPBOX_ACCESS_TOKEN);
}

function buildSearchSummary(input: {
  energyType: RefuelEnergyType;
  freshnessAt: string;
  origin: ResolvedOrigin | null;
  originQuery?: string;
  sortBy: RefuelSortMode;
  sourceName: string;
}): RefuelSearchSummary {
  return {
    energy_type: input.energyType,
    freshness_at: input.freshnessAt,
    location_status: input.origin ? 'resolved' : 'not_resolved',
    origin_label: input.origin?.label ?? trimValue(input.originQuery) ?? 'Location not selected',
    price_status: 'provider_pending',
    sort_by: input.sortBy,
    source_name: input.sourceName,
    ...(input.origin ? { latitude: input.origin.latitude, longitude: input.origin.longitude } : {}),
  };
}

function distanceLabel(distanceMeters?: number) {
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters)) {
    return undefined;
  }

  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1609.344).toFixed(1)} miles`;
}

function poiCategoryForEnergyType(energyType: RefuelEnergyType) {
  return energyType === 'electric' ? 'charging_station' : 'gas_station';
}

function labelForEnergyType(energyType: RefuelEnergyType) {
  if (energyType === 'electric') {
    return 'charging station';
  }

  return 'filling station';
}

function pricePendingMessage(energyType: RefuelEnergyType) {
  if (energyType === 'electric') {
    return 'Charging tariff provider pending';
  }

  return 'Fuel-price provider pending';
}

function stationLabel(feature: MapboxFeature, index: number) {
  return trimValue(feature.properties?.name) || trimValue(feature.text) || `Station ${index + 1}`;
}

function stationAddress(feature: MapboxFeature) {
  return (
    trimValue(feature.properties?.full_address) ||
    [trimValue(feature.properties?.address), trimValue(feature.properties?.place_formatted)]
      .filter(Boolean)
      .join(', ') ||
    'Address unavailable'
  );
}

function stationOperator(feature: MapboxFeature) {
  const brand = feature.properties?.brand;

  if (Array.isArray(brand)) {
    return brand.filter(Boolean).join(', ') || undefined;
  }

  return trimValue(brand) || undefined;
}

function featureCoordinates(feature: MapboxFeature) {
  const coordinates = feature.geometry?.coordinates;
  const longitude = feature.properties?.coordinates?.longitude ?? coordinates?.[0];
  const latitude = feature.properties?.coordinates?.latitude ?? coordinates?.[1];

  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return {};
  }

  return {
    latitude,
    longitude,
  };
}

async function requestMapboxFeatureCollection(endpoint: URL) {
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`Mapbox search request failed: ${response.status}`);
  }

  return response.json() as Promise<MapboxFeatureCollection>;
}

async function geocodeOrigin(originQuery: string, mapboxToken: string): Promise<ResolvedOrigin | null> {
  const trimmed = trimValue(originQuery);

  if (!trimmed) {
    return null;
  }

  const endpoint = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  endpoint.searchParams.set('q', trimmed);
  endpoint.searchParams.set('access_token', mapboxToken);
  endpoint.searchParams.set('country', 'gb');
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('limit', '1');

  const payload = await requestMapboxFeatureCollection(endpoint);
  const feature = payload.features?.[0];

  if (!feature) {
    return null;
  }

  const coordinates = featureCoordinates(feature);

  if (typeof coordinates.latitude !== 'number' || typeof coordinates.longitude !== 'number') {
    return null;
  }

  return {
    label: stationAddress(feature) === 'Address unavailable' ? trimmed : stationAddress(feature),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  };
}

async function findMapboxStations(input: {
  energyType: RefuelEnergyType;
  mapboxToken: string;
  origin: ResolvedOrigin;
}) {
  const endpoint = new URL(`https://api.mapbox.com/search/searchbox/v1/category/${poiCategoryForEnergyType(input.energyType)}`);
  endpoint.searchParams.set('access_token', input.mapboxToken);
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('limit', '8');
  endpoint.searchParams.set('origin', `${input.origin.longitude},${input.origin.latitude}`);
  endpoint.searchParams.set('proximity', `${input.origin.longitude},${input.origin.latitude}`);
  endpoint.searchParams.set('radius', String(SEARCH_RADIUS_KILOMETERS));

  const payload = await requestMapboxFeatureCollection(endpoint);

  return payload.features ?? [];
}

function toStationOption(feature: MapboxFeature, index: number, energyType: RefuelEnergyType, freshnessAt: string): RefuelStationOption {
  const coordinates = featureCoordinates(feature);
  const distanceMeters = feature.properties?.distance;
  const distance = distanceLabel(distanceMeters);

  return {
    id: trimValue(feature.properties?.mapbox_id) || trimValue(feature.id) || `refuel-station-${index}`,
    label: stationLabel(feature, index),
    address: stationAddress(feature),
    operator_name: stationOperator(feature),
    energy_type: energyType,
    distance_meters: typeof distanceMeters === 'number' ? distanceMeters : undefined,
    ...coordinates,
    connector_summary: energyType === 'electric' ? 'Connector details pending charging provider' : undefined,
    price_label: distance ? `${distance} away · ${pricePendingMessage(energyType)}` : pricePendingMessage(energyType),
    price_is_available: false,
    rank_reason: 'nearest',
    source_name: MAPBOX_SOURCE_NAME,
    freshness_at: freshnessAt,
  };
}

export function getRefuelTargetLabel() {
  const locationSearch = getMapboxToken() ? 'Mapbox POI search configured' : 'location search not configured';
  return `Refuel (${locationSearch}; live fuel/charging prices pending provider)`;
}

export async function searchRefuelOptions(input: RefuelSearchInput): Promise<RefuelSearchResult> {
  const mapboxToken = getMapboxToken();
  const freshnessAt = new Date().toISOString();
  const degraded: RefuelSearchResult['degraded'] = [
    {
      code: 'refuel_price_provider_pending',
      message: 'Live fuel prices and charging tariffs require a dedicated fuel/charging price provider.',
    },
  ];
  const sortBy = input.sortBy ?? 'closest';

  let origin: ResolvedOrigin | null = null;

  if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    origin = {
      label: trimValue(input.originQuery) || 'Selected location',
      latitude: input.latitude,
      longitude: input.longitude,
    };
  }

  if (!origin && trimValue(input.originQuery) && mapboxToken) {
    origin = await geocodeOrigin(input.originQuery ?? '', mapboxToken);
  }

  if (!origin) {
    degraded.push({
      code: mapboxToken ? 'refuel_origin_not_resolved' : 'refuel_location_provider_pending',
      message: mapboxToken
        ? 'Enter a more specific postcode, town, or destination so DriveReady can search nearby stations.'
        : 'Nearby station search requires DRIVEREADY_MAPBOX_ACCESS_TOKEN on the backend.',
    });

    return {
      degraded,
      search: buildSearchSummary({
        energyType: input.energyType,
        freshnessAt,
        origin,
        originQuery: input.originQuery,
        sortBy,
        sourceName: PROVIDER_PENDING_SOURCE_NAME,
      }),
      stations: [],
    };
  }

  if (!mapboxToken) {
    degraded.push({
      code: 'refuel_location_provider_pending',
      message: `Closest ${labelForEnergyType(input.energyType)} results require DRIVEREADY_MAPBOX_ACCESS_TOKEN on the backend.`,
    });

    return {
      degraded,
      search: buildSearchSummary({
        energyType: input.energyType,
        freshnessAt,
        origin,
        originQuery: input.originQuery,
        sortBy,
        sourceName: PROVIDER_PENDING_SOURCE_NAME,
      }),
      stations: [],
    };
  }

  const features = await findMapboxStations({
    energyType: input.energyType,
    mapboxToken,
    origin,
  });
  const stations = features
    .map((feature, index) => toStationOption(feature, index, input.energyType, freshnessAt))
    .sort((left, right) => (left.distance_meters ?? Number.MAX_SAFE_INTEGER) - (right.distance_meters ?? Number.MAX_SAFE_INTEGER));

  if (sortBy === 'cheapest') {
    degraded.push({
      code: 'cheapest_sort_pending_price_provider',
      message: 'Cheapest sorting will activate after fuel-price or charging-tariff data is connected. Results are currently sorted by distance.',
    });
  }

  return {
    degraded,
    search: buildSearchSummary({
      energyType: input.energyType,
      freshnessAt,
      origin,
      originQuery: input.originQuery,
      sortBy,
      sourceName: MAPBOX_SOURCE_NAME,
    }),
    stations,
  };
}
