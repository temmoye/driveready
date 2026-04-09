import { getChargingTariffTargetLabel, resolveElectricTariffs } from './charging-tariffs.js';
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

interface UkFuelPriceStation {
  address?: string;
  brand?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  postcode?: string;
  prices?: Partial<Record<UkFuelCode, number>>;
  site_id?: string;
}

interface UkFuelPriceFeed {
  last_updated?: string;
  stations?: UkFuelPriceStation[];
}

interface ResolvedOrigin {
  label: string;
  latitude: number;
  longitude: number;
}

type UkFuelCode = 'E10' | 'E5' | 'B7' | 'SDV';

const MAPBOX_SOURCE_NAME = 'mapbox-search';
const PUBLIC_UK_FUEL_SOURCE_NAME = 'uk-public-fuel-price-feeds';
const PROVIDER_PENDING_SOURCE_NAME = 'refuel-provider-pending';
const FUEL_PRICE_CACHE_MS = 15 * 60 * 1000;
const SEARCH_RADIUS_KILOMETERS = 10;
const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_METERS = 6371_000;
const PUBLIC_UK_FUEL_PRICE_FEED_URLS = [
  'https://storelocator.asda.com/fuel_prices_data.json',
  'https://fuel.motorfuelgroup.com/fuel_prices_data.json',
  'https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json',
  'https://www.tesco.com/fuel_prices/fuel_prices_data.json',
];
let fuelPriceCache:
  | {
      expiresAt: number;
      feeds: Array<{
        lastUpdated?: string;
        stations: UkFuelPriceStation[];
        url: string;
      }>;
    }
  | null = null;

export function resetRefuelCachesForTest() {
  fuelPriceCache = null;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function getMapboxToken() {
  return trimValue(process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN) || trimValue(process.env.MAPBOX_ACCESS_TOKEN);
}

function getFuelPriceFeedUrls() {
  const configured = trimValue(process.env.DRIVEREADY_UK_FUEL_PRICE_FEED_URLS);

  if (!configured) {
    return PUBLIC_UK_FUEL_PRICE_FEED_URLS;
  }

  return configured
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
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

  return `${(distanceMeters / METERS_PER_MILE).toFixed(1)} miles`;
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

function fuelCodesForEnergyType(energyType: RefuelEnergyType): UkFuelCode[] {
  if (energyType === 'diesel') {
    return ['B7', 'SDV'];
  }

  if (energyType === 'petrol') {
    return ['E10', 'E5'];
  }

  return [];
}

function fuelLabelForCode(fuelCode: UkFuelCode) {
  const labels = {
    B7: 'diesel',
    E10: 'unleaded E10',
    E5: 'super unleaded E5',
    SDV: 'premium diesel',
  } satisfies Record<UkFuelCode, string>;

  return labels[fuelCode];
}

function bestPriceForStation(station: UkFuelPriceStation, energyType: RefuelEnergyType) {
  const codes = fuelCodesForEnergyType(energyType);

  return codes
    .map((code) => ({
      code,
      value: station.prices?.[code],
    }))
    .filter((entry): entry is { code: UkFuelCode; value: number } => typeof entry.value === 'number' && Number.isFinite(entry.value))
    .sort((left, right) => left.value - right.value)[0];
}

function parseUkFuelLastUpdated(value?: string) {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return undefined;
  }

  const [, day, month, year, hour, minute, second] = match;
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
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
    return `Charging tariff ${getChargingTariffTargetLabel()}`;
  }

  return 'Fuel-price provider pending';
}

