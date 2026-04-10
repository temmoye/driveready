import { z } from 'zod';

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const signInSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(4, 'Enter your password.'),
});

export const signUpSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required.'),
  last_name: z.string().trim().min(1, 'Last name is required.'),
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  redirect_to: z.string().trim().min(1, 'Redirect URL is required.').optional(),
});

export const passwordResetConfirmSchema = z.object({
  access_token: z.string().trim().min(1, 'Recovery token is required.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const refreshSessionSchema = z.object({
  refresh_token: z.string().trim().min(1, 'Refresh token is required.'),
});

export const vehicleSchema = z.object({
  registration_plate: z
    .string()
    .trim()
    .min(5, 'Enter a valid UK plate.')
    .max(8, 'Enter a valid UK plate.'),
  nickname: z.string().trim().optional(),
  make_model: z.string().trim().optional(),
  fuel_type: z.string().trim().optional(),
  mileage: z.number().int().nonnegative().optional().catch(undefined),
  mot_due_at: dateField.optional(),
  tax_due_at: dateField.optional(),
  insurance_due_at: dateField.optional(),
  notes: z.string().optional(),
});
export const vehiclePatchSchema = vehicleSchema.partial();

export const documentSchema = z.object({
  vehicle_id: z.string().trim().min(1, 'Select a vehicle.'),
  title: z.string().trim().min(1, 'Enter a document title.'),
  document_type: z.enum(['mot', 'insurance', 'v5c', 'service']),
  expires_at: dateField,
  source_type: z.enum(['camera', 'files', 'email']),
  file_name: z.string().trim().min(1).optional(),
  file_key: z.string().trim().min(1).optional(),
  mime_type: z.string().trim().min(1).optional(),
});
export const documentPatchSchema = documentSchema.partial();

export const zoneSchema = z.object({
  name: z.string().trim().min(1, 'Enter a zone name.'),
  route_label: z.string().trim().min(1, 'Enter a route label.'),
  charge_amount_label: z.string().trim().min(1, 'Enter a charge label.'),
});
export const zonePatchSchema = zoneSchema.partial().extend({
  monitored: z.boolean().optional(),
});

export const tripCheckSchema = z.object({
  vehicle_id: z.string().trim().min(1, 'Select a vehicle.'),
  input_type: z.enum(['destination', 'saved_zone']),
  destination_query: z.string().trim().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  saved_zone_id: z.string().trim().optional(),
  persist_result: z.boolean().optional(),
});

export const refuelSearchSchema = z.object({
  origin_query: z.string().trim().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  energy_type: z.enum(['petrol', 'diesel', 'electric']),
  sort_by: z.enum(['closest', 'cheapest']).optional(),
});

export const alertPatchSchema = z.object({
  lead_days: z.number().int().nonnegative().optional(),
  muted: z.boolean().optional(),
  handled: z.boolean().optional(),
});

export const profilePatchSchema = z.object({
  first_name: z.string().trim().min(1).optional(),
  last_name: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address_line: z.string().optional(),
});

export const notificationPreferencesSchema = z.object({
  mot_enabled: z.boolean().optional(),
  tax_enabled: z.boolean().optional(),
  insurance_enabled: z.boolean().optional(),
  docs_enabled: z.boolean().optional(),
  zones_enabled: z.boolean().optional(),
});

export const permissionStatesSchema = z.object({
  notifications_state: z.enum(['granted', 'not_requested', 'denied']).optional(),
  camera_state: z.enum(['granted', 'not_requested', 'denied']).optional(),
  files_state: z.enum(['granted', 'not_requested', 'denied']).optional(),
  biometrics_state: z.enum(['granted', 'not_requested', 'denied']).optional(),
});

export const querySchema = z.object({
  q: z.string().trim().min(3, 'Enter at least 3 characters to search.'),
});

export const pushDeviceSchema = z.object({
  token: z.string().trim().min(8, 'A push token is required.'),
  platform: z.enum(['ios', 'android']),
  label: z.string().trim().optional(),
});

export const jobRunSchema = z.object({
  dry_run: z.boolean().optional(),
});

export function parseBody<T>(schema: z.ZodType<T>, payload: unknown) {
  const parsed = schema.safeParse(payload);

  if (parsed.success) {
    return {
      success: true as const,
      data: parsed.data,
    };
  }

  const flattened = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const fields = Object.fromEntries(
    Object.entries(flattened).map(([key, value]) => [
      key,
      value?.[0] ?? 'Invalid value.',
    ]),
  );

  return {
    success: false as const,
    message: parsed.error.issues[0]?.message ?? 'Validation failed.',
    fields,
  };
}
