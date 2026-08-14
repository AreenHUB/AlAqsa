// ============================================================================
// AlAqsa — IPC channel contract (single source of truth for main <-> renderer)
// ============================================================================

import type {
  Client, Contact, Branch, Device, DocumentRecord, CameraLicense,
  Visit, InventoryItem, AmcContract, Invoice, Reminder, AppUser,
  AuditEntry, StatusLabel, MediaRef, StaffMember, NoteEntry, Role,
} from './types';

export interface StaffActivity {
  staffId?: string;
  name: string;
  total: number;
  maintenance: number;
  installation: number;
  repair: number;
  lastVisit?: string;
}

/** Result wrapper used by every IPC handler. */
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; code?: string };
export type Result<T> = Ok<T> | Err;

// ---- Auth / security ------------------------------------------------------
export interface AuthStatus {
  initialized: boolean; // has a master password been set?
  unlocked: boolean;
  licenseState: LicenseState;
  language: 'ar' | 'en';
}

export type LicenseState =
  | { status: 'valid'; expiresAt?: string; perpetual: boolean }
  | { status: 'expired'; expiredAt: string }
  | { status: 'revoked' }
  | { status: 'missing' };

export interface FirstRunSetupResult {
  recoveryKey: string; // shown ONCE
}

// ---- Query params ---------------------------------------------------------
export interface ClientQuery {
  search?: string;
  type?: string;
  statusLabelId?: string;
  flaggedOnly?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface GlobalSearchResult {
  clients: Client[];
  branches: Branch[];
  devices: Device[];
  contacts: Contact[];
}

export interface DashboardStats {
  clients: number;
  branches: number;
  devices: number;
  camerasTotal: number;
  visitsThisMonth: number;
  upcomingReminders: number;
  expiringLicenses: number;
  expiringWarranties: number;
  flaggedClients: number;
}

/**
 * The full IPC surface. Channel name = `${group}:${method}`.
 * Renderer calls window.alaqsa.<group>.<method>(...args).
 */
export interface IpcApi {
  auth: {
    status(): Promise<Result<AuthStatus>>;
    firstRunSetup(masterPassword: string, language: 'ar' | 'en'): Promise<Result<FirstRunSetupResult>>;
    unlock(password: string): Promise<Result<AuthStatus>>;
    unlockWithRecovery(recoveryKey: string): Promise<Result<AuthStatus>>;
    changePassword(oldPw: string, newPw: string): Promise<Result<null>>;
    regenerateRecoveryKey(password: string): Promise<Result<{ recoveryKey: string }>>;
    lock(): Promise<Result<null>>;
  };
  license: {
    state(): Promise<Result<LicenseState>>;
    activate(licenseString: string): Promise<Result<LicenseState>>;
  };
  clients: {
    list(q: ClientQuery): Promise<Result<{ rows: Client[]; total: number }>>;
    get(id: string): Promise<Result<Client>>;
    create(input: Partial<Client>): Promise<Result<Client>>;
    update(id: string, patch: Partial<Client>): Promise<Result<Client>>;
    remove(id: string): Promise<Result<null>>;
    contacts(clientId: string): Promise<Result<Contact[]>>;
    saveContacts(clientId: string, contacts: Contact[]): Promise<Result<Contact[]>>;
  };
  branches: {
    listByClient(clientId: string): Promise<Result<Branch[]>>;
    create(input: Partial<Branch>): Promise<Result<Branch>>;
    update(id: string, patch: Partial<Branch>): Promise<Result<Branch>>;
    remove(id: string): Promise<Result<null>>;
  };
  devices: {
    listByBranch(branchId: string): Promise<Result<Device[]>>;
    listByClient(clientId: string): Promise<Result<Device[]>>;
    create(input: Partial<Device>): Promise<Result<Device>>;
    update(id: string, patch: Partial<Device>): Promise<Result<Device>>;
    remove(id: string): Promise<Result<null>>;
    findBySerial(serial: string): Promise<Result<Device | null>>;
    qrDataUrl(id: string): Promise<Result<string>>;
  };
  documents: {
    listByClient(clientId: string): Promise<Result<DocumentRecord[]>>;
    listByBranch(branchId: string): Promise<Result<DocumentRecord[]>>;
    add(clientId: string | null, branchId: string | null, kind: string, title: string, sourcePath: string): Promise<Result<DocumentRecord>>;
    remove(id: string): Promise<Result<null>>;
    open(id: string): Promise<Result<null>>;
  };
  licenses: {
    listByClient(clientId: string): Promise<Result<CameraLicense[]>>;
    save(input: Partial<CameraLicense>): Promise<Result<CameraLicense>>;
    remove(id: string): Promise<Result<null>>;
  };
  visits: {
    listByClient(clientId: string): Promise<Result<Visit[]>>;
    listByBranch(branchId: string): Promise<Result<Visit[]>>;
    get(id: string): Promise<Result<Visit>>;
    create(input: Partial<Visit>): Promise<Result<Visit>>;
    update(id: string, patch: Partial<Visit>): Promise<Result<Visit>>;
    remove(id: string): Promise<Result<null>>;
  };
  inventory: {
    list(search?: string): Promise<Result<InventoryItem[]>>;
    upsert(input: Partial<InventoryItem>): Promise<Result<InventoryItem>>;
    remove(id: string): Promise<Result<null>>;
    importExcel(sourcePath: string): Promise<Result<{ imported: number }>>;
  };
  amc: {
    listByClient(clientId: string): Promise<Result<AmcContract[]>>;
    save(input: Partial<AmcContract>): Promise<Result<AmcContract>>;
    remove(id: string): Promise<Result<null>>;
  };
  invoices: {
    listByClient(clientId: string): Promise<Result<Invoice[]>>;
    save(input: Partial<Invoice>): Promise<Result<Invoice>>;
    remove(id: string): Promise<Result<null>>;
  };
  reminders: {
    upcoming(days: number): Promise<Result<Reminder[]>>;
    all(): Promise<Result<Reminder[]>>;
    save(input: Partial<Reminder>): Promise<Result<Reminder>>;
    markDone(id: string): Promise<Result<null>>;
    remove(id: string): Promise<Result<null>>;
  };
  statusLabels: {
    list(): Promise<Result<StatusLabel[]>>;
    save(input: Partial<StatusLabel>): Promise<Result<StatusLabel>>;
    remove(id: string): Promise<Result<null>>;
  };
  staff: {
    list(includeInactive?: boolean): Promise<Result<StaffMember[]>>;
    save(input: Partial<StaffMember>): Promise<Result<StaffMember>>;
    remove(id: string): Promise<Result<null>>;
    activity(fromDate?: string, toDate?: string): Promise<Result<StaffActivity[]>>;
  };
  notes: {
    listByClient(clientId: string): Promise<Result<NoteEntry[]>>;
    listByBranch(branchId: string): Promise<Result<NoteEntry[]>>;
    save(input: Partial<NoteEntry>): Promise<Result<NoteEntry>>;
    remove(id: string): Promise<Result<null>>;
  };
  share: {
    /** Opens WhatsApp with a ready message (location, note, or free text). */
    whatsAppText(phone: string, message: string): Promise<Result<null>>;
    /** Builds a maps link for a branch and shares it. */
    branchLocation(branchId: string, phone: string): Promise<Result<null>>;
  };
  reports: {
    visitPdf(visitId: string): Promise<Result<{ path: string }>>;
    agreementPdf(clientId: string): Promise<Result<{ path: string }>>;
    invoicePdf(invoiceId: string): Promise<Result<{ path: string }>>;
    exportClientExcel(clientId: string): Promise<Result<{ path: string }>>;
    exportAllExcel(): Promise<Result<{ path: string }>>;
    shareWhatsApp(pdfPath: string, phone: string, message: string): Promise<Result<null>>;
    print(pdfPath: string): Promise<Result<null>>;
  };
  search: {
    global(term: string): Promise<Result<GlobalSearchResult>>;
  };
  dashboard: {
    stats(): Promise<Result<DashboardStats>>;
  };
  users: {
    list(): Promise<Result<AppUser[]>>;
    save(input: Partial<AppUser>, password?: string): Promise<Result<AppUser>>;
    remove(id: string): Promise<Result<null>>;
  };
  audit: {
    recent(limit: number): Promise<Result<AuditEntry[]>>;
  };
  backup: {
    now(): Promise<Result<{ path: string }>>;
    exportEncrypted(): Promise<Result<{ path: string }>>;
    restore(sourcePath: string): Promise<Result<null>>;
    /** Wipes ALL data back to empty. Requires the master password. */
    factoryReset(password: string): Promise<Result<null>>;
  };
  files: {
    pickOpen(filters?: { name: string; extensions: string[] }[]): Promise<Result<string | null>>;
    pickSave(defaultName: string): Promise<Result<string | null>>;
    saveDataUrl(dataUrl: string, suggestedName: string): Promise<Result<MediaRef>>;
    importDocument(sourcePath: string): Promise<Result<MediaRef>>;
  };
  settings: {
    get(key: string): Promise<Result<string | null>>;
    set(key: string, value: string): Promise<Result<null>>;
    setLanguage(lang: 'ar' | 'en'): Promise<Result<null>>;
    setTheme(theme: 'light' | 'dark'): Promise<Result<null>>;
  };
  network: {
    getMode(): Promise<Result<{ mode: 'standalone' | 'host' | 'client'; hostAddress?: string }>>;
    setHost(): Promise<Result<null>>;
    discover(): Promise<Result<{ name: string; address: string; port: number }[]>>;
    connect(address: string, port: number): Promise<Result<null>>;
    disconnect(): Promise<Result<null>>;
  };
  app: {
    about(): Promise<Result<AboutInfo>>;
    /** Populates demo data. Refused once real records exist. */
    seedDemoData(): Promise<Result<{ clients: number }>>;
    /** Whether the database is still empty, plus the current role. */
    state(): Promise<Result<{ isEmpty: boolean; role: Role }>>;
    /** Adjust the window zoom (owned by the main process). */
    zoom(direction: 'in' | 'out' | 'reset'): Promise<Result<null>>;
  };
}

export interface AboutInfo {
  name: string;
  version: string;
  author: string;
  email: string;
  phone: string;
  github: string;
  year: number;
}

/** Flat channel names, generated for registration + preload. */
export type IpcChannel = string;
