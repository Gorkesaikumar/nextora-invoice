/*
 * SQLite port of server/migrations/001_invoicing.sql for the desktop app.
 *
 * Porting rules (kept in lockstep with the PostgreSQL file - if a column or
 * constraint changes there, it changes here in the same commit):
 *   uuid/date/timestamptz/text/jsonb -> TEXT, bytea -> BLOB, int/bigint ->
 *   INTEGER, boolean -> INTEGER with CHECK (col IN (0,1));
 *   DEFAULT now() -> (datetime('now'));  schema inv -> inv_ table prefix;
 *   btrim() -> trim(); octet_length() -> length(); jsonb_typeof() -> json_type();
 *   ~ 'regex' -> REGEXP 'regex' (regexp() is registered by server/db.js before
 *   any migration runs); PL/pgSQL triggers -> native SQLite triggers with
 *   RAISE(ABORT). The dialect translator treats this file as an identity
 *   (tests/sqlite-dialect.test.js enforces that).
 */

/* -------------------------------------------------------------------- access */

CREATE TABLE inv_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','FINANCE','ACCOUNTANT')),
  display_name TEXT NOT NULL DEFAULT '',
  disabled BOOLEAN NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  must_change_password BOOLEAN NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inv_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES inv_users(id),
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sessions_user_idx ON inv_sessions(user_id);

CREATE TABLE inv_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON inv_rate_limits(expires_at);

/* -------------------------------------------------------------------- issuer */

