// ============================================================================
// AlAqsa — Database schema as ordered, idempotent migrations.
//
// Each migration bumps user_version. On app start we apply any migrations whose
// index is beyond the current user_version, INSIDE a transaction. This is how
// an installed-over update keeps existing data and only adds new structure.
// ============================================================================

export interface Migration {
  version: number;
  up: string; // SQL executed in a transaction
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: /* sql */ `
      CREATE TABLE status_labels (
        id TEXT PRIMARY KEY,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        color TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0,
        sort INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        name_en TEXT,
        status_label_id TEXT,
        rating INTEGER NOT NULL DEFAULT 0,
        is_flagged INTEGER NOT NULL DEFAULT 0,
        flag_reason TEXT,
        notes TEXT,
        deal_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_clients_name_ar ON clients(name_ar);
      CREATE INDEX idx_clients_name_en ON clients(name_en);
      CREATE INDEX idx_clients_type ON clients(type);
      CREATE INDEX idx_clients_flagged ON clients(is_flagged);

      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT,
        phones TEXT NOT NULL DEFAULT '[]',
        emails TEXT NOT NULL DEFAULT '[]',
        is_primary INTEGER NOT NULL DEFAULT 0,
        sort INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_contacts_client ON contacts(client_id);

      CREATE TABLE branches (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        name_en TEXT,
        address TEXT,
        lat REAL,
        lng REAL,
        map_url TEXT,
        status_label_id TEXT,
        manager_contact TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_branches_client ON branches(client_id);

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT,
        position_in_branch TEXT,
        manufacturer TEXT,
        model TEXT,
        serial_number TEXT,
        channels INTEGER,
        capacity TEXT,
        firmware TEXT,
        source TEXT NOT NULL DEFAULT 'ours',
        install_date TEXT,
        warranty_expiry TEXT,
        health TEXT,
        inventory_item_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_devices_branch ON devices(branch_id);
      CREATE INDEX idx_devices_serial ON devices(serial_number);
      CREATE INDEX idx_devices_type ON devices(type);
      CREATE INDEX idx_devices_warranty ON devices(warranty_expiry);

      CREATE TABLE media (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE device_photos (
        device_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        PRIMARY KEY (device_id, media_id),
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
      );

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        branch_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        media_id TEXT NOT NULL,
        issue_date TEXT,
        expiry_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_documents_client ON documents(client_id);
      CREATE INDEX idx_documents_expiry ON documents(expiry_date);

      CREATE TABLE camera_licenses (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        branch_id TEXT,
        license_number TEXT,
        issue_date TEXT,
        renewal_date TEXT,
        expiry_date TEXT,
        document_id TEXT,
        notes TEXT,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_camlic_client ON camera_licenses(client_id);
      CREATE INDEX idx_camlic_expiry ON camera_licenses(expiry_date);

      CREATE TABLE visits (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        type TEXT NOT NULL,
        visit_date TEXT NOT NULL,
        next_visit_date TEXT,
        technician TEXT,
        checklist TEXT NOT NULL DEFAULT '{}',
        camera_checks TEXT NOT NULL DEFAULT '[]',
        replaced_parts TEXT NOT NULL DEFAULT '[]',
        faults_found TEXT,
        actions_taken TEXT,
        recommendations TEXT,
        signature_tech_media_id TEXT,
        signature_client_media_id TEXT,
        photos_before TEXT NOT NULL DEFAULT '[]',
        photos_after TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_visits_client ON visits(client_id);
      CREATE INDEX idx_visits_branch ON visits(branch_id);
      CREATE INDEX idx_visits_date ON visits(visit_date);
      CREATE INDEX idx_visits_next ON visits(next_visit_date);

      CREATE TABLE inventory (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        manufacturer TEXT,
        model TEXT,
        description TEXT,
        quantity INTEGER,
        unit_price REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_inventory_model ON inventory(model);

      CREATE TABLE amc_contracts (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        branch_id TEXT,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        total_visits INTEGER NOT NULL DEFAULT 0,
        used_visits INTEGER NOT NULL DEFAULT 0,
        amount REAL,
        notes TEXT,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_amc_client ON amc_contracts(client_id);

      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        number TEXT NOT NULL,
        date TEXT NOT NULL,
        due_date TEXT,
        total REAL NOT NULL DEFAULT 0,
        paid REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unpaid',
        notes TEXT,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_invoices_client ON invoices(client_id);
      CREATE INDEX idx_invoices_status ON invoices(status);

      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        client_id TEXT,
        branch_id TEXT,
        device_id TEXT,
        title TEXT NOT NULL,
        due_date TEXT NOT NULL,
        lead_days INTEGER NOT NULL DEFAULT 30,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_reminders_due ON reminders(due_date);
      CREATE INDEX idx_reminders_done ON reminders(done);

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        pass_hash TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        user_id TEXT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        summary TEXT
      );
      CREATE INDEX idx_audit_at ON audit_log(at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
];

// ---------------------------------------------------------------------------
// v2 — staff directory, free-form notes timeline, invoice tax/contract fields,
// and flexible AMC visit counting. Added as a migration so an installed copy
// upgrades in place without losing anything.
// ---------------------------------------------------------------------------
MIGRATIONS.push({
  version: 2,
  up: /* sql */ `
    CREATE TABLE staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      phone TEXT,
      email TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      is_temporary INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_staff_name ON staff(name);

