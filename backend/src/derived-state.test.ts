import { describe, expect, it } from 'vitest';

import { createEmptyUserAppData } from './data.js';
import { syncDerivedState } from './derived-state.js';

function buildState() {
  const state = createEmptyUserAppData({
    id: 'user-test',
    first_name: 'Alex',
    last_name: 'Driver',
    email: 'alex@example.com',
    phone: '',
    address_line: '',
  });

  state.vehicles = [
    {
      id: 'vehicle-risk',
      registration_plate: 'VO18XYZ',
      nickname: 'Work Van',
      make_model: 'Ford Transit',
      fuel_type: 'Diesel',
      mileage: 81240,
      mot_due_at: '2025-08-04',
      tax_due_at: '2025-08-20',
      insurance_due_at: '2025-08-25',
      notes: '',
      image_url: 'https://example.com/van.jpg',
    },
  ];
  state.documents = [
    {
      id: 'document-v5c',
      vehicle_id: 'vehicle-risk',
      title: 'V5C',
      document_type: 'v5c',
      uploaded_at: '2025-07-01T09:00:00.000Z',
      expires_at: '2025-08-10',
      source_type: 'files',
      file_name: 'v5c.pdf',
    },
  ];
  state.zones = [
    {
      id: 'zone-london',
      name: 'London ULEZ',
      route_label: 'Client run',
      charge_amount_label: 'GBP 12.50 daily charge',
      compliance_status: 'unknown',
      monitored: true,
      source_name: 'manual',
      freshness_at: '2025-08-01T09:00:00.000Z',
    },
  ];
  state.permission_states.notifications_state = 'granted';

  return state;
}

describe('syncDerivedState', () => {
  it('generates due-date alerts and reminder schedule entries', () => {
    const state = buildState();

    const changed = syncDerivedState(state, new Date('2025-08-01T12:00:00.000Z'));

    expect(changed).toBe(true);
    expect(state.alerts.map((alert) => alert.id)).toEqual(
      expect.arrayContaining([
        'alert:vehicle:vehicle-risk:mot',
        'alert:zone:zone-london:vehicle-risk',
        'alert:document:document-v5c',
        'alert:vehicle:vehicle-risk:tax',
        'alert:vehicle:vehicle-risk:insurance',
      ]),
    );
    expect(state.scheduled_reminders).toHaveLength(5);
    expect(state.scheduled_reminders.every((entry) => entry.status === 'scheduled')).toBe(true);
  });

  it('preserves handled state until the source due date changes', () => {
    const state = buildState();
    syncDerivedState(state, new Date('2025-08-01T12:00:00.000Z'));

    const motAlert = state.alerts.find((alert) => alert.id === 'alert:vehicle:vehicle-risk:mot');
    expect(motAlert).toBeDefined();

    if (!motAlert) {
      return;
    }

    motAlert.handled = true;
    const unchanged = syncDerivedState(state, new Date('2025-08-01T12:00:00.000Z'));
    expect(unchanged).toBe(true);
    expect(state.alerts.find((alert) => alert.id === motAlert.id)?.handled).toBe(true);

    state.vehicles[0].mot_due_at = '2025-09-20';
    syncDerivedState(state, new Date('2025-09-01T12:00:00.000Z'));
    expect(state.alerts.find((alert) => alert.id === motAlert.id)?.handled).toBe(false);
  });

  it('keeps failed reminder deliveries scheduled until the retry limit is reached', () => {
    const state = buildState();
    syncDerivedState(state, new Date('2025-08-01T12:00:00.000Z'));

    const reminder = state.scheduled_reminders.find((entry) => entry.alert_id === 'alert:vehicle:vehicle-risk:mot');
    expect(reminder).toBeDefined();

    if (!reminder) {
      return;
    }

    state.reminder_dispatches.push(
      {
        id: 'dispatch-1',
        reminder_id: reminder.id,
        scheduled_for: reminder.scheduled_for,
        provider: 'expo',
        status: 'failed',
        error: 'network_error',
      },
      {
        id: 'dispatch-2',
        reminder_id: reminder.id,
        scheduled_for: reminder.scheduled_for,
        provider: 'expo',
        status: 'failed',
        error: 'network_error',
      },
    );

    syncDerivedState(state, new Date('2025-08-01T12:00:00.000Z'));
    expect(state.scheduled_reminders.find((entry) => entry.id === reminder.id)?.status).toBe('scheduled');

    state.reminder_dispatches.push({
      id: 'dispatch-3',
      reminder_id: reminder.id,
      scheduled_for: reminder.scheduled_for,
      provider: 'expo',
      status: 'failed',
      error: 'network_error',
    });

    syncDerivedState(state, new Date('2025-08-01T12:00:00.000Z'));
    expect(state.scheduled_reminders.find((entry) => entry.id === reminder.id)?.status).toBe('failed');
  });
});