CREATE TABLE inv_business_settings (
  id BOOLEAN PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'Nextora Creations',
  legal_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  bank_account_name TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  bank_ifsc TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_branch TEXT NOT NULL DEFAULT '',
  upi_id TEXT NOT NULL DEFAULT '',
  signatory_name TEXT NOT NULL DEFAULT '',
  signatory_title TEXT NOT NULL DEFAULT '',
  default_quotation_validity_days INTEGER NOT NULL DEFAULT 30 CHECK (default_quotation_validity_days BETWEEN 1 AND 365),
  default_payment_terms_days INTEGER NOT NULL DEFAULT 15 CHECK (default_payment_terms_days BETWEEN 0 AND 365),
  default_currency TEXT NOT NULL DEFAULT 'INR' CHECK (default_currency = 'INR'),
  rounding_mode TEXT NOT NULL DEFAULT 'NEAREST_RUPEE' CHECK (rounding_mode IN ('NEAREST_RUPEE','NONE')),
  default_tax_rate_bp INTEGER NOT NULL DEFAULT 1800 CHECK (default_tax_rate_bp BETWEEN 0 AND 10000),
  reverse_charge BOOLEAN NOT NULL DEFAULT 0 CHECK (reverse_charge IN (0,1)),
  quotation_prefix TEXT NOT NULL DEFAULT 'NC/QTN' CHECK (length(quotation_prefix) BETWEEN 1 AND 12),
  invoice_prefix TEXT NOT NULL DEFAULT 'NC/INV' CHECK (length(invoice_prefix) BETWEEN 1 AND 12),
  receipt_prefix TEXT NOT NULL DEFAULT 'NC/RCP' CHECK (length(receipt_prefix) BETWEEN 1 AND 12),
  credit_note_prefix TEXT NOT NULL DEFAULT 'NC/CRN' CHECK (length(credit_note_prefix) BETWEEN 1 AND 12),
  terms TEXT NOT NULL DEFAULT '',
  quotation_terms TEXT NOT NULL DEFAULT '',
  pdf_accent_color TEXT NOT NULL DEFAULT '#00AEEF' CHECK (pdf_accent_color REGEXP '^#[0-9A-Fa-f]{6}$'),
  show_bank_details BOOLEAN NOT NULL DEFAULT 1 CHECK (show_bank_details IN (0,1)),
  show_signatory BOOLEAN NOT NULL DEFAULT 1 CHECK (show_signatory IN (0,1)),
  show_amount_in_words BOOLEAN NOT NULL DEFAULT 1 CHECK (show_amount_in_words IN (0,1)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES inv_users(id),
  CHECK (length(gstin) = 0 OR length(state_code) = 2),
  CHECK (length(gstin) = 0 OR gstin REGEXP '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$')
);
INSERT INTO inv_business_settings(id) VALUES (1);

CREATE TABLE inv_company_assets (
  name TEXT PRIMARY KEY CHECK (name IN ('company_logo')),
  png BLOB NOT NULL CHECK (length(png) BETWEEN 24 AND 512000),
  sha256 TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES inv_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

/* ----------------------------------------------------------------- customers */

CREATE TABLE inv_clients (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('BUSINESS','INDIVIDUAL')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  company_name TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  service_address TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'India',
  notes TEXT NOT NULL DEFAULT '',
  payment_terms_days INTEGER NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
  gst_registered BOOLEAN NOT NULL DEFAULT 0 CHECK (gst_registered IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  CHECK (NOT gst_registered OR length(gstin) = 15),
  CHECK (length(gstin) = 0 OR length(state_code) = 2)
);
CREATE INDEX clients_name_idx ON inv_clients (lower(name));
CREATE INDEX clients_company_idx ON inv_clients (lower(company_name));
CREATE INDEX clients_status_idx ON inv_clients (status);
CREATE INDEX clients_gstin_idx ON inv_clients (gstin) WHERE gstin <> '';

/* ------------------------------------------------------------------- catalog */

CREATE TABLE inv_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sku TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'NOS',
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  tax_rate_bp INTEGER NOT NULL DEFAULT 1800 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  hsn_sac TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  billing_interval TEXT NOT NULL DEFAULT 'NONE' CHECK (billing_interval IN ('NONE','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY')),
  license_duration_months INTEGER NOT NULL DEFAULT 0 CHECK (license_duration_months BETWEEN 0 AND 600),
  validity_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  CHECK (tax_treatment = 'TAXABLE' OR tax_rate_bp = 0)
);
CREATE UNIQUE INDEX products_sku_idx ON inv_products (lower(sku)) WHERE sku <> '';
CREATE INDEX products_status_idx ON inv_products (status, category);

/* ----------------------------------------------------------------- numbering */

CREATE TABLE inv_document_sequences (
  doc_type TEXT NOT NULL CHECK (doc_type IN ('QUOTATION','INVOICE','PAYMENT_RECEIPT','CREDIT_NOTE','DEBIT_NOTE')),
  financial_year TEXT NOT NULL CHECK (financial_year REGEXP '^[0-9]{4}-[0-9]{2}$'),
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_type, financial_year)
);

/* ---------------------------------------------------------------- quotations */

CREATE TABLE inv_quotations (
  id TEXT PRIMARY KEY,
  quotation_number TEXT UNIQUE,
  financial_year TEXT,
  client_id TEXT NOT NULL REFERENCES inv_clients(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  scope_of_work TEXT NOT NULL DEFAULT '',
  inclusions TEXT NOT NULL DEFAULT '',
  exclusions TEXT NOT NULL DEFAULT '',
  assumptions TEXT NOT NULL DEFAULT '',
  warranty_terms TEXT NOT NULL DEFAULT '',
  delivery_timeline TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  issue_date DATE NOT NULL,
  expiry_date DATE,
  place_of_supply_state_code TEXT NOT NULL DEFAULT '',
  supply_type TEXT NOT NULL DEFAULT 'INTRA' CHECK (supply_type IN ('INTRA','INTER')),
  payment_terms_days INTEGER NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
  payment_terms TEXT NOT NULL DEFAULT '',
  project_reference TEXT NOT NULL DEFAULT '',
  invoice_discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount_bp BETWEEN 0 AND 10000),
  invoice_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount_minor >= 0),
  round_off_enabled BOOLEAN NOT NULL DEFAULT 1 CHECK (round_off_enabled IN (0,1)),
  additional_charges JSONB NOT NULL DEFAULT '[]' CHECK (json_valid(additional_charges)),
  totals JSONB NOT NULL DEFAULT '{}' CHECK (json_valid(totals)),
  snapshot JSONB CHECK (snapshot IS NULL OR json_valid(snapshot)),
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  converted_invoice_id TEXT REFERENCES inv_invoices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  CHECK (expiry_date IS NULL OR expiry_date >= issue_date),
  CHECK (quotation_number IS NOT NULL OR status = 'DRAFT'),
  CHECK (status <> 'ACCEPTED' OR accepted_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(cancellation_reason) > 0))
);
CREATE UNIQUE INDEX quotations_number_idx ON inv_quotations (quotation_number) WHERE quotation_number IS NOT NULL;
CREATE INDEX quotations_client_idx ON inv_quotations (client_id, issue_date DESC);
CREATE INDEX quotations_status_idx ON inv_quotations (status, issue_date DESC);
CREATE INDEX quotations_search_idx ON inv_quotations (lower(title));

