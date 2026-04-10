import type { RefuelSortMode, RefuelStationOption } from './types';

interface ChargingTariffConfig {
  apiBaseUrl: string;
  apiKey: string;
  provider: string;
}

interface ChargingTariffConfigState {
  config: ChargingTariffConfig | null;
  missing: string[];
  partiallyConfigured: boolean;
}

interface ChargingTariffRecord {
  connector_summary?: string;
  id?: string;
  price_label?: string;
  price_pence_per_kwh?: number;
  station_id?: string;
  updated_at?: string;
}

function trimValue(value?: string) {
  return value?.trim() ?? '';
}

function resolveChargingTariffConfigState(): ChargingTariffConfigState {
  const provider = trimValue(process.env.DRIVEREADY_EV_TARIFF_PROVIDER);
  const apiBaseUrl = trimValue(process.env.DRIVEREADY_EV_TARIFF_API_BASE_URL);
  const apiKey = trimValue(process.env.DRIVEREADY_EV_TARIFF_API_KEY);

  if (!provider && !apiBaseUrl && !apiKey) {
    return {
      config: null,
      missing: [],
      partiallyConfigured: false,
    };
  }

  const missing = [
    !provider ? 'DRIVEREADY_EV_TARIFF_PROVIDER' : null,
    !apiBaseUrl ? 'DRIVEREADY_EV_TARIFF_API_BASE_URL' : null,
    !apiKey ? 'DRIVEREADY_EV_TARIFF_API_KEY' : null,
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    return {
      config: null,
      missing,
      partiallyConfigured: true,
    };
  }

  return {
    config: {
      provider,
      apiBaseUrl,
      apiKey,
    },
    missing: [],
    partiallyConfigured: false,
  };
}

export function getChargingTariffTargetLabel() {
  const state = resolveChargingTariffConfigState();

  if (state.config) {
    return `${state.config.provider} (${state.config.apiBaseUrl})`;
  }

  if (state.partiallyConfigured) {
    return `misconfigured: missing ${state.missing.join(', ')}`;
  }

  return 'provider pending';
}

export function hasChargingTariffSetup() {
  const state = resolveChargingTariffConfigState();
  return state.partiallyConfigured || Boolean(state.config);
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

function liveTariffLabel(station: RefuelStationOption, tariff: ChargingTariffRecord) {
  if (tariff.price_label?.trim()) {
    return tariff.price_label.trim();
  }

  const distance = distanceLabel(station.distance_meters);
  const tariffLabel =
    typeof tariff.price_pence_per_kwh === 'number' && Number.isFinite(tariff.price_pence_per_kwh)
      ? `${tariff.price_pence_per_kwh.toFixed(1)}p/kWh`
      : 'Live tariff';

  return distance ? `${tariffLabel} · ${distance} away` : tariffLabel;
}

async function fetchTariffs(config: ChargingTariffConfig, stations: RefuelStationOption[]) {
  const endpoint = new URL('/tariffs', config.apiBaseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      stations: stations.map((station) => ({
        id: station.id,
        label: station.label,
        address: station.address,
        operator_name: station.operator_name,
        latitude: station.latitude,
        longitude: station.longitude,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Charging tariff provider failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as
    | ChargingTariffRecord[]
    | {
        tariffs?: ChargingTariffRecord[];
      };

  if (Array.isArray(payload)) {
    return payload;
  }

  return payload.tariffs ?? [];
}

export async function resolveElectricTariffs(input: {
  sortBy: RefuelSortMode;
  stations: RefuelStationOption[];
}) {
  const state = resolveChargingTariffConfigState();

  if (state.config) {
    const config = state.config;

    try {
      const tariffs = await fetchTariffs(config, input.stations);
      const tariffByStationId = new Map(
        tariffs
          .map((tariff) => {
            const stationId = tariff.station_id ?? tariff.id;
            return stationId ? ([stationId, tariff] as const) : null;
          })
          .filter((entry): entry is readonly [string, ChargingTariffRecord] => Boolean(entry)),
      );
      const stations = input.stations
        .map((station) => {
          const tariff = tariffByStationId.get(station.id);

          if (!tariff) {
            return station;
          }

          return {
            ...station,
            connector_summary: tariff.connector_summary ?? station.connector_summary,
            price_label: liveTariffLabel(station, tariff),
            price_is_available: true,
            price_updated_at: tariff.updated_at ?? station.price_updated_at,
            rank_reason: 'provider_match' as const,
            source_name: config.provider,
          };
        })
        .sort((left, right) => {
          if (input.sortBy === 'cheapest') {
            const leftPrice = Number.parseFloat(left.price_label);
            const rightPrice = Number.parseFloat(right.price_label);

            if (
              left.price_is_available &&
              right.price_is_available &&
              Number.isFinite(leftPrice) &&
              Number.isFinite(rightPrice) &&
              leftPrice !== rightPrice
            ) {
              return leftPrice - rightPrice;
            }

            if (left.price_is_available !== right.price_is_available) {
              return left.price_is_available ? -1 : 1;
            }
          }

          return (left.distance_meters ?? Number.MAX_SAFE_INTEGER) - (right.distance_meters ?? Number.MAX_SAFE_INTEGER);
        });
      const liveStationCount = stations.filter((station) => station.price_is_available).length;

      if (liveStationCount > 0) {
        return {
          degraded: liveStationCount === stations.length
            ? []
            : [
                {
                  code: 'ev_tariff_provider_partial_match',
                  message: 'Live EV tariffs were found for some chargers. Unmatched chargers are still shown with distance only.',
                },
              ],
          priceStatus: 'live' as const,
          stations,
        };
      }

      return {
        degraded: [
          {
            code: 'ev_tariff_provider_no_match',
            message: `EV tariff provider responded but did not match any nearby chargers. Showing distance-sorted results instead.`,
          },
        ],
        priceStatus: 'provider_pending' as const,
        stations: input.stations,
      };
    } catch (error) {
      return {
        degraded: [
          {
            code: 'ev_tariff_provider_unavailable',
            message: error instanceof Error
              ? error.message
              : 'EV tariff provider request failed. Showing distance-sorted chargers instead.',
          },
        ],
        priceStatus: 'provider_pending' as const,
        stations: input.stations,
      };
    }
  }

  if (state.partiallyConfigured) {
    return {
      degraded: [
        {
          code: 'ev_tariff_provider_misconfigured',
          message: `EV tariff provider is misconfigured. Missing ${state.missing.join(', ')}. Stations are sorted by distance.`,
        },
      ],
      priceStatus: 'provider_pending' as const,
      stations: input.stations,
    };
  }

  return {
    degraded: [
      {
        code: 'ev_tariff_provider_pending',
        message:
          input.sortBy === 'cheapest'
            ? 'Cheapest electric charging requires a live tariff provider. Results are currently sorted by distance.'
            : 'Live electric charging tariffs are pending a charging tariff provider.',
      },
    ],
    priceStatus: 'provider_pending' as const,
    stations: input.stations,
  };
}
