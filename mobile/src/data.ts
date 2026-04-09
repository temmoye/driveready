export type VehicleStatus = 'clear' | 'warning' | 'critical';
export type DocumentTone = 'good' | 'warning' | 'neutral';
export type DocumentKind = 'mot' | 'insurance' | 'logbook' | 'service';

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  subtitle: string;
  status: VehicleStatus;
  statusLabel: string;
  serviceLabel: string;
  detailLabel: string;
  complianceLabel: string;
  image: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  kind: DocumentKind;
  uploadedLabel: string;
  metaLabel: string;
  statusLabel: string;
  statusTone: DocumentTone;
  previewText: string;
}

export interface ZoneRecord {
  id: string;
  name: string;
  chargeLabel: string;
  routeLabel: string;
  image: string;
  compliant: boolean;
}

export const initialVehicles: Vehicle[] = [
  {
    id: 'family-suv',
    name: 'The Family SUV',
    plate: 'LR19 ABC',
    subtitle: 'Last updated just now',
    status: 'clear',
    statusLabel: 'All clear',
    serviceLabel: 'Next service Sept 2024',
    detailLabel: 'Insurance expires in 12 days',
    complianceLabel: 'ULEZ compliant',
    image:
      'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1200&q=80',
  },
  {
    id: 'work-van',
    name: 'The Work Van',
    plate: 'VO18 XYZ',
    subtitle: 'Attention needed',
    status: 'critical',
    statusLabel: 'MOT overdue',
    serviceLabel: 'Book MOT today',
    detailLabel: 'Roadworthiness certificate expired',
    complianceLabel: 'CAZ checked',
    image:
      'https://images.unsplash.com/photo-1519643381401-22c77e60520e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    id: 'commuter',
    name: 'The Commuter Car',
    plate: 'HJ67 LMN',
    subtitle: 'Tax due soon',
    status: 'warning',
    statusLabel: 'Tax due in 15 days',
    serviceLabel: 'Renew now',
    detailLabel: 'Vehicle tax renews this month',
    complianceLabel: 'Bristol ready',
    image:
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
  },
];

export const initialDocuments: DocumentRecord[] = [
  {
    id: 'mot',
    title: 'MOT Certificate',
    kind: 'mot',
    uploadedLabel: 'Last uploaded 14 May 2023',
    metaLabel: 'PDF • 1.2MB',
    statusLabel: 'Current',
    statusTone: 'good',
    previewText:
      'Annual MOT certificate with a pass result and advisory notes captured in your secure document vault.',
  },
  {
    id: 'insurance',
    title: 'Insurance Policy',
    kind: 'insurance',
    uploadedLabel: 'Last uploaded 02 Jan 2024',
    metaLabel: 'JPEG • 450KB',
    statusLabel: 'Verified',
    statusTone: 'good',
    previewText:
      'Current insurance confirmation including policy number, renewal date, and named drivers.',
  },
  {
    id: 'logbook',
    title: 'V5C Logbook',
    kind: 'logbook',
    uploadedLabel: 'Last uploaded 12 Aug 2022',
    metaLabel: 'PDF • 3.4MB',
    statusLabel: 'Update required',
    statusTone: 'warning',
    previewText:
      'V5C registration document stored for ownership reference. Address details should be refreshed after your move.',
  },
];

export const savedZones: ZoneRecord[] = [
  {
    id: 'london',
    name: 'London ULEZ',
    chargeLabel: '£12.50 daily charge',
    routeLabel: 'Morning school route',
    image:
      'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1200&q=80',
    compliant: true,
  },
  {
    id: 'birmingham',
    name: 'Birmingham CAZ',
    chargeLabel: '£8.00 daily charge',
    routeLabel: 'Client visits',
    image:
      'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80',
    compliant: true,
  },
  {
    id: 'bristol',
    name: 'Bristol CAZ',
    chargeLabel: '£9.00 daily charge',
    routeLabel: 'Weekend trips',
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
    compliant: true,
  },
];