CREATE TABLE inv_quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES inv_quotations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  product_id TEXT REFERENCES inv_products(id),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  hsn_sac TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'NOS',
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 1800 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  gross_minor INTEGER NOT NULL DEFAULT 0,
  item_discount_minor INTEGER NOT NULL DEFAULT 0,
  invoice_discount_minor INTEGER NOT NULL DEFAULT 0,
  taxable_minor INTEGER NOT NULL DEFAULT 0,
  cgst_minor INTEGER NOT NULL DEFAULT 0,
  sgst_minor INTEGER NOT NULL DEFAULT 0,
  igst_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  UNIQUE (quotation_id, position)
);

CREATE TABLE inv_quotation_milestones (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES inv_quotations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  share_bp INTEGER NOT NULL DEFAULT 0 CHECK (share_bp BETWEEN 0 AND 10000),
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  due_offset_days INTEGER NOT NULL DEFAULT 0 CHECK (due_offset_days BETWEEN 0 AND 3650),
  UNIQUE (quotation_id, position)
);

/* ------------------------------------------------------------------ invoices */

CREATE TABLE inv_invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE,
  financial_year TEXT,
  client_id TEXT NOT NULL REFERENCES inv_clients(id),
  quotation_id TEXT REFERENCES inv_quotations(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','CANCELLED','VOID')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  scope_of_work TEXT NOT NULL DEFAULT '',
  inclusions TEXT NOT NULL DEFAULT '',
  exclusions TEXT NOT NULL DEFAULT '',
  assumptions TEXT NOT NULL DEFAULT '',
  warranty_terms TEXT NOT NULL DEFAULT '',
  delivery_timeline TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  issue_date DATE NOT NULL,
  due_date DATE,
  place_of_supply_state_code TEXT NOT NULL DEFAULT '',
  supply_type TEXT NOT NULL DEFAULT 'INTRA' CHECK (supply_type IN ('INTRA','INTER')),
  payment_terms_days INTEGER NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
  payment_terms TEXT NOT NULL DEFAULT '',
  po_reference TEXT NOT NULL DEFAULT '',
  project_reference TEXT NOT NULL DEFAULT '',
  invoice_discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount_bp BETWEEN 0 AND 10000),
  invoice_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (invoice_discount_minor >= 0),
  round_off_enabled BOOLEAN NOT NULL DEFAULT 1 CHECK (round_off_enabled IN (0,1)),
  additional_charges JSONB NOT NULL DEFAULT '[]' CHECK (json_valid(additional_charges)),
  totals JSONB NOT NULL DEFAULT '{}' CHECK (json_valid(totals)),
  snapshot JSONB CHECK (snapshot IS NULL OR json_valid(snapshot)),
  issued_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  CHECK (due_date IS NULL OR due_date >= issue_date),
  CHECK (invoice_number IS NOT NULL OR status = 'DRAFT'),
  CHECK (status <> 'ISSUED' OR (issued_at IS NOT NULL AND invoice_number IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(cancellation_reason) > 0))
);
CREATE UNIQUE INDEX invoices_number_idx ON inv_invoices (invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX invoices_client_idx ON inv_invoices (client_id, issue_date DESC);
CREATE INDEX invoices_status_idx ON inv_invoices (status, due_date);
CREATE INDEX invoices_issue_idx ON inv_invoices (issue_date);
CREATE INDEX invoices_quotation_idx ON inv_invoices (quotation_id) WHERE quotation_id IS NOT NULL;

CREATE TABLE inv_invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES inv_invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  product_id TEXT REFERENCES inv_products(id),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  hsn_sac TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'NOS',
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 1800 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  gross_minor INTEGER NOT NULL DEFAULT 0,
  item_discount_minor INTEGER NOT NULL DEFAULT 0,
  invoice_discount_minor INTEGER NOT NULL DEFAULT 0,
  taxable_minor INTEGER NOT NULL DEFAULT 0,
  cgst_minor INTEGER NOT NULL DEFAULT 0,
  sgst_minor INTEGER NOT NULL DEFAULT 0,
  igst_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, position)
);

/* ------------------------------------------------------------------ payments */

