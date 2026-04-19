import type { LocationSuggestion } from './types.js';

export interface ResolvedLocation {
  label: string;
  latitude: number;
  longitude: number;
}

interface MapboxFeature {
  id?: string;
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    coordinates?: {
      latitude?: number;
      longitude?: number;
    };
    full_address?: string;
    place_formatted?: string;
  };
  place_name?: string;
  name?: string;
}

interface MapboxFeatureCollection {
  features?: MapboxFeature[];
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function getMapboxToken() {
  return trimValue(process.env.DRIVEREADY_MAPBOX_ACCESS_TOKEN) || trimValue(process.env.MAPBOX_ACCESS_TOKEN);
}

function featureCoordinates(feature: MapboxFeature) {
  const longitude = feature.properties?.coordinates?.longitude ?? feature.geometry?.coordinates?.[0];
  const latitude = feature.properties?.coordinates?.latitude ?? feature.geometry?.coordinates?.[1];

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function featureLabel(feature: MapboxFeature) {
  return (
    trimValue(feature.properties?.full_address) ||
    trimValue(feature.place_name) ||
    trimValue(feature.name)
  );
}

async function requestMapbox(endpoint: URL) {
  const response = await fetch(endpoint, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Mapbox location request failed: ${response.status}`);
  }

  return response.json() as Promise<MapboxFeatureCollection>;
}

export function hasLocationSearch() {
  return getMapboxToken().length > 0;
}

export function getLocationSearchTargetLabel() {
  if (!hasLocationSearch()) {
    return 'Mapbox location search (not configured)';
  }

  return 'Mapbox location search';
}

export async function searchLocationSuggestions(query: string): Promise<LocationSuggestion[]> {
  const token = getMapboxToken();
  const trimmed = trimValue(query);

  if (!token || trimmed.length < 3) {
    return [];
  }

  const endpoint = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  endpoint.searchParams.set('q', trimmed);
  endpoint.searchParams.set('access_token', token);
  endpoint.searchParams.set('country', 'gb');
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('limit', '5');

  const payload = await requestMapbox(endpoint);

  return (payload.features ?? [])
    .map((feature, index) => {
      const label = featureLabel(feature);
      const coordinates = featureCoordinates(feature);

      if (!label) {
        return null;
      }

      return {
        id: feature.id ?? `location-suggestion-${index}`,
        label,
        ...(trimValue(feature.properties?.place_formatted)
          ? { secondary_label: trimValue(feature.properties?.place_formatted) }
          : {}),
        ...(coordinates ?? {}),
      };
    })
    .filter((entry): entry is LocationSuggestion => entry !== null);
}

export async function resolveLocationQuery(query: string): Promise<ResolvedLocation | null> {
  const token = getMapboxToken();
  const trimmed = trimValue(query);

  if (!token || !trimmed) {
    return null;
  }

  const endpoint = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  endpoint.searchParams.set('q', trimmed);
  endpoint.searchParams.set('access_token', token);
  endpoint.searchParams.set('country', 'gb');
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('limit', '1');

  const payload = await requestMapbox(endpoint);
  const feature = payload.features?.[0];

  if (!feature) {
    return null;
  }

  const coordinates = featureCoordinates(feature);

  if (!coordinates) {
    return null;
  }

  return {
    label: featureLabel(feature) || trimmed,
    ...coordinates,
  };
}
