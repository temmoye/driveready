import type { VehicleDvlaSnapshot, VehicleRecord } from './types.js';

interface DvlaVesResponse {
  registrationNumber?: string;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
  motExpiryDate?: string;
  make?: string;
  monthOfFirstDvlaRegistration?: string;
  monthOfFirstRegistration?: string;
  yearOfManufacture?: number;
  engineCapacity?: number;
  co2Emissions?: number;
  fuelType?: string;
  markedForExport?: boolean;
  colour?: string;
  typeApproval?: string;
  wheelplan?: string;
  revenueWeight?: number;
  realDrivingEmissions?: string;
  euroStatus?: string;
  dateOfLastV5CIssued?: string;
}

interface DvlaVesErrorResponse {
  errors?: Array<{
    title?: string;
    detail?: string;
  }>;
}

export interface DvlaVesEnrichment {
  freshnessAt: string;
  sourceName: string;
  vehicle: VehicleRecord;
}

export class DvlaVesError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'DvlaVesError';
    this.statusCode = statusCode;
  }
}

const DEFAULT_DVLA_VES_BASE_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry';
const DVLA_VES_SOURCE_NAME = 'dvla-vehicle-enquiry-service';

function getDvlaVesApiKey() {
  return process.env.DRIVEREADY_DVLA_VES_API_KEY?.trim() ?? '';
}

function getDvlaVesBaseUrl() {
  return (process.env.DRIVEREADY_DVLA_VES_BASE_URL?.trim() || DEFAULT_DVLA_VES_BASE_URL).replace(/\/+$/, '');
}

function normalizeRegistration(registrationPlate: string) {
  return registrationPlate.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function titleCase(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }

  return value
    .toLowerCase()
    .split(/[\s/-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mapVehicleSnapshot(payload: DvlaVesResponse, registrationChecked: string, checkedAt: string): VehicleDvlaSnapshot {
  return {
    checked_at: checkedAt,
    ...(typeof payload.co2Emissions === 'number' ? { co2_emissions: payload.co2Emissions } : {}),
    ...(payload.colour ? { colour: titleCase(payload.colour) } : {}),
    ...(payload.dateOfLastV5CIssued ? { date_of_last_v5c_issued: payload.dateOfLastV5CIssued } : {}),
    ...(typeof payload.engineCapacity === 'number' ? { engine_capacity: payload.engineCapacity } : {}),
    ...(payload.euroStatus ? { euro_status: payload.euroStatus } : {}),
    ...(payload.fuelType ? { fuel_type: titleCase(payload.fuelType) } : {}),
    ...(payload.make ? { make: titleCase(payload.make) } : {}),
    ...(typeof payload.markedForExport === 'boolean' ? { marked_for_export: payload.markedForExport } : {}),
    ...(payload.monthOfFirstDvlaRegistration ? { month_of_first_dvla_registration: payload.monthOfFirstDvlaRegistration } : {}),
    ...(payload.monthOfFirstRegistration ? { month_of_first_registration: payload.monthOfFirstRegistration } : {}),
    ...(payload.motExpiryDate ? { mot_expiry_date: payload.motExpiryDate } : {}),
    ...(payload.motStatus ? { mot_status: payload.motStatus } : {}),
    ...(payload.realDrivingEmissions ? { real_driving_emissions: payload.realDrivingEmissions } : {}),
    ...(typeof payload.revenueWeight === 'number' ? { revenue_weight: payload.revenueWeight } : {}),
    registration_checked: registrationChecked,
    source_name: DVLA_VES_SOURCE_NAME,
    ...(payload.taxDueDate ? { tax_due_date: payload.taxDueDate } : {}),
    ...(payload.taxStatus ? { tax_status: payload.taxStatus } : {}),
    ...(payload.typeApproval ? { type_approval: payload.typeApproval } : {}),
    ...(payload.wheelplan ? { wheelplan: payload.wheelplan } : {}),
    ...(typeof payload.yearOfManufacture === 'number' ? { year_of_manufacture: payload.yearOfManufacture } : {}),
  };
}

async function parseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as DvlaVesErrorResponse | null;
  const detail = payload?.errors?.[0]?.detail?.trim();
  const title = payload?.errors?.[0]?.title?.trim();

  return detail || title || `DVLA VES request failed: ${response.status}`;
}

export function usesDvlaVes() {
  return getDvlaVesApiKey().length > 0;
}

export function getDvlaVesTargetLabel() {
  if (!usesDvlaVes()) {
    return 'DVLA VES (not configured)';
  }

  return `DVLA VES (${getDvlaVesBaseUrl()})`;
}

export async function enrichVehicleWithDvlaVes(vehicle: VehicleRecord): Promise<DvlaVesEnrichment> {
  const apiKey = getDvlaVesApiKey();

  if (!apiKey) {
    throw new DvlaVesError('DVLA VES is not configured.', 503);
  }

  const registrationNumber = normalizeRegistration(vehicle.registration_plate);
  const checkedAt = new Date().toISOString();
  const response = await fetch(`${getDvlaVesBaseUrl()}/v1/vehicles`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      registrationNumber,
    }),
  });

  if (!response.ok) {
    throw new DvlaVesError(await parseError(response), response.status);
  }

  const payload = (await response.json()) as DvlaVesResponse;
  const snapshot = mapVehicleSnapshot(payload, registrationNumber, checkedAt);

  return {
    freshnessAt: checkedAt,
    sourceName: DVLA_VES_SOURCE_NAME,
    vehicle: {
      ...vehicle,
      fuel_type: titleCase(payload.fuelType) ?? vehicle.fuel_type,
      make_model: titleCase(payload.make) ?? vehicle.make_model,
      mot_due_at: isIsoDate(payload.motExpiryDate) ? payload.motExpiryDate : vehicle.mot_due_at,
      registration_plate: payload.registrationNumber?.trim() || vehicle.registration_plate,
      tax_due_at: isIsoDate(payload.taxDueDate) ? payload.taxDueDate : vehicle.tax_due_at,
      dvla_ves: snapshot,
    },
  };
}
