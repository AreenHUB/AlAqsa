// ============================================================================
// AlAqsa — Shared constants
// ============================================================================

export const APP_NAME = 'AlAqsa';
export const APP_NAME_AR = 'الأقصى';
export const APP_VERSION = '1.0.0';

export const AUTHOR = {
  name: 'Areen Abou Fakher',
  nameAr: 'أرين أبو فاخر',
  email: 'arin.aboufakher@gmail.com',
  phone: '+971509471769',
  github: 'AreenHUB',
  githubUrl: 'https://github.com/AreenHUB',
  repo: 'https://github.com/AreenHUB/AlAqsa',
};

/** LAN sync port for host/client mode. */
export const SYNC_PORT = 7431;
export const MDNS_SERVICE_TYPE = 'alaqsa-sync';

/** Brand palette (blue). Kept in sync with theme.css tokens. */
export const COLORS = {
  primary: '#0B4F8A',
  primaryLight: '#1E88E5',
  primaryPale: '#E3F2FD',
  bg: '#F7F9FC',
};

/** System status labels seeded on first run. */
export const SYSTEM_STATUS_LABELS = [
  { key: 'completed', name_ar: 'مكتمل', name_en: 'Completed', color: '#22c55e' },
  { key: 'in_progress', name_ar: 'عمل جارٍ', name_en: 'In progress', color: '#1E88E5' },
  { key: 'follow_up', name_ar: 'يحتاج متابعة', name_en: 'Needs follow-up', color: '#f59e0b' },
  { key: 'fault', name_ar: 'عطل', name_en: 'Fault', color: '#ef4444' },
  { key: 'stopped', name_ar: 'متوقف', name_en: 'Stopped', color: '#6b7280' },
  { key: 'under_warranty', name_ar: 'تحت الضمان', name_en: 'Under warranty', color: '#8b5cf6' },
] as const;

export const DEVICE_TYPES = [
  { value: 'camera', ar: 'كاميرا', en: 'Camera' },
  { value: 'nvr', ar: 'مسجل NVR', en: 'NVR' },
  { value: 'dvr', ar: 'مسجل DVR', en: 'DVR' },
  { value: 'hdd', ar: 'قرص صلب', en: 'Hard Disk' },
  { value: 'switch', ar: 'سويتش', en: 'Switch' },
  { value: 'poe_switch', ar: 'سويتش PoE', en: 'PoE Switch' },
  { value: 'router', ar: 'راوتر', en: 'Router' },
  { value: 'ups', ar: 'UPS', en: 'UPS' },
  { value: 'other', ar: 'أخرى', en: 'Other' },
] as const;

export const CLIENT_TYPES = [
  { value: 'person', ar: 'شخص', en: 'Person' },
  { value: 'company', ar: 'شركة', en: 'Company' },
  { value: 'shop', ar: 'محل', en: 'Shop' },
  { value: 'restaurant', ar: 'مطعم', en: 'Restaurant' },
  { value: 'villa', ar: 'فيلا', en: 'Villa' },
  { value: 'house', ar: 'منزل', en: 'House' },
  { value: 'other', ar: 'أخرى', en: 'Other' },
] as const;

export const VISIT_TYPES = [
  { value: 'maintenance', ar: 'صيانة', en: 'Maintenance' },
  { value: 'installation', ar: 'تركيب', en: 'Installation' },
  { value: 'supply', ar: 'تزويد معدات', en: 'Supply' },
  { value: 'repair', ar: 'إصلاح', en: 'Repair' },
  { value: 'inspection', ar: 'معاينة', en: 'Inspection' },
] as const;

export const DOCUMENT_KINDS = [
  { value: 'passport', ar: 'جواز سفر', en: 'Passport' },
  { value: 'emirates_id', ar: 'الهوية الإماراتية', en: 'Emirates ID' },
  { value: 'trade_license', ar: 'الرخصة التجارية', en: 'Trade License' },
  { value: 'pledge', ar: 'تعهد (Pledge)', en: 'Pledge' },
  { value: 'building_plan', ar: 'مخطط المبنى', en: 'Building Plan' },
  { value: 'building_photo', ar: 'صور المبنى', en: 'Building Photos' },
  { value: 'contract', ar: 'عقد', en: 'Contract' },
  { value: 'invoice', ar: 'فاتورة', en: 'Invoice' },
  { value: 'camera_license', ar: 'رخصة الكاميرات', en: 'Camera License' },
  { value: 'other', ar: 'أخرى', en: 'Other' },
] as const;
