import type { AppData, UserProfile } from './types.js';

const nowIso = new Date().toISOString();

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoTimestampFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export const appData: AppData = {
  user: {
    id: 'user-1',
    first_name: 'James',
    last_name: 'Harrington',
    email: 'james@driveready.uk',
    phone: '+44 7700 900123',
    address_line: '31 Canalside Walk, Leeds',
  },
  notification_preferences: {
    mot_enabled: true,
    tax_enabled: true,
    insurance_enabled: true,
    docs_enabled: true,
    zones_enabled: true,
  },
  permission_states: {
    notifications_state: 'granted',
    camera_state: 'granted',
    files_state: 'granted',
    biometrics_state: 'granted',
  },
  session: null,
  selected_vehicle_id: 'vehicle-family',
  vehicles: [
    {
      id: 'vehicle-family',
      registration_plate: 'LR19 ABC',
      nickname: 'Family SUV',
      make_model: 'Range Rover Evoque',
      fuel_type: 'Petrol Hybrid',
      mileage: 42310,
      mot_due_at: isoDateFromNow(240),
      tax_due_at: isoDateFromNow(120),
      insurance_due_at: isoDateFromNow(45),
      notes: 'Main family vehicle used for school and weekend trips.',
      image_url:
        'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1200&q=80',
    },
    {
      id: 'vehicle-work',
      registration_plate: 'VO18 XYZ',
      nickname: 'Work Van',
      make_model: 'Ford Transit Custom',
      fuel_type: 'Diesel',
      mileage: 81240,
      mot_due_at: isoDateFromNow(-10),
      tax_due_at: isoDateFromNow(12),
      insurance_due_at: isoDateFromNow(6),
      notes: 'Used for delivery runs into London and Birmingham.',
      image_url:
        'https://images.unsplash.com/photo-1519643381401-22c77e60520e?auto=format&fit=crop&w=1200&q=80',
    },
    {
      id: 'vehicle-city',
      registration_plate: 'HJ67 LMN',
      nickname: 'City Hatch',
      make_model: 'Audi A3',
      fuel_type: 'Petrol',
      mileage: 57210,
      mot_due_at: isoDateFromNow(90),
      tax_due_at: isoDateFromNow(18),
      insurance_due_at: isoDateFromNow(132),
      notes: 'Daily commuter and evening city trips.',
      image_url:
        'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
    },
  ],
  service_history: [
    {
      id: 'service-1',
      vehicle_id: 'vehicle-family',
      event_date: '2025-05-14',
      title: 'Annual service completed',
      note: 'Oil, filters, and brake check completed.',
    },
    {
      id: 'service-2',
      vehicle_id: 'vehicle-work',
      event_date: '2025-03-21',
      title: 'Tyres replaced',
      note: 'Front tyres replaced before motorway work.',
    },
    {
      id: 'service-3',
      vehicle_id: 'vehicle-city',
      event_date: '2025-06-11',
      title: 'Brake pads checked',
      note: 'No immediate action required.',
    },
  ],
  documents: [
    {
      id: 'doc-mot',
      vehicle_id: 'vehicle-family',
      title: 'MOT Certificate 2025',
      document_type: 'mot',
      uploaded_at: isoTimestampFromNow(-40),
      expires_at: isoDateFromNow(240),
      source_type: 'files',
      file_name: 'mot-2025.pdf',
    },
    {
      id: 'doc-insurance',
      vehicle_id: 'vehicle-family',
      title: 'Insurance Policy',
      document_type: 'insurance',
      uploaded_at: isoTimestampFromNow(-10),
      expires_at: isoDateFromNow(45),
      source_type: 'email',
      file_name: 'insurance-policy.pdf',
    },
    {
      id: 'doc-v5c',
      vehicle_id: 'vehicle-city',
      title: 'V5C Logbook',
      document_type: 'v5c',
      uploaded_at: isoTimestampFromNow(-70),
      expires_at: isoDateFromNow(14),
      source_type: 'files',
      file_name: 'v5c.pdf',
    },
  ],
  alerts: [
    {
      id: 'alert-mot-work',
      vehicle_id: 'vehicle-work',
      alert_type: 'mot',
      title: 'MOT overdue',
      subtitle: 'Work Van',
      detail: 'This vehicle needs an MOT before it should be used again.',
      due_at: isoDateFromNow(-10),
      lead_days: 14,
      muted: false,
      handled: false,
    },
    {
      id: 'alert-tax-city',
      vehicle_id: 'vehicle-city',
      alert_type: 'tax',
      title: 'Tax renews soon',
      subtitle: 'City Hatch',
      detail: 'Vehicle tax is due soon. Renew before the due date.',
      due_at: isoDateFromNow(18),
      lead_days: 21,
      muted: false,
      handled: false,
    },
    {
      id: 'alert-doc-v5c',
      vehicle_id: 'vehicle-city',
      document_id: 'doc-v5c',
      alert_type: 'document',
      title: 'V5C needs review',
      subtitle: 'City Hatch',
      detail: 'Review address details and replace with the current document.',
      due_at: isoDateFromNow(14),
      lead_days: 30,
      muted: false,
      handled: false,
    },
    {
      id: 'alert-zone-london',
      vehicle_id: 'vehicle-work',
      zone_id: 'zone-london',
      alert_type: 'zone',
      title: 'London ULEZ charge risk',
      subtitle: 'Work Van',
      detail: 'This diesel vehicle may incur a daily charge in London ULEZ.',
      due_at: isoDateFromNow(2),
      lead_days: 1,
      muted: false,
      handled: false,
    },
  ],
  zones: [
    {
      id: 'zone-london',
      name: 'London ULEZ',
      route_label: 'Morning school run',
      charge_amount_label: '£12.50 daily charge',
      compliance_status: 'compliant',
      monitored: true,
      source_name: 'tfl-dataset',
      freshness_at: nowIso,
    },
    {
      id: 'zone-birmingham',
      name: 'Birmingham CAZ',
      route_label: 'Client meetings',
      charge_amount_label: '£8.00 daily charge',
      compliance_status: 'compliant',
      monitored: true,
      source_name: 'brum-caz',
      freshness_at: nowIso,
    },
    {
      id: 'zone-bristol',
      name: 'Bristol CAZ',
      route_label: 'Weekend shopping',
      charge_amount_label: '£9.00 daily charge',
      compliance_status: 'compliant',
      monitored: false,
      source_name: 'bristol-caz',
      freshness_at: nowIso,
    },
  ],
  trip_checks: [
    {
      id: 'trip-1',
      vehicle_id: 'vehicle-family',
      input_type: 'destination',
      destination_query: 'Shoreditch High Street, London',
      compliance_status: 'compliant',
      charge_amount_label: '£0.00',
      confidence_label: 'high',
      freshness_at: nowIso,
      source_name: 'zone-provider',
      parking_suggestions: [
        {
          id: 'park-1',
          label: 'Boundary Street',
          price_band: 'Free after 18:00',
          is_free: false,
          walking_distance_meters: 420,
          restriction_note: 'Permit-only before 18:00',
          confidence_label: 'medium',
          source_name: 'parking-provider',
          freshness_at: nowIso,
        },
        {
          id: 'park-2',
          label: 'Sclater Street Car Park',
          price_band: '£4.20 / hr',
          is_free: false,
          walking_distance_meters: 260,
          restriction_note: 'Covered parking, pay by app',
          confidence_label: 'high',
          source_name: 'parking-provider',
          freshness_at: nowIso,
        },
      ],
    },
  ],
};

export function createInitialAppData(userOverrides?: Partial<UserProfile>) {
  const state = structuredClone(appData);

  if (userOverrides) {
    state.user = {
      ...state.user,
      phone: '',
      address_line: '',
      ...userOverrides,
    };
  }

  state.session = null;
  return state;
}