    -- Free-form, dated notes attached to a client / branch / device.
    CREATE TABLE note_entries (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      branch_id TEXT,
      device_id TEXT,
      body TEXT NOT NULL,
      author TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_notes_client ON note_entries(client_id);
    CREATE INDEX idx_notes_branch ON note_entries(branch_id);
    CREATE INDEX idx_notes_created ON note_entries(created_at);

    -- Invoice: VAT/TRN + line items + signature block for printing as a contract.
    ALTER TABLE invoices ADD COLUMN trn TEXT;
    ALTER TABLE invoices ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0;
    ALTER TABLE invoices ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0;
    ALTER TABLE invoices ADD COLUMN subtotal REAL NOT NULL DEFAULT 0;
    ALTER TABLE invoices ADD COLUMN items TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE invoices ADD COLUMN terms TEXT;

    -- AMC: allow open-ended contracts (visits "as needed") and link visits to
    -- the contract they consumed, so counting is derived rather than typed.
    ALTER TABLE amc_contracts ADD COLUMN unlimited_visits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE visits ADD COLUMN amc_contract_id TEXT;
    ALTER TABLE visits ADD COLUMN counts_against_amc INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX idx_visits_amc ON visits(amc_contract_id);

    -- Technician recorded on a visit can now reference the staff directory.
    ALTER TABLE visits ADD COLUMN technician_id TEXT;
  `,
});

// ---------------------------------------------------------------------------
// v3 — individual stock units, identified by serial number.
//
// `inventory` holds one row per PRODUCT ("Camera Bullet 2MP IP UNV", 40 in
// stock). This table holds one row per PHYSICAL UNIT, each with its own serial.
// The shop's serial stock-take is one row per unit, and a scanner reads one
// unit, so the two cannot share a table.
//
// When a unit is installed at a client it is linked to the resulting device
// row and marked 'installed', which is what keeps the shop's stock honest
// without anyone having to decrement a counter by hand.
// ---------------------------------------------------------------------------
MIGRATIONS.push({
  version: 3,
  up: /* sql */ `
    CREATE TABLE stock_units (
      id TEXT PRIMARY KEY,
      serial_number TEXT NOT NULL,
      -- Lowercased serial. Scanners and hand-typing vary in case, so lookups
      -- go through this column; the original is preserved for display.
      serial_key TEXT NOT NULL,
      inventory_item_id TEXT,
      item_name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other',
      manufacturer TEXT,
      unit_price REAL,
      -- in_stock | installed | returned | faulty
      status TEXT NOT NULL DEFAULT 'in_stock',
      client_id TEXT,
      branch_id TEXT,
      device_id TEXT,
      -- Days the unit has been held in the shop, as reported by the stock take.
      age_days INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_stock_serial_key ON stock_units(serial_key);
    CREATE INDEX idx_stock_status ON stock_units(status);
    CREATE INDEX idx_stock_item ON stock_units(inventory_item_id);
    CREATE INDEX idx_stock_client ON stock_units(client_id);

    -- Which stock unit a device came from, so an installed camera can be
    -- traced back to the exact unit that left the shop.
    ALTER TABLE devices ADD COLUMN stock_unit_id TEXT;
  `,
});

// ---------------------------------------------------------------------------
// v4 — a record of every file exported for a client.
//
// Reports were written to the reports folder and then forgotten: nothing in
// the app could tell the owner what had been produced for a client, or where
// it went. This table is that history, so each client has one place showing
// their exported files with a path to reopen, share or print.
// ---------------------------------------------------------------------------
MIGRATIONS.push({
  version: 4,
  up: /* sql */ `
    CREATE TABLE exports (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      -- visit_pdf | agreement_pdf | invoice_pdf | client_excel | full_excel
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER,
      -- The visit/invoice the file was produced from, when there is one.
      ref_id TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_exports_client ON exports(client_id);
    CREATE INDEX idx_exports_created ON exports(created_at);
  `,
});

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
