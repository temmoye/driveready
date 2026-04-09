export type ComplianceStatus = 'compliant' | 'charge_risk' | 'unknown';
export type AlertStatus = 'open' | 'handled';
export type AlertTone = 'good' | 'warning' | 'critical';
export type DocumentStatus = 'current' | 'needs_review' | 'expired';
export type PermissionState = 'granted' | 'not_requested' | 'denied';
export type ParkingConfidence = 'high' | 'medium' | 'low';
export type RefuelEnergyType = 'petrol' | 'diesel' | 'electric';
export type RefuelSortMode = 'closest' | 'cheapest';
export type TripInputType = 'destination' | 'saved_zone';
export type VehicleReadiness = 'ready' | 'attention' | 'urgent';
export type VehicleMotRecallStatus = 'Yes' | 'No' | 'Unknown' | 'Unavailable';
export type VehicleMotTestResult = 'PASSED' | 'FAILED';
export type VehicleMotOdometerUnit = 'MI' | 'KM';
export type VehicleMotOdometerResultType = 'READ' | 'UNREADABLE' | 'NO_ODOMETER';

export interface SessionState {
  token: string;
  refresh_token?: string;
  expires_at: string;
}

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line: string;
}

export interface NotificationPreferences {
  mot_enabled: boolean;
  tax_enabled: boolean;
  insurance_enabled: boolean;
  docs_enabled: boolean;
  zones_enabled: boolean;
}

export interface PermissionStates {
  notifications_state: PermissionState;
  camera_state: PermissionState;
  files_state: PermissionState;
  biometrics_state: PermissionState;
}

export interface VehicleSummary {
  id: string;
  registration_plate: string;
  nickname: string;
  make_model: string;
  fuel_type: string;
  mileage: number;
  mot_due_at: string;
  tax_due_at: string;
  insurance_due_at: string;
  notes: string;
  image_url: string;
  dvla_ves?: VehicleDvlaSnapshot;
  dvsa_mot?: VehicleMotSnapshot;
  readiness_status: VehicleReadiness;
  readiness_tone: AlertTone;
  compliance_status: ComplianceStatus;
}

export interface VehicleDvlaSnapshot {
  checked_at: string;
  co2_emissions?: number;
  colour?: string;
  date_of_last_v5c_issued?: string;
  engine_capacity?: number;
  euro_status?: string;
  fuel_type?: string;
  make?: string;
  marked_for_export?: boolean;
  month_of_first_dvla_registration?: string;
  month_of_first_registration?: string;
  mot_expiry_date?: string;
  mot_status?: string;
  real_driving_emissions?: string;
  registration_checked: string;
  revenue_weight?: number;
  source_name: string;
  tax_due_date?: string;
  tax_status?: string;
  type_approval?: string;
  wheelplan?: string;
  year_of_manufacture?: number;
}

export interface VehicleMotTestSnapshot {
  completed_at: string;
  data_source: string;
  defect_count: number;
  dangerous_defect_count: number;
  expiry_date?: string;
  mot_test_number?: string;
  odometer_result_type: VehicleMotOdometerResultType;
  odometer_unit?: VehicleMotOdometerUnit;
  odometer_value?: number;
  test_result: VehicleMotTestResult;
}

export interface VehicleMotSnapshot {
  checked_at: string;
  engine_size?: string;
  first_used_date?: string;
  last_test: VehicleMotTestSnapshot | null;
  make?: string;
  manufacture_date?: string;
  model?: string;
  mot_test_due_date?: string;
  primary_colour?: string;
  recall_status: VehicleMotRecallStatus;
  registration_checked: string;
  registration_date?: string;
  source_name: string;
  test_count: number;
}

export interface VehicleServiceHistoryEntry {
  id: string;
  vehicle_id: string;
  event_date: string;
  title: string;
  note: string;
}

export interface DocumentSummary {
  id: string;
  vehicle_id: string;
  title: string;
  document_type: 'mot' | 'insurance' | 'v5c' | 'service';
  uploaded_at: string;
  expires_at: string;
  source_type: 'camera' | 'files' | 'email';
  file_name: string;
  file_key?: string;
  mime_type?: string;
  status: DocumentStatus;
}

export interface AlertSummary {
  id: string;
  vehicle_id?: string;
  document_id?: string;
  zone_id?: string;
  alert_type: 'mot' | 'tax' | 'insurance' | 'document' | 'zone';
  title: string;
  subtitle: string;
  detail: string;
  due_at: string;
  lead_days: number;
  muted: boolean;
  handled: boolean;
  tone: AlertTone;
  status: AlertStatus;
}

export interface SavedZone {
  id: string;
  name: string;
  route_label: string;
  charge_amount_label: string;
  compliance_status: ComplianceStatus;
  monitored: boolean;
  source_name: string;
  freshness_at: string;
}

export interface ParkingSuggestion {
  id: string;
  label: string;
  price_band: string;
  is_free: boolean;
  walking_distance_meters: number;
  restriction_note: string;
  confidence_label: ParkingConfidence;
  source_name: string;
  freshness_at: string;
}

export interface TripCheckRecord {
  id: string;
  vehicle_id: string;
  input_type: TripInputType;
  destination_query?: string;
  saved_zone_id?: string;
  compliance_status: ComplianceStatus;
  charge_amount_label: string;
  confidence_label: ParkingConfidence;
  freshness_at: string;
  source_name: string;
  parking_suggestions: ParkingSuggestion[];
}

export interface RefuelStationOption {
  id: string;
  label: string;
  address: string;
  operator_name?: string;
  energy_type: RefuelEnergyType;
  distance_meters?: number;
  latitude?: number;
  longitude?: number;
  connector_summary?: string;
  price_label: string;
  price_is_available: boolean;
  price_updated_at?: string;
  rank_reason: 'nearest' | 'cheapest' | 'provider_match';
  source_name: string;
  freshness_at: string;
}

export interface RefuelSearchSummary {
  energy_type: RefuelEnergyType;
  freshness_at: string;
  location_status: 'resolved' | 'not_resolved';
  origin_label: string;
  price_status: 'live' | 'provider_pending';
  sort_by: RefuelSortMode;
  source_name: string;
  latitude?: number;
  longitude?: number;
}

export interface RefuelSearchResponse {
  degraded: Array<{
    code: string;
    message: string;
  }>;
  search: RefuelSearchSummary;
  stations: RefuelStationOption[];
}

export interface DashboardSnapshot {
  selected_vehicle_id: string;
  next_actions: Array<{
    id: string;
    title: string;
    subtitle: string;
    screen: 'alerts' | 'docs' | 'trip-check' | 'garage';
  }>;
  summary_cards: Array<{
    id: string;
    label: string;
    value: string;
    tone: AlertTone;
  }>;
}

export interface VehicleDetailResponse {
  vehicle: VehicleSummary;
  service_history: VehicleServiceHistoryEntry[];
  linked_documents: DocumentSummary[];
  linked_zones: SavedZone[];
}

export interface DocumentDetailResponse {
  document: DocumentSummary;
  linked_vehicle: VehicleSummary;
}

export interface DashboardResponse {
  dashboard: DashboardSnapshot;
  selected_vehicle: VehicleSummary | null;
}

export interface SupportItem {
  id: string;
  title: string;
  body: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
