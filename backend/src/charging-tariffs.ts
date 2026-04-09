import type { RefuelSortMode, RefuelStationOption } from './types.js';

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

export async function resolveElectricTariffs(input: {
  sortBy: RefuelSortMode;
  stations: RefuelStationOption[];
}) {
  const state = resolveChargingTariffConfigState();

  if (state.config) {
    return {
      degraded: [
        {
          code: 'ev_tariff_provider_configured_not_integrated',
          message: `EV tariff provider is configured (${state.config.provider}) but live tariff ingestion is not wired yet. Stations are sorted by distance.`,
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
