// Database schema. Each entry in MIGRATIONS runs once, in order (tracked by PRAGMA user_version).
// Never edit a migration that has shipped — append a new one instead.

export const MIGRATIONS = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    initials TEXT,
    email TEXT,
    title TEXT,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    password_changed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );

  CREATE TABLE clients (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    contact_name TEXT,
    contact_email TEXT,
    phone TEXT,
    address TEXT,
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    lead_id INTEGER REFERENCES users(id),
    po_number TEXT,
    budget REAL,
    start_date TEXT,
    due_date TEXT,
    description TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE methods (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    technique TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Draft',
    client_id INTEGER REFERENCES clients(id),
    owner_id INTEGER REFERENCES users(id),
    scope TEXT,
    procedure TEXT,
    reference TEXT,
    price REAL NOT NULL DEFAULT 0,
    tat_days INTEGER NOT NULL DEFAULT 5,
    effective_date TEXT,
    approved_by INTEGER REFERENCES users(id),
    supersedes_id INTEGER REFERENCES methods(id),
    created_at TEXT NOT NULL,
    UNIQUE (code, version)
  );

  CREATE TABLE method_analytes (
    id INTEGER PRIMARY KEY,
    method_id INTEGER NOT NULL REFERENCES methods(id),
    name TEXT NOT NULL,
    unit TEXT,
    result_type TEXT NOT NULL DEFAULT 'numeric',
    spec_min REAL,
    spec_max REAL,
    spec_text TEXT,
    decimals INTEGER NOT NULL DEFAULT 2,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE qualifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    method_code TEXT NOT NULL,
    qualified_at TEXT NOT NULL,
    trained_by INTEGER REFERENCES users(id),
    expires_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    UNIQUE (user_id, method_code)
  );

  CREATE TABLE instruments (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    manufacturer TEXT,
    model TEXT,
    serial_no TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'Available',
    calibration_interval_days INTEGER,
    last_calibrated TEXT,
    calibration_due TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE instrument_logs (
    id INTEGER PRIMARY KEY,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id),
    kind TEXT NOT NULL,
    performed_at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    description TEXT,
    outcome TEXT,
    next_due TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE inventory (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    supplier TEXT,
    catalog_no TEXT,
    lot_no TEXT,
    potency TEXT,
    quantity REAL,
    unit TEXT,
    min_quantity REAL,
    location TEXT,
    storage TEXT,
    received_date TEXT,
    opened_date TEXT,
    expiry_date TEXT,
    status TEXT NOT NULL DEFAULT 'Active',
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE inventory_txns (
    id INTEGER PRIMARY KEY,
    inventory_id INTEGER NOT NULL REFERENCES inventory(id),
    delta REAL NOT NULL,
    balance REAL,
    reason TEXT,
    user_id INTEGER REFERENCES users(id),
    at TEXT NOT NULL
  );

  CREATE TABLE samples (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    project_id INTEGER REFERENCES projects(id),
    description TEXT NOT NULL,
    sample_type TEXT,
    batch_no TEXT,
    client_ref TEXT,
    quantity TEXT,
    container TEXT,
    storage TEXT,
    location TEXT,
    condition TEXT,
    priority TEXT NOT NULL DEFAULT 'Standard',
    status TEXT NOT NULL DEFAULT 'Received',
    received_at TEXT NOT NULL,
    received_by INTEGER REFERENCES users(id),
    due_date TEXT,
    reported_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE custody_events (
    id INTEGER PRIMARY KEY,
    sample_id INTEGER NOT NULL REFERENCES samples(id),
    action TEXT NOT NULL,
    location TEXT,
    note TEXT,
    user_id INTEGER REFERENCES users(id),
    at TEXT NOT NULL
  );

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    project_id INTEGER REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'Draft',
    issued_date TEXT,
    due_date TEXT,
    paid_date TEXT,
    tax_rate REAL NOT NULL DEFAULT 0,
    po_number TEXT,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE invoice_lines (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE tests (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    sample_id INTEGER NOT NULL REFERENCES samples(id),
    method_id INTEGER NOT NULL REFERENCES methods(id),
    status TEXT NOT NULL DEFAULT 'Pending',
    analyst_id INTEGER REFERENCES users(id),
    instrument_id INTEGER REFERENCES instruments(id),
    due_date TEXT,
    price REAL NOT NULL DEFAULT 0,
    raw_data_ref TEXT,
    comments TEXT,
    oos INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    submitted_at TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_at TEXT,
    invoice_id INTEGER REFERENCES invoices(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE results (
    id INTEGER PRIMARY KEY,
    test_id INTEGER NOT NULL REFERENCES tests(id),
    analyte TEXT NOT NULL,
    unit TEXT,
    result_type TEXT NOT NULL DEFAULT 'numeric',
    spec_min REAL,
    spec_max REAL,
    spec_text TEXT,
    decimals INTEGER NOT NULL DEFAULT 2,
    value_num REAL,
    value_text TEXT,
    outcome TEXT NOT NULL DEFAULT 'Pending',
    entered_by INTEGER REFERENCES users(id),
    entered_at TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE test_materials (
    test_id INTEGER NOT NULL REFERENCES tests(id),
    inventory_id INTEGER NOT NULL REFERENCES inventory(id),
    PRIMARY KEY (test_id, inventory_id)
  );

  CREATE TABLE notebook_entries (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id),
    sample_id INTEGER REFERENCES samples(id),
    method_id INTEGER REFERENCES methods(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL DEFAULT '',
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'Draft',
    signed_at TEXT,
    witness_id INTEGER REFERENCES users(id),
    witnessed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE notebook_addenda (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES notebook_entries(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE investigations (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'Minor',
    status TEXT NOT NULL DEFAULT 'Open',
    test_id INTEGER REFERENCES tests(id),
    sample_id INTEGER REFERENCES samples(id),
    project_id INTEGER REFERENCES projects(id),
    instrument_id INTEGER REFERENCES instruments(id),
    owner_id INTEGER REFERENCES users(id),
    raised_by INTEGER REFERENCES users(id),
    raised_at TEXT NOT NULL,
    due_date TEXT,
    description TEXT,
    root_cause TEXT,
    impact TEXT,
    capa TEXT,
    conclusion TEXT,
    closed_by INTEGER REFERENCES users(id),
    closed_at TEXT
  );

  CREATE TABLE signatures (
    id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    full_name TEXT NOT NULL,
    meaning TEXT NOT NULL,
    comment TEXT,
    signed_at TEXT NOT NULL
  );

  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    sha256 TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0,
    removed_reason TEXT
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    entity_code TEXT,
    summary TEXT,
    changes TEXT,
    reason TEXT,
    ip TEXT,
    prev_hash TEXT,
    hash TEXT NOT NULL
  );

  -- GxP records are append-only: the database itself refuses edits to the audit trail and signatures.
  CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  CREATE TRIGGER signatures_no_update BEFORE UPDATE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures are append-only'); END;
  CREATE TRIGGER signatures_no_delete BEFORE DELETE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures are append-only'); END;

  CREATE INDEX idx_projects_client ON projects(client_id);
  CREATE INDEX idx_samples_status ON samples(status);
  CREATE INDEX idx_samples_client ON samples(client_id);
  CREATE INDEX idx_samples_project ON samples(project_id);
  CREATE INDEX idx_custody_sample ON custody_events(sample_id);
  CREATE INDEX idx_tests_sample ON tests(sample_id);
  CREATE INDEX idx_tests_status ON tests(status);
  CREATE INDEX idx_tests_analyst ON tests(analyst_id);
  CREATE INDEX idx_tests_method ON tests(method_id);
  CREATE INDEX idx_tests_invoice ON tests(invoice_id);
  CREATE INDEX idx_results_test ON results(test_id);
  CREATE INDEX idx_analytes_method ON method_analytes(method_id);
  CREATE INDEX idx_methods_code ON methods(code);
  CREATE INDEX idx_instrument_logs ON instrument_logs(instrument_id);
  CREATE INDEX idx_inventory_txns ON inventory_txns(inventory_id);
  CREATE INDEX idx_notebook_author ON notebook_entries(author_id);
  CREATE INDEX idx_notebook_project ON notebook_entries(project_id);
  CREATE INDEX idx_addenda_entry ON notebook_addenda(entry_id);
  CREATE INDEX idx_investigations_status ON investigations(status);
  CREATE INDEX idx_invoice_lines ON invoice_lines(invoice_id);
  CREATE INDEX idx_signatures_entity ON signatures(entity, entity_id);
  CREATE INDEX idx_attachments_entity ON attachments(entity, entity_id);
  CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
  CREATE INDEX idx_audit_at ON audit_log(at);
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  `,
  // 2: invoice lines remember which tests they bill, so editing a draft can never orphan billed work.
  `
  ALTER TABLE invoice_lines ADD COLUMN test_ids TEXT;
  `,
  // 3: Word/Excel documents inside notebook entries. Every save is a new, immutable version; once the entry
  // is signed the database itself refuses new versions, so what was signed is what stays on file.
  `
  CREATE TABLE notebook_documents (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES notebook_entries(id),
    kind TEXT NOT NULL CHECK (kind IN ('docx', 'xlsx')),
    filename TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0,
    removed_reason TEXT
  );

  CREATE TABLE notebook_document_versions (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES notebook_documents(id),
    version INTEGER NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    source TEXT NOT NULL,
    saved_by INTEGER NOT NULL REFERENCES users(id),
    saved_at TEXT NOT NULL,
    UNIQUE (document_id, version)
  );

  -- One-time links that let desktop Word/Excel open and save a document (WebDAV); only the SHA-256 is stored.
  CREATE TABLE document_edit_links (
    token TEXT PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES notebook_documents(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TRIGGER nb_doc_versions_no_update BEFORE UPDATE ON notebook_document_versions BEGIN SELECT RAISE(ABORT, 'document versions are append-only'); END;
  CREATE TRIGGER nb_doc_versions_no_delete BEFORE DELETE ON notebook_document_versions BEGIN SELECT RAISE(ABORT, 'document versions are append-only'); END;
  CREATE TRIGGER nb_doc_versions_locked BEFORE INSERT ON notebook_document_versions
    WHEN (SELECT n.status FROM notebook_documents d JOIN notebook_entries n ON n.id = d.entry_id WHERE d.id = NEW.document_id) IS NOT 'Draft'
    BEGIN SELECT RAISE(ABORT, 'signed notebook entries are append-only'); END;
  CREATE TRIGGER nb_docs_locked_insert BEFORE INSERT ON notebook_documents
    WHEN (SELECT status FROM notebook_entries WHERE id = NEW.entry_id) IS NOT 'Draft'
    BEGIN SELECT RAISE(ABORT, 'signed notebook entries are append-only'); END;
  CREATE TRIGGER nb_docs_locked_update BEFORE UPDATE ON notebook_documents
    WHEN (SELECT status FROM notebook_entries WHERE id = OLD.entry_id) IS NOT 'Draft'
    BEGIN SELECT RAISE(ABORT, 'signed notebook entries are append-only'); END;
  CREATE TRIGGER nb_docs_no_delete BEFORE DELETE ON notebook_documents BEGIN SELECT RAISE(ABORT, 'notebook documents are append-only'); END;

  CREATE INDEX idx_nb_docs_entry ON notebook_documents(entry_id);
  CREATE INDEX idx_nb_doc_versions ON notebook_document_versions(document_id, version);
  CREATE INDEX idx_doc_links_expiry ON document_edit_links(expires_at);
  `,
  // 4: Client portal — client contacts sign in (separately from staff) to message the lab, submit samples
  // and request method development / validation. Every row carries client_id; the portal API scopes by it.
  `
  CREATE TABLE portal_users (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    job_title TEXT,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    password_changed_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE portal_sessions (
    token TEXT PRIMARY KEY,
    portal_user_id INTEGER NOT NULL REFERENCES portal_users(id),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );

  CREATE TABLE portal_submissions (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    portal_user_id INTEGER REFERENCES portal_users(id),
    project_id INTEGER REFERENCES projects(id),
    sample_type TEXT,
    priority TEXT NOT NULL DEFAULT 'Standard',
    storage TEXT,
    courier TEXT,
    tracking_no TEXT,
    ship_date TEXT,
    notes TEXT,
    samples TEXT NOT NULL,
    method_ids TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Submitted',
    status_note TEXT,
    acknowledged_by INTEGER REFERENCES users(id),
    acknowledged_at TEXT,
    received_by INTEGER REFERENCES users(id),
    received_at TEXT,
    sample_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE portal_requests (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    portal_user_id INTEGER REFERENCES portal_users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    product TEXT,
    technique TEXT,
    parameters TEXT,
    scope TEXT,
    regulatory TEXT,
    target_date TEXT,
    status TEXT NOT NULL DEFAULT 'Submitted',
    response TEXT,
    responded_by INTEGER REFERENCES users(id),
    responded_at TEXT,
    project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE portal_threads (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    subject TEXT NOT NULL,
    submission_id INTEGER REFERENCES portal_submissions(id),
    request_id INTEGER REFERENCES portal_requests(id),
    sample_id INTEGER REFERENCES samples(id),
    status TEXT NOT NULL DEFAULT 'Open',
    created_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    client_read_at TEXT,
    lab_read_at TEXT
  );

  -- Exactly one of portal_user_id (client) / user_id (lab staff) is set, or neither for system notices.
  CREATE TABLE portal_messages (
    id INTEGER PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES portal_threads(id),
    portal_user_id INTEGER REFERENCES portal_users(id),
    user_id INTEGER REFERENCES users(id),
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'message',
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER portal_messages_no_update BEFORE UPDATE ON portal_messages BEGIN SELECT RAISE(ABORT, 'portal messages are append-only'); END;
  CREATE TRIGGER portal_messages_no_delete BEFORE DELETE ON portal_messages BEGIN SELECT RAISE(ABORT, 'portal messages are append-only'); END;

  CREATE INDEX idx_portal_users_client ON portal_users(client_id);
  CREATE INDEX idx_portal_sessions_user ON portal_sessions(portal_user_id);
  CREATE INDEX idx_portal_submissions_client ON portal_submissions(client_id, status);
  CREATE INDEX idx_portal_requests_client ON portal_requests(client_id, status);
  CREATE INDEX idx_portal_threads_client ON portal_threads(client_id, last_message_at);
  CREATE INDEX idx_portal_messages_thread ON portal_messages(thread_id);
  `,
];
