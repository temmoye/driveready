export interface DestinationSuggestion {
  id: string;
  label: string;
  secondaryLabel?: string;
  longitude?: number;
  latitude?: number;
}

interface MapboxForwardGeocodingResponse {
  features?: Array<{
    id?: string;
    geometry?: {
      coordinates?: [number, number];
    };
    properties?: {
      full_address?: string;
      place_formatted?: string;
    };
    place_name?: string;
    name?: string;
  }>;
}

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ?? '';

export function hasMapboxToken() {
  return MAPBOX_TOKEN.length > 0;
}

export async function searchDestinationSuggestions(query: string): Promise<DestinationSuggestion[]> {
  const trimmed = query.trim();

  if (!MAPBOX_TOKEN || trimmed.length < 3) {
    return [];
  }

  const endpoint = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  endpoint.searchParams.set('q', trimmed);
  endpoint.searchParams.set('access_token', MAPBOX_TOKEN);
  endpoint.searchParams.set('country', 'gb');
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('limit', '5');

  const response = await fetch(endpoint.toString());

  if (!response.ok) {
    throw new Error(`Mapbox request failed: ${response.status}`);
  }

  const payload = (await response.json()) as MapboxForwardGeocodingResponse;

  const suggestions = (payload.features ?? []).map((feature, index) => {
      const label =
        feature.properties?.full_address?.trim() ??
        feature.place_name?.trim() ??
        feature.name?.trim() ??
        '';

      if (!label) {
        return null;
      }

      const coordinates = feature.geometry?.coordinates;

      return {
        id: feature.id ?? `suggestion-${index}`,
        label,
        ...(feature.properties?.place_formatted?.trim()
          ? { secondaryLabel: feature.properties.place_formatted.trim() }
          : {}),
        ...(typeof coordinates?.[0] === 'number' ? { longitude: coordinates[0] } : {}),
        ...(typeof coordinates?.[1] === 'number' ? { latitude: coordinates[1] } : {}),
      };
    })
    .filter((suggestion): suggestion is DestinationSuggestion => suggestion !== null);

  return suggestions;
}