function livePriceLabel(input: { distanceMeters: number; fuelCode: UkFuelCode; price: number }) {
  const distance = distanceLabel(input.distanceMeters);
  return `${input.price.toFixed(1)}p/L ${input.fuelCode} · ${distance} away`;
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

function fuelStationAddress(station: UkFuelPriceStation) {
  return [trimValue(station.address), trimValue(station.postcode)].filter(Boolean).join(', ') || 'Address unavailable';
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

async function fetchFuelFeed(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'DriveReady refuel price search',
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Fuel price feed failed: ${response.status}`);
  }

  const payload = (await response.json()) as UkFuelPriceFeed;

  return {
    lastUpdated: payload.last_updated,
    stations: payload.stations ?? [],
    url,
  };
}

async function getFuelPriceFeeds() {
  if (fuelPriceCache && fuelPriceCache.expiresAt > Date.now()) {
    return fuelPriceCache.feeds;
  }

  const settled = await Promise.allSettled(getFuelPriceFeedUrls().map((url) => fetchFuelFeed(url)));
  const feeds = settled
    .filter((entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFuelFeed>>> => entry.status === 'fulfilled')
    .map((entry) => entry.value);

  fuelPriceCache = {
    expiresAt: Date.now() + FUEL_PRICE_CACHE_MS,
    feeds,
  };

  return feeds;
}

function toFuelPriceStationOption(input: {
  distanceMeters: number;
  energyType: RefuelEnergyType;
  feedLastUpdated?: string;
  fuelCode: UkFuelCode;
  index: number;
  price: number;
  station: UkFuelPriceStation;
}): RefuelStationOption {
  const latitude = input.station.location?.latitude;
  const longitude = input.station.location?.longitude;

  return {
    id: input.station.site_id ? `uk-fuel-${input.station.site_id}-${input.fuelCode}` : `uk-fuel-station-${input.index}`,
    label: [trimValue(input.station.brand), trimValue(input.station.postcode)].filter(Boolean).join(' · ') || `Fuel station ${input.index + 1}`,
    address: fuelStationAddress(input.station),
    operator_name: trimValue(input.station.brand) || undefined,
    energy_type: input.energyType,
    distance_meters: input.distanceMeters,
    latitude: typeof latitude === 'number' ? latitude : undefined,
    longitude: typeof longitude === 'number' ? longitude : undefined,
    price_label: livePriceLabel({
      distanceMeters: input.distanceMeters,
      fuelCode: input.fuelCode,
      price: input.price,
    }),
    price_is_available: true,
    price_updated_at: parseUkFuelLastUpdated(input.feedLastUpdated),
    rank_reason: 'provider_match',
    source_name: PUBLIC_UK_FUEL_SOURCE_NAME,
    freshness_at: new Date().toISOString(),
  };
}

async function findFuelPriceStations(input: {
  energyType: RefuelEnergyType;
  origin: ResolvedOrigin;
  sortBy: RefuelSortMode;
}) {
  const feeds = await getFuelPriceFeeds();
  const stations: RefuelStationOption[] = [];

  feeds.forEach((feed) => {
    feed.stations.forEach((station) => {
      const latitude = station.location?.latitude;
      const longitude = station.location?.longitude;

      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return;
      }

      const bestPrice = bestPriceForStation(station, input.energyType);

      if (!bestPrice) {
        return;
      }

      const distanceMeters = distanceMetersBetween(input.origin, {
        latitude,
        longitude,
      });

      if (distanceMeters > SEARCH_RADIUS_KILOMETERS * 1000) {
        return;
      }

      stations.push(toFuelPriceStationOption({
        distanceMeters,
        energyType: input.energyType,
        feedLastUpdated: feed.lastUpdated,
        fuelCode: bestPrice.code,
        index: stations.length,
        price: bestPrice.value,
        station,
      }));
    });
  });

  return stations.sort((left, right) => {
    if (input.sortBy === 'cheapest') {
      const leftPrice = Number.parseFloat(left.price_label);
      const rightPrice = Number.parseFloat(right.price_label);

      if (Number.isFinite(leftPrice) && Number.isFinite(rightPrice) && leftPrice !== rightPrice) {
        return leftPrice - rightPrice;
      }
    }

    return (left.distance_meters ?? Number.MAX_SAFE_INTEGER) - (right.distance_meters ?? Number.MAX_SAFE_INTEGER);
  });
}

export function getRefuelTargetLabel() {
  const locationSearch = getMapboxToken() ? 'Mapbox POI search configured' : 'location search not configured';
  return `Refuel (${locationSearch}; petrol/diesel prices via public feeds; EV tariffs: ${getChargingTariffTargetLabel()})`;
}

export async function searchRefuelOptions(input: RefuelSearchInput): Promise<RefuelSearchResult> {
  const mapboxToken = getMapboxToken();
  const freshnessAt = new Date().toISOString();
  const degraded: RefuelSearchResult['degraded'] = [
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
      code: 'refuel_price_provider_pending',
      message: input.energyType === 'electric'
        ? 'Live charging tariffs require a dedicated charging-price provider.'
        : 'Live petrol/diesel prices require location resolution before DriveReady can search public UK fuel-price feeds.',
    });
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
      code: 'refuel_price_provider_pending',
      message: input.energyType === 'electric'
        ? 'Live charging tariffs require a dedicated charging-price provider.'
        : 'Live petrol/diesel prices require location resolution before DriveReady can search public UK fuel-price feeds.',
    });
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

  if (input.energyType !== 'electric') {
    const pricedStations = await findFuelPriceStations({
      energyType: input.energyType,
      origin,
      sortBy,
    });

    if (pricedStations.length > 0) {
      return {
        degraded,
        search: {
          ...buildSearchSummary({
            energyType: input.energyType,
            freshnessAt,
            origin,
            originQuery: input.originQuery,
            sortBy,
            sourceName: PUBLIC_UK_FUEL_SOURCE_NAME,
          }),
          price_status: 'live',
        },
        stations: pricedStations,
      };
    }

    degraded.push({
      code: 'refuel_fuel_price_area_gap',
      message: 'No live retailer fuel-price feed entries were found within the search radius. Showing nearest station POIs without prices instead.',
    });
  }

  const features = await findMapboxStations({
    energyType: input.energyType,
    mapboxToken,
    origin,
  });
  const stations = features
    .map((feature, index) => toStationOption(feature, index, input.energyType, freshnessAt))
    .sort((left, right) => (left.distance_meters ?? Number.MAX_SAFE_INTEGER) - (right.distance_meters ?? Number.MAX_SAFE_INTEGER));

  if (input.energyType === 'electric') {
    const electricTariffs = await resolveElectricTariffs({
      sortBy,
      stations,
    });

    degraded.push(...electricTariffs.degraded);

    return {
      degraded,
      search: {
        ...buildSearchSummary({
          energyType: input.energyType,
          freshnessAt,
          origin,
          originQuery: input.originQuery,
          sortBy,
          sourceName: MAPBOX_SOURCE_NAME,
        }),
        price_status: electricTariffs.priceStatus,
      },
      stations: electricTariffs.stations,
    };
  }

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
