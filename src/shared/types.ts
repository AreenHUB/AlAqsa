// ============================================================================
// AlAqsa — Shared domain types (used by both main process and renderer)
// ============================================================================

export type UUID = string;
/** ISO-8601 date string, e.g. "2026-08-14" or full timestamp. */
export type ISODate = string;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export type ClientType =
  | 'person'
  | 'company'
  | 'shop'
  | 'restaurant'
  | 'villa'
  | 'house'
  | 'other';

/** Workflow/status color of a record. Includes user-defined custom labels. */
export interface StatusLabel {
  id: UUID;
  name_ar: string;
  name_en: string;
  color: string; // hex, e.g. "#22c55e"
  isSystem: boolean;
}

export interface Contact {
  id: UUID;
  clientId: UUID;
  name: string;
  role?: string; // الصفة: مالك، مدير، مسؤول فرع...
  phones: string[];
  emails: string[];
  isPrimary: boolean;
  order: number;
}

export interface Client {
  id: UUID;
  code: string; // human-friendly code, e.g. ALQ-0001
  type: ClientType;
  nameAr: string;
  nameEn?: string;
  statusLabelId?: UUID;
  rating: number; // 0..5
  isFlagged: boolean; // red warning flag (bad payer, etc.)
  flagReason?: string;
  notes?: string;
  dealCount: number; // عدد مرات التعامل (derived + stored)
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export interface GeoLocation {
  address?: string;
  lat?: number;
  lng?: number;
  mapUrl?: string;
}

export interface Branch {
  id: UUID;
  clientId: UUID;
  nameAr: string;
  nameEn?: string;
  location: GeoLocation;
  statusLabelId?: UUID;
  managerContact?: string;
  notes?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export type DeviceType =
  | 'camera'
  | 'nvr'
  | 'dvr'
  | 'hdd'
  | 'switch'
  | 'poe_switch'
  | 'router'
  | 'ups'
  | 'other';

/**
 * Where the device came from.
 *  - ours     : sold/installed by us, full details known
 *  - existing : the client already owned it (e.g. brought from abroad); the
 *               details are often unknown and must NOT be mandatory
 *  - mixed    : client had equipment and also bought some from us
 */
export type DeviceSource = 'ours' | 'existing' | 'mixed';

export type HealthState = 'excellent' | 'good' | 'warning' | 'faulty';

export interface Device {
  id: UUID;
  branchId: UUID;
  type: DeviceType;
  label?: string; // رقم/اسم الكاميرا أو الجهاز
  positionInBranch?: string; // الموقع داخل الفرع
  manufacturer?: string;
  model?: string;
  serialNumber?: string; // S/N (barcode)
  channels?: number; // NVR channels
  capacity?: string; // HDD capacity
  firmware?: string;
  source: DeviceSource;
  installDate?: ISODate;
  warrantyExpiry?: ISODate;
  health?: HealthState;
  inventoryItemId?: UUID; // link to shop inventory when source = ours
  notes?: string;
  photos: MediaRef[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ---------------------------------------------------------------------------
// Documents & media
// ---------------------------------------------------------------------------

export type DocumentKind =
  | 'passport'
  | 'emirates_id'
  | 'trade_license'
  | 'pledge'
  | 'building_plan'
  | 'building_photo'
  | 'contract'
  | 'invoice'
  | 'camera_license'
  | 'other';

export interface MediaRef {
  id: UUID;
  fileName: string;
  storedPath: string; // relative path inside encrypted files dir
  mimeType: string;
  sizeBytes: number;
  createdAt: ISODate;
}

export interface DocumentRecord {
  id: UUID;
  clientId?: UUID;
  branchId?: UUID;
  kind: DocumentKind;
  title: string;
  media: MediaRef;
  issueDate?: ISODate;
  expiryDate?: ISODate;
  notes?: string;
  createdAt: ISODate;
}

/** UAE camera license (رخصة الكاميرات). */
export interface CameraLicense {
  id: UUID;
  clientId: UUID;
  branchId?: UUID;
  licenseNumber?: string;
  issueDate?: ISODate;
  renewalDate?: ISODate;
  expiryDate?: ISODate;
  documentId?: UUID;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

export type VisitType =
  | 'maintenance'
  | 'installation'
  | 'supply'
  | 'repair'
  | 'inspection';

/** The 9-point maintenance checklist from the source form. */
export interface MaintenanceChecklist {
  cleanCameras: boolean;
  cleanNvr: boolean;
  checkNetworkCables: boolean;
  checkPowerSupply: boolean; // Power / PoE
  testRecordPlayback: boolean;
  setDateTime: boolean;
  updateFirmware: boolean;
  testRemoteView: boolean;
  checkStorageSpace: boolean;
}

export interface CameraCheck {
  deviceId: UUID;
  status: 'ok' | 'needs_service';
  lensCleaned: boolean;
  imageChecked: boolean;
  networkChecked: boolean;
  notes?: string;
}

export interface ReplacedPart {
  id: UUID;
  description: string;
  oldSerial?: string;
  newSerial?: string;
  reason?: string;
}

export interface Visit {
  id: UUID;
  clientId: UUID;
  branchId: UUID;
  type: VisitType;
  visitDate: ISODate;
  nextVisitDate?: ISODate;
  technician?: string;
  /** Link to the staff directory when the technician was picked from it. */
  technicianId?: UUID;
  /** AMC this visit is charged against, if any. */
  amcContractId?: UUID;
  /** False for extra//paid visits that should not consume an AMC allowance. */
  countsAgainstAmc: boolean;
  checklist: MaintenanceChecklist;
  cameraChecks: CameraCheck[];
  replacedParts: ReplacedPart[];
  faultsFound?: string;
  actionsTaken?: string;
  recommendations?: string;
  signatureTechnician?: MediaRef; // drawn signature image
  signatureClient?: MediaRef;
  photosBefore: MediaRef[];
  photosAfter: MediaRef[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ---------------------------------------------------------------------------
// Inventory (shop stock — feeds autocomplete)
// ---------------------------------------------------------------------------

/** Where a physical unit currently is. */
export type StockStatus = 'in_stock' | 'installed' | 'returned' | 'faulty';

/**
 * One PHYSICAL unit in the shop, identified by its serial number.
 *
 * `InventoryItem` counts a product ("40 of this camera"); this identifies a
 * particular camera. Scanning a barcode looks up one of these and fills the
 * device form from it.
 */
export interface StockUnit {
  id: UUID;
  serialNumber: string;
  inventoryItemId?: UUID;
  itemName: string;
  type: DeviceType;
  manufacturer?: string;
  unitPrice?: number;
  status: StockStatus;
  clientId?: UUID;
  branchId?: UUID;
  deviceId?: UUID;
  ageDays?: number;
  notes?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface InventoryItem {
  id: UUID;
  type: DeviceType;
  manufacturer?: string;
  model?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ---------------------------------------------------------------------------
// AMC contracts & finance
// ---------------------------------------------------------------------------

export interface AmcContract {
  id: UUID;
  clientId: UUID;
  branchId?: UUID;
  startDate: ISODate;
  endDate: ISODate;
  /** Agreed number of visits. Ignored when `unlimitedVisits` is true. */
  totalVisits: number;
  /** Derived from linked visits, not typed by hand. */
  usedVisits: number;
  /** "As needed" contracts: no fixed visit count. */
  unlimitedVisits: boolean;
  amount?: number;
  notes?: string;
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid';

export interface Invoice {
  id: UUID;
  clientId: UUID;
  number: string;
  date: ISODate;
  dueDate?: ISODate;
  /** Sum of line items before tax. */
  subtotal: number;
  /** VAT percentage, e.g. 5 for the UAE. */
  taxRate: number;
  taxAmount: number;
  /** subtotal + taxAmount */
  total: number;
  paid: number;
  status: InvoiceStatus;
  /** UAE Tax Registration Number. */
  trn?: string;
  items: InvoiceItem[];
  /** Terms printed on the document when used as a contract. */
  terms?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Reminders / notifications
// ---------------------------------------------------------------------------

export type ReminderKind =
  | 'maintenance_due'
  | 'warranty_expiry'
  | 'license_expiry'
  | 'amc_expiry'
  | 'invoice_overdue'
  | 'custom';

export interface Reminder {
  id: UUID;
  kind: ReminderKind;
  clientId?: UUID;
  branchId?: UUID;
  deviceId?: UUID;
  title: string;
  dueDate: ISODate;
  leadDays: number; // notify N days before
  done: boolean;
  createdAt: ISODate;
}

// ---------------------------------------------------------------------------
// Shop staff (technicians etc.)
// ---------------------------------------------------------------------------

export interface StaffMember {
  id: UUID;
  name: string;
  role?: string; // فني، مساعد، مشرف...
  phone?: string;
  email?: string;
  active: boolean;
  /** One-off helper: kept out of the main suggestion list. */
  isTemporary: boolean;
  notes?: string;
  createdAt: ISODate;
}

/** A dated, free-form note attached to a client / branch / device. */
export interface NoteEntry {
  id: UUID;
  clientId?: UUID;
  branchId?: UUID;
  deviceId?: UUID;
  body: string;
  author?: string;
  pinned: boolean;
  createdAt: ISODate;
}

/** A single billable line on an invoice. */
export interface InvoiceItem {
  id: UUID;
  description: string;
  quantity: number;
  unitPrice: number;
}

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export type Role = 'admin' | 'technician' | 'accountant' | 'viewer';

export interface AppUser {
  id: UUID;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: ISODate;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: UUID;
  at: ISODate;
  userId?: UUID;
  action: string; // create/update/delete/login/export...
  entity: string;
  entityId?: string;
  summary?: string;
}
