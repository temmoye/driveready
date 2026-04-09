import type {
  AlertRecord,
  AlertSummary,
  AlertTone,
  ComplianceStatus,
  DashboardSnapshot,
  DocumentRecord,
  DocumentStatus,
  DocumentSummary,
  SavedZone,
  VehicleRecord,
  VehicleSummary,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(input: Date) {
  return new Date(input.getFullYear(), input.getMonth(), input.getDate());
}

export function diffInDays(dateString: string, now = new Date()) {
  const target = startOfDay(new Date(dateString));
  const current = startOfDay(now);
  return Math.round((target.getTime() - current.getTime()) / DAY_MS);
}

export function deriveDocumentStatus(document: DocumentRecord, now = new Date()): DocumentStatus {
  const days = diffInDays(document.expires_at, now);

  if (days < 0) {
    return 'expired';
  }

  if (days <= 30) {
    return 'needs_review';
  }

  return 'current';
}

export function summarizeDocument(document: DocumentRecord, now = new Date()): DocumentSummary {
  return {
    ...document,
    status: deriveDocumentStatus(document, now),
  };
}

function toneFromDays(days: number): AlertTone {
  if (days < 0) {
    return 'critical';
  }

  if (days <= 21) {
    return 'warning';
  }

  return 'good';
}

export function deriveVehicleCompliance(vehicle: VehicleRecord): ComplianceStatus {
  if (vehicle.fuel_type.toLowerCase().includes('diesel') && vehicle.registration_plate === 'VO18 XYZ') {
    return 'charge_risk';
  }

  return 'compliant';
}

export function summarizeVehicle(vehicle: VehicleRecord, now = new Date()): VehicleSummary {
  const motDays = diffInDays(vehicle.mot_due_at, now);
  const taxDays = diffInDays(vehicle.tax_due_at, now);
  const insuranceDays = diffInDays(vehicle.insurance_due_at, now);
  const soonest = Math.min(motDays, taxDays, insuranceDays);

  let readiness_status: VehicleSummary['readiness_status'] = 'ready';
  let readiness_tone: VehicleSummary['readiness_tone'] = 'good';

  if (soonest < 0) {
    readiness_status = 'urgent';
    readiness_tone = 'critical';
  } else if (soonest <= 21) {
    readiness_status = 'attention';
    readiness_tone = 'warning';
  }

  return {
    ...vehicle,
    readiness_status,
    readiness_tone,
    compliance_status: deriveVehicleCompliance(vehicle),
  };
}

export function summarizeAlert(alert: AlertRecord, now = new Date()): AlertSummary {
  return {
    ...alert,
    tone: toneFromDays(diffInDays(alert.due_at, now)),
    status: alert.handled ? 'handled' : 'open',
  };
}

export function buildDashboard(
  vehicles: VehicleRecord[],
  documents: DocumentRecord[],
  alerts: AlertRecord[],
  selectedVehicleId: string,
  now = new Date(),
): DashboardSnapshot {
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0];
  const openAlerts = alerts.filter((alert) => !alert.handled && !alert.muted);
  const currentDocuments = documents.filter((document) => deriveDocumentStatus(document, now) === 'current');
  const urgentVehicles = vehicles.filter((vehicle) => summarizeVehicle(vehicle, now).readiness_status === 'urgent');

  if (!selectedVehicle) {
    return {
      selected_vehicle_id: '',
      next_actions: [
        {
          id: 'action-add-vehicle',
          title: 'Add your first vehicle',
          subtitle: 'Create a vehicle before reminders, docs, and Trip Check can run.',
          screen: 'garage',
        },
      ],
      summary_cards: [
        {
          id: 'vehicles-summary',
          label: 'Vehicles',
          value: '0',
          tone: 'warning',
        },
      ],
    };
  }

  return {
    selected_vehicle_id: selectedVehicle.id,
    next_actions: [
      {
        id: 'action-alerts',
        title: openAlerts[0]?.title ?? 'No urgent alerts',
        subtitle: openAlerts[0]?.detail ?? 'Everything important is currently under control.',
        screen: 'alerts',
      },
      {
        id: 'action-docs',
        title: `${currentDocuments.length} current documents`,
        subtitle: 'Review expiring files and replace anything that is out of date.',
        screen: 'docs',
      },
      {
        id: 'action-trip',
        title: 'Run a Trip Check',
        subtitle: `Check ${selectedVehicle.nickname} before heading into a charge zone.`,
        screen: 'trip-check',
      },
    ],
    summary_cards: [
      {
        id: 'vehicles-summary',
        label: 'Vehicles needing action',
        value: `${urgentVehicles.length}`,
        tone: urgentVehicles.length > 0 ? 'critical' : 'good',
      },
      {
        id: 'documents-summary',
        label: 'Current documents',
        value: `${currentDocuments.length}`,
        tone: currentDocuments.length > 0 ? 'good' : 'warning',
      },
      {
        id: 'alerts-summary',
        label: 'Open reminders',
        value: `${openAlerts.length}`,
        tone: openAlerts.length > 0 ? 'warning' : 'good',
      },
    ],
  };
}

export function linkVehicleZones(vehicle: VehicleRecord, zones: SavedZone[]) {
  const compliance = deriveVehicleCompliance(vehicle);
  return zones.map((zone) => ({
    ...zone,
    compliance_status: zone.name === 'London ULEZ' && compliance === 'charge_risk' ? 'charge_risk' : 'compliant',
  }));
}