CREATE TABLE inv_payments (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  financial_year TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES inv_invoices(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  paid_on DATE NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','UPI','CARD','CHEQUE','OTHER')),
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  snapshot JSONB CHECK (snapshot IS NULL OR json_valid(snapshot)),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT NOT NULL REFERENCES inv_users(id)
);
CREATE INDEX payments_invoice_idx ON inv_payments (invoice_id, paid_on);
CREATE INDEX payments_date_idx ON inv_payments (paid_on);

/* --------------------------------------------------- credit / debit notes */

CREATE TABLE inv_adjustment_notes (
  id TEXT PRIMARY KEY,
  note_number TEXT NOT NULL UNIQUE,
  financial_year TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CREDIT','DEBIT')),
  invoice_id TEXT NOT NULL REFERENCES inv_invoices(id),
  client_id TEXT NOT NULL REFERENCES inv_clients(id),
  issue_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  notes TEXT NOT NULL DEFAULT '',
  place_of_supply_state_code TEXT NOT NULL DEFAULT '',
  supply_type TEXT NOT NULL DEFAULT 'INTRA' CHECK (supply_type IN ('INTRA','INTER')),
  totals JSONB NOT NULL DEFAULT '{}' CHECK (json_valid(totals)),
  snapshot JSONB CHECK (snapshot IS NULL OR json_valid(snapshot)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id)
);
CREATE INDEX adjustment_notes_invoice_idx ON inv_adjustment_notes (invoice_id);
CREATE INDEX adjustment_notes_date_idx ON inv_adjustment_notes (issue_date);

CREATE TABLE inv_adjustment_note_items (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES inv_adjustment_notes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  description TEXT NOT NULL,
  hsn_sac TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'NOS',
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  taxable_minor INTEGER NOT NULL DEFAULT 0,
  cgst_minor INTEGER NOT NULL DEFAULT 0,
  sgst_minor INTEGER NOT NULL DEFAULT 0,
  igst_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  UNIQUE (note_id, position)
);

/* ------------------------------------------------------ history and audit */

CREATE TABLE inv_document_status_history (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL CHECK (document_type IN ('QUOTATION','INVOICE','CREDIT_NOTE','DEBIT_NOTE')),
  document_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES inv_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX document_status_idx ON inv_document_status_history (document_type, document_id, created_at);

CREATE TABLE inv_audit_logs (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  actor_id TEXT REFERENCES inv_users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX audit_entity_idx ON inv_audit_logs (entity_type, entity_id, created_at);
CREATE INDEX audit_created_idx ON inv_audit_logs (created_at);

/* ------------------------------------------------------- integrity triggers */

/* SQLite has no combined UPDATE OR DELETE event: one trigger per action. */
CREATE TRIGGER audit_append_only_update BEFORE UPDATE ON inv_audit_logs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER audit_append_only_delete BEFORE DELETE ON inv_audit_logs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER history_append_only_update BEFORE UPDATE ON inv_document_status_history FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER history_append_only_delete BEFORE DELETE ON inv_document_status_history FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER payments_append_only_update BEFORE UPDATE ON inv_payments FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER payments_append_only_delete BEFORE DELETE ON inv_payments FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER adjustment_notes_append_only_update BEFORE UPDATE ON inv_adjustment_notes FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER adjustment_notes_append_only_delete BEFORE DELETE ON inv_adjustment_notes FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;

/*
 * Issued documents keep their snapshot, number and totals forever. Only the
 * lifecycle columns may still move (issue, cancel, void), which is what an
 * audit trail requires. This mirrors inv.guard_quotation()/inv.guard_invoice()
 * from the PostgreSQL file: compare every column except the lifecycle ones.
 */
CREATE TRIGGER quotation_history_delete BEFORE DELETE ON inv_quotations FOR EACH ROW
WHEN OLD.quotation_number IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Issued quotations cannot be deleted'); END;

CREATE TRIGGER quotation_history_update BEFORE UPDATE ON inv_quotations FOR EACH ROW
WHEN OLD.snapshot IS NOT NULL AND (
     NEW.id IS NOT OLD.id
  OR NEW.quotation_number IS NOT OLD.quotation_number
  OR NEW.financial_year IS NOT OLD.financial_year
  OR NEW.client_id IS NOT OLD.client_id
  OR NEW.title IS NOT OLD.title
  OR NEW.description IS NOT OLD.description
  OR NEW.scope_of_work IS NOT OLD.scope_of_work
  OR NEW.inclusions IS NOT OLD.inclusions
  OR NEW.exclusions IS NOT OLD.exclusions
  OR NEW.assumptions IS NOT OLD.assumptions
  OR NEW.warranty_terms IS NOT OLD.warranty_terms
  OR NEW.delivery_timeline IS NOT OLD.delivery_timeline
  OR NEW.notes IS NOT OLD.notes
  OR NEW.terms IS NOT OLD.terms
  OR NEW.issue_date IS NOT OLD.issue_date
  OR NEW.expiry_date IS NOT OLD.expiry_date
  OR NEW.place_of_supply_state_code IS NOT OLD.place_of_supply_state_code
  OR NEW.supply_type IS NOT OLD.supply_type
  OR NEW.payment_terms_days IS NOT OLD.payment_terms_days
  OR NEW.payment_terms IS NOT OLD.payment_terms
  OR NEW.project_reference IS NOT OLD.project_reference
  OR NEW.invoice_discount_bp IS NOT OLD.invoice_discount_bp
  OR NEW.invoice_discount_minor IS NOT OLD.invoice_discount_minor
  OR NEW.round_off_enabled IS NOT OLD.round_off_enabled
  OR NEW.additional_charges IS NOT OLD.additional_charges
  OR NEW.totals IS NOT OLD.totals
  OR NEW.snapshot IS NOT OLD.snapshot
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.created_by IS NOT OLD.created_by)
BEGIN SELECT RAISE(ABORT, 'Issued quotation terms are immutable'); END;

CREATE TRIGGER invoice_history_delete BEFORE DELETE ON inv_invoices FOR EACH ROW
WHEN OLD.invoice_number IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Issued invoices cannot be deleted'); END;

CREATE TRIGGER invoice_history_update BEFORE UPDATE ON inv_invoices FOR EACH ROW
WHEN OLD.snapshot IS NOT NULL AND (
     NEW.id IS NOT OLD.id
  OR NEW.invoice_number IS NOT OLD.invoice_number
  OR NEW.financial_year IS NOT OLD.financial_year
  OR NEW.client_id IS NOT OLD.client_id
  OR NEW.quotation_id IS NOT OLD.quotation_id
  OR NEW.title IS NOT OLD.title
  OR NEW.description IS NOT OLD.description
  OR NEW.scope_of_work IS NOT OLD.scope_of_work
  OR NEW.inclusions IS NOT OLD.inclusions
  OR NEW.exclusions IS NOT OLD.exclusions
  OR NEW.assumptions IS NOT OLD.assumptions
  OR NEW.warranty_terms IS NOT OLD.warranty_terms
  OR NEW.delivery_timeline IS NOT OLD.delivery_timeline
  OR NEW.notes IS NOT OLD.notes
  OR NEW.terms IS NOT OLD.terms
  OR NEW.issue_date IS NOT OLD.issue_date
  OR NEW.due_date IS NOT OLD.due_date
  OR NEW.place_of_supply_state_code IS NOT OLD.place_of_supply_state_code
  OR NEW.supply_type IS NOT OLD.supply_type
  OR NEW.payment_terms_days IS NOT OLD.payment_terms_days
  OR NEW.payment_terms IS NOT OLD.payment_terms
  OR NEW.po_reference IS NOT OLD.po_reference
  OR NEW.project_reference IS NOT OLD.project_reference
  OR NEW.invoice_discount_bp IS NOT OLD.invoice_discount_bp
  OR NEW.invoice_discount_minor IS NOT OLD.invoice_discount_minor
  OR NEW.round_off_enabled IS NOT OLD.round_off_enabled
  OR NEW.additional_charges IS NOT OLD.additional_charges
  OR NEW.totals IS NOT OLD.totals
  OR NEW.snapshot IS NOT OLD.snapshot
  OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.created_by IS NOT OLD.created_by)
BEGIN SELECT RAISE(ABORT, 'Issued invoice values are immutable'); END;

/* Line items freeze as soon as their parent document is issued. */
CREATE TRIGGER quotation_items_guard_update BEFORE UPDATE ON inv_quotation_items FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM inv_quotations WHERE id = NEW.quotation_id
  AND (snapshot IS NOT NULL OR status <> 'DRAFT'))
BEGIN SELECT RAISE(ABORT, 'Line items of an issued quotation are immutable'); END;
CREATE TRIGGER quotation_items_guard_delete BEFORE DELETE ON inv_quotation_items FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM inv_quotations WHERE id = OLD.quotation_id
  AND (snapshot IS NOT NULL OR status <> 'DRAFT'))
BEGIN SELECT RAISE(ABORT, 'Line items of an issued quotation are immutable'); END;
CREATE TRIGGER invoice_items_guard_update BEFORE UPDATE ON inv_invoice_items FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM inv_invoices WHERE id = NEW.invoice_id
  AND (snapshot IS NOT NULL OR status <> 'DRAFT'))
BEGIN SELECT RAISE(ABORT, 'Line items of an issued invoice are immutable'); END;
CREATE TRIGGER invoice_items_guard_delete BEFORE DELETE ON inv_invoice_items FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM inv_invoices WHERE id = OLD.invoice_id
  AND (snapshot IS NOT NULL OR status <> 'DRAFT'))
BEGIN SELECT RAISE(ABORT, 'Line items of an issued invoice are immutable'); END;
