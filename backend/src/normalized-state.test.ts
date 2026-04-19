import { describe, expect, it } from 'vitest';

import { createEmptyUserAppData } from './data.js';
import { applyNormalizedReadModel, buildNormalizedWriteModel, normalizedTables, type NormalizedReadModel } from './normalized-state.js';

function buildState() {
  const state = createEmptyUserAppData({
    id: 'user-normalized',
    first_name: 'Casey',
    last_name: 'Driver',
    email: 'casey@example.com',
    phone: '+44 7000 111222',
    address_line: '1 Test Street',
  });

  state.selected_vehicle_id = 'vehicle-1';
  state.vehicles = [
    {
      id: 'vehicle-1',
      registration_plate: 'AB12CDE',
      nickname: 'City Car',
      make_model: 'VW Golf',
      fuel_type: 'Petrol',
      mileage: 12000,
      mot_due_at: '2026-08-01',
      tax_due_at: '2026-07-01',
      insurance_due_at: '2026-06-01',
      notes: '',
      image_url: 'https://example.com/car.jpg',
    },
  ];
  state.documents = [
    {
      id: 'doc-1',
      vehicle_id: 'vehicle-1',
      title: 'Insurance',
      document_type: 'insurance',
      uploaded_at: '2026-04-09T10:00:00.000Z',
      expires_at: '2026-06-01',
      source_type: 'files',
      file_name: 'insurance.pdf',
      file_key: 'documents/insurance.pdf',
      mime_type: 'application/pdf',
    },
  ];
  state.data_exports = [
    {
      id: 'export-1',
      created_at: '2026-04-10T09:00:00.000Z',
      file_key: 'exports/export-1.json',
      file_name: 'export-1.json',
      mime_type: 'application/json',
      download_url: 'https://old.example/export-1.json',
      source_name: 'generated-json-export',
    },
  ];
  state.reminder_dispatches = [
    {
      id: 'dispatch-1',
      reminder_id: 'reminder-1',
      scheduled_for: '2026-04-10T09:00:00.000Z',
      provider: 'expo',
      status: 'sent',
      delivered_at: '2026-04-10T09:01:00.000Z',
      provider_message_id: 'expo-message-1',
    },
  ];

  return state;
}

function rowsForTable<T>(model: ReturnType<typeof buildNormalizedWriteModel>, table: string) {
  return model.repeatedTables.find((entry) => entry.table === table)?.rows as T[] | undefined;
}

describe('normalized state mapping', () => {
  it('builds normalized table rows including reminder dispatch history', () => {
    const model = buildNormalizedWriteModel('user-normalized', buildState());

    expect(model.profile.user_id).toBe('user-normalized');
    expect(rowsForTable(model, normalizedTables.vehicle)).toHaveLength(1);
    expect(rowsForTable(model, normalizedTables.reminderDispatch)).toHaveLength(1);
    expect(rowsForTable(model, normalizedTables.dataExport)?.[0]).toEqual(
      expect.objectContaining({
        file_key: 'exports/export-1.json',
        user_id: 'user-normalized',
      }),
    );
  });

  it('hydrates app state back from normalized rows and refreshes export URLs', async () => {
    const original = buildState();
    const model = buildNormalizedWriteModel('user-normalized', original);
    const target = createEmptyUserAppData({
      id: 'user-normalized',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      address_line: '',
    });

    await applyNormalizedReadModel(target, {
      profile: model.profile,
      vehicles: rowsForTable(model, normalizedTables.vehicle) as NormalizedReadModel['vehicles'],
      serviceHistory: [],
      documents: rowsForTable(model, normalizedTables.document) as NormalizedReadModel['documents'],
      alerts: [],
      zones: [],
      tripChecks: [],
      scheduledReminders: [],
      pushDevices: [],
      dataExports: rowsForTable(model, normalizedTables.dataExport) as NormalizedReadModel['dataExports'],
      reminderDispatches: rowsForTable(model, normalizedTables.reminderDispatch) as NormalizedReadModel['reminderDispatches'],
    });

    expect(target.user.email).toBe('casey@example.com');
    expect(target.selected_vehicle_id).toBe('vehicle-1');
    expect(target.vehicles).toHaveLength(1);
    expect(target.documents).toHaveLength(1);
    expect(target.reminder_dispatches).toHaveLength(1);
    expect(target.data_exports[0].download_url).toContain('/api/v1/files/download?');
  });
});
