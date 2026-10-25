CREATE SCHEMA IF NOT EXISTS inv;
REVOKE ALL ON SCHEMA inv FROM PUBLIC;

/* -------------------------------------------------------------------- access */

CREATE TABLE inv.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','FINANCE','ACCOUNTANT')),
  display_name text NOT NULL DEFAULT '',
  disabled boolean NOT NULL DEFAULT false,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inv.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES inv.users(id),
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON inv.sessions(user_id);

CREATE TABLE inv.rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON inv.rate_limits(expires_at);

/* -------------------------------------------------------------------- issuer */

CREATE TABLE inv.business_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  business_name text NOT NULL DEFAULT 'Nextora Creations',
  legal_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  state_code text NOT NULL DEFAULT '',
  pan text NOT NULL DEFAULT '',
  bank_account_name text NOT NULL DEFAULT '',
  bank_account_number text NOT NULL DEFAULT '',
  bank_ifsc text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  bank_branch text NOT NULL DEFAULT '',
  upi_id text NOT NULL DEFAULT '',
  signatory_name text NOT NULL DEFAULT '',
  signatory_title text NOT NULL DEFAULT '',
  default_quotation_validity_days integer NOT NULL DEFAULT 30 CHECK (default_quotation_validity_days BETWEEN 1 AND 365),
  default_payment_terms_days integer NOT NULL DEFAULT 15 CHECK (default_payment_terms_days BETWEEN 0 AND 365),
  default_currency text NOT NULL DEFAULT 'INR' CHECK (default_currency = 'INR'),
  rounding_mode text NOT NULL DEFAULT 'NEAREST_RUPEE' CHECK (rounding_mode IN ('NEAREST_RUPEE','NONE')),
  default_tax_rate_bp integer NOT NULL DEFAULT 1800 CHECK (default_tax_rate_bp BETWEEN 0 AND 10000),
  reverse_charge boolean NOT NULL DEFAULT false,
  quotation_prefix text NOT NULL DEFAULT 'NC/QTN' CHECK (length(quotation_prefix) BETWEEN 1 AND 12),
  invoice_prefix text NOT NULL DEFAULT 'NC/INV' CHECK (length(invoice_prefix) BETWEEN 1 AND 12),
  receipt_prefix text NOT NULL DEFAULT 'NC/RCP' CHECK (length(receipt_prefix) BETWEEN 1 AND 12),
  credit_note_prefix text NOT NULL DEFAULT 'NC/CRN' CHECK (length(credit_note_prefix) BETWEEN 1 AND 12),
  terms text NOT NULL DEFAULT '',
  quotation_terms text NOT NULL DEFAULT '',
  pdf_accent_color text NOT NULL DEFAULT '#00AEEF' CHECK (pdf_accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  show_bank_details boolean NOT NULL DEFAULT true,
  show_signatory boolean NOT NULL DEFAULT true,
  show_amount_in_words boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES inv.users(id),
  CHECK (length(gstin) = 0 OR length(state_code) = 2),
  CHECK (length(gstin) = 0 OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$')
);
INSERT INTO inv.business_settings(id) VALUES (true);

CREATE TABLE inv.company_assets (
  name text PRIMARY KEY CHECK (name IN ('company_logo')),
  png bytea NOT NULL CHECK (octet_length(png) BETWEEN 24 AND 512000),
  sha256 text NOT NULL,
  updated_by uuid NOT NULL REFERENCES inv.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

/* ----------------------------------------------------------------- customers */

CREATE TABLE inv.clients (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('BUSINESS','INDIVIDUAL')),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  company_name text NOT NULL DEFAULT '',
  contact_person text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  billing_address text NOT NULL DEFAULT '',
  service_address text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  state_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'India',
  notes text NOT NULL DEFAULT '',
  payment_terms_days integer NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
  gst_registered boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  CHECK (NOT gst_registered OR length(gstin) = 15),
  CHECK (length(gstin) = 0 OR length(state_code) = 2)
);
CREATE INDEX clients_name_idx ON inv.clients (lower(name));
CREATE INDEX clients_company_idx ON inv.clients (lower(company_name));
CREATE INDEX clients_status_idx ON inv.clients (status);
CREATE INDEX clients_gstin_idx ON inv.clients (gstin) WHERE gstin <> '';

/* ------------------------------------------------------------------- catalog */

CREATE TABLE inv.products (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  sku text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'NOS',
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  tax_treatment text NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  tax_rate_bp integer NOT NULL DEFAULT 1800 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  hsn_sac text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  billing_interval text NOT NULL DEFAULT 'NONE' CHECK (billing_interval IN ('NONE','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY')),
  license_duration_months integer NOT NULL DEFAULT 0 CHECK (license_duration_months BETWEEN 0 AND 600),
  validity_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  CHECK (tax_treatment = 'TAXABLE' OR tax_rate_bp = 0)
);
CREATE UNIQUE INDEX products_sku_idx ON inv.products (lower(sku)) WHERE sku <> '';
CREATE INDEX products_status_idx ON inv.products (status, category);

/* ----------------------------------------------------------------- numbering */

CREATE TABLE inv.document_sequences (
  doc_type text NOT NULL CHECK (doc_type IN ('QUOTATION','INVOICE','PAYMENT_RECEIPT','CREDIT_NOTE','DEBIT_NOTE')),
  financial_year text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  prefix text NOT NULL,
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, financial_year)
);

/* ---------------------------------------------------------------- quotations */

CREATE TABLE inv.quotations (
  id uuid PRIMARY KEY,
  quotation_number text UNIQUE,
  financial_year text,
  client_id uuid NOT NULL REFERENCES inv.clients(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  scope_of_work text NOT NULL DEFAULT '',
  inclusions text NOT NULL DEFAULT '',
  exclusions text NOT NULL DEFAULT '',
  assumptions text NOT NULL DEFAULT '',
  warranty_terms text NOT NULL DEFAULT '',
  delivery_timeline text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  terms text NOT NULL DEFAULT '',
  issue_date date NOT NULL,
  expiry_date date,
  place_of_supply_state_code text NOT NULL DEFAULT '',
  supply_type text NOT NULL DEFAULT 'INTRA' CHECK (supply_type IN ('INTRA','INTER')),
  payment_terms_days integer NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
  payment_terms text NOT NULL DEFAULT '',
  project_reference text NOT NULL DEFAULT '',
  invoice_discount_bp integer NOT NULL DEFAULT 0 CHECK (invoice_discount_bp BETWEEN 0 AND 10000),
  invoice_discount_minor bigint NOT NULL DEFAULT 0 CHECK (invoice_discount_minor >= 0),
  round_off_enabled boolean NOT NULL DEFAULT true,
  additional_charges jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  cancelled_at timestamptz,
  cancellation_reason text,
  converted_invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  CHECK (expiry_date IS NULL OR expiry_date >= issue_date),
  CHECK (quotation_number IS NOT NULL OR status = 'DRAFT'),
  CHECK (status <> 'ACCEPTED' OR accepted_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(cancellation_reason) > 0))
);
CREATE UNIQUE INDEX quotations_number_idx ON inv.quotations (quotation_number) WHERE quotation_number IS NOT NULL;
CREATE INDEX quotations_client_idx ON inv.quotations (client_id, issue_date DESC);
CREATE INDEX quotations_status_idx ON inv.quotations (status, issue_date DESC);
CREATE INDEX quotations_search_idx ON inv.quotations (lower(title));

CREATE TABLE inv.quotation_items (
  id uuid PRIMARY KEY,
  quotation_id uuid NOT NULL REFERENCES inv.quotations(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  product_id uuid REFERENCES inv.products(id),
  description text NOT NULL,
  category text NOT NULL DEFAULT '',
  hsn_sac text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'NOS',
  quantity_milli bigint NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp integer NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_rate_bp integer NOT NULL DEFAULT 1800 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_treatment text NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  gross_minor bigint NOT NULL DEFAULT 0,
  item_discount_minor bigint NOT NULL DEFAULT 0,
  invoice_discount_minor bigint NOT NULL DEFAULT 0,
  taxable_minor bigint NOT NULL DEFAULT 0,
  cgst_minor bigint NOT NULL DEFAULT 0,
  sgst_minor bigint NOT NULL DEFAULT 0,
  igst_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  UNIQUE (quotation_id, position)
);

CREATE TABLE inv.quotation_milestones (
  id uuid PRIMARY KEY,
  quotation_id uuid NOT NULL REFERENCES inv.quotations(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  share_bp integer NOT NULL DEFAULT 0 CHECK (share_bp BETWEEN 0 AND 10000),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  due_offset_days integer NOT NULL DEFAULT 0 CHECK (due_offset_days BETWEEN 0 AND 3650),
  UNIQUE (quotation_id, position)
);

/* ------------------------------------------------------------------ invoices */

CREATE TABLE inv.invoices (
  id uuid PRIMARY KEY,
  invoice_number text UNIQUE,
  financial_year text,
  client_id uuid NOT NULL REFERENCES inv.clients(id),
  quotation_id uuid REFERENCES inv.quotations(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','CANCELLED','VOID')),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  scope_of_work text NOT NULL DEFAULT '',
  inclusions text NOT NULL DEFAULT '',
  exclusions text NOT NULL DEFAULT '',
  assumptions text NOT NULL DEFAULT '',
  warranty_terms text NOT NULL DEFAULT '',
  delivery_timeline text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  terms text NOT NULL DEFAULT '',
  issue_date date NOT NULL,
  due_date date,
  place_of_supply_state_code text NOT NULL DEFAULT '',
  supply_type text NOT NULL DEFAULT 'INTRA' CHECK (supply_type IN ('INTRA','INTER')),
  payment_terms_days integer NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
  payment_terms text NOT NULL DEFAULT '',
  po_reference text NOT NULL DEFAULT '',
  project_reference text NOT NULL DEFAULT '',
  invoice_discount_bp integer NOT NULL DEFAULT 0 CHECK (invoice_discount_bp BETWEEN 0 AND 10000),
  invoice_discount_minor bigint NOT NULL DEFAULT 0 CHECK (invoice_discount_minor >= 0),
  round_off_enabled boolean NOT NULL DEFAULT true,
  additional_charges jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb,
  issued_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  CHECK (due_date IS NULL OR due_date >= issue_date),
  CHECK (invoice_number IS NOT NULL OR status = 'DRAFT'),
  CHECK (status <> 'ISSUED' OR (issued_at IS NOT NULL AND invoice_number IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(cancellation_reason) > 0))
);
CREATE UNIQUE INDEX invoices_number_idx ON inv.invoices (invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX invoices_client_idx ON inv.invoices (client_id, issue_date DESC);
CREATE INDEX invoices_status_idx ON inv.invoices (status, due_date);
CREATE INDEX invoices_issue_idx ON inv.invoices (issue_date);
CREATE INDEX invoices_quotation_idx ON inv.invoices (quotation_id) WHERE quotation_id IS NOT NULL;

CREATE TABLE inv.invoice_items (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES inv.invoices(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  product_id uuid REFERENCES inv.products(id),
  description text NOT NULL,
  category text NOT NULL DEFAULT '',
  hsn_sac text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'NOS',
  quantity_milli bigint NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_bp integer NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_rate_bp integer NOT NULL DEFAULT 1800 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_treatment text NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  gross_minor bigint NOT NULL DEFAULT 0,
  item_discount_minor bigint NOT NULL DEFAULT 0,
  invoice_discount_minor bigint NOT NULL DEFAULT 0,
  taxable_minor bigint NOT NULL DEFAULT 0,
  cgst_minor bigint NOT NULL DEFAULT 0,
  sgst_minor bigint NOT NULL DEFAULT 0,
  igst_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, position)
);

ALTER TABLE inv.quotations
  ADD CONSTRAINT quotations_converted_invoice_fk
  FOREIGN KEY (converted_invoice_id) REFERENCES inv.invoices(id);

/* ------------------------------------------------------------------ payments */

CREATE TABLE inv.payments (
  id uuid PRIMARY KEY,
  receipt_number text NOT NULL UNIQUE,
  financial_year text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES inv.invoices(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('CASH','BANK_TRANSFER','UPI','CARD','CHEQUE','OTHER')),
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  snapshot jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES inv.users(id)
);
CREATE INDEX payments_invoice_idx ON inv.payments (invoice_id, paid_on);
CREATE INDEX payments_date_idx ON inv.payments (paid_on);

/* --------------------------------------------------- credit / debit notes */

CREATE TABLE inv.adjustment_notes (
  id uuid PRIMARY KEY,
  note_number text NOT NULL UNIQUE,
  financial_year text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CREDIT','DEBIT')),
  invoice_id uuid NOT NULL REFERENCES inv.invoices(id),
  client_id uuid NOT NULL REFERENCES inv.clients(id),
  issue_date date NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  notes text NOT NULL DEFAULT '',
  place_of_supply_state_code text NOT NULL DEFAULT '',
  supply_type text NOT NULL DEFAULT 'INTRA' CHECK (supply_type IN ('INTRA','INTER')),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id)
);
CREATE INDEX adjustment_notes_invoice_idx ON inv.adjustment_notes (invoice_id);
CREATE INDEX adjustment_notes_date_idx ON inv.adjustment_notes (issue_date);

CREATE TABLE inv.adjustment_note_items (
  id uuid PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES inv.adjustment_notes(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  description text NOT NULL,
  hsn_sac text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'NOS',
  quantity_milli bigint NOT NULL CHECK (quantity_milli > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  tax_rate_bp integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_treatment text NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST','OUT_OF_SCOPE')),
  taxable_minor bigint NOT NULL DEFAULT 0,
  cgst_minor bigint NOT NULL DEFAULT 0,
  sgst_minor bigint NOT NULL DEFAULT 0,
  igst_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  UNIQUE (note_id, position)
);

/* ------------------------------------------------------ history and audit */

CREATE TABLE inv.document_status_history (
  id uuid PRIMARY KEY,
  document_type text NOT NULL CHECK (document_type IN ('QUOTATION','INVOICE','CREDIT_NOTE','DEBIT_NOTE')),
  document_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  note text NOT NULL DEFAULT '',
  actor_id uuid REFERENCES inv.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_status_idx ON inv.document_status_history (document_type, document_id, created_at);

CREATE TABLE inv.audit_logs (
  id uuid PRIMARY KEY,
  event text NOT NULL,
  actor_id uuid REFERENCES inv.users(id),
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON inv.audit_logs (entity_type, entity_id, created_at);
CREATE INDEX audit_created_idx ON inv.audit_logs (created_at);

/* ------------------------------------------------------- integrity triggers */

CREATE FUNCTION inv.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historical record is immutable'; END;
$$;

CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON inv.audit_logs
  FOR EACH ROW EXECUTE FUNCTION inv.reject_mutation();
CREATE TRIGGER history_append_only BEFORE UPDATE OR DELETE ON inv.document_status_history
  FOR EACH ROW EXECUTE FUNCTION inv.reject_mutation();
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON inv.payments
  FOR EACH ROW EXECUTE FUNCTION inv.reject_mutation();
CREATE TRIGGER adjustment_notes_append_only BEFORE UPDATE OR DELETE ON inv.adjustment_notes
  FOR EACH ROW EXECUTE FUNCTION inv.reject_mutation();

/*
 * Issued documents keep their snapshot, number and totals forever. Only the
 * lifecycle columns may still move (issue, cancel, void), which is what an
 * audit trail requires.
 */
CREATE FUNCTION inv.guard_quotation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.quotation_number IS NOT NULL THEN RAISE EXCEPTION 'Issued quotations cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.snapshot IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['status','sent_at','accepted_at','rejected_at','rejection_reason',
        'cancelled_at','cancellation_reason','converted_invoice_id','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','sent_at','accepted_at','rejected_at','rejection_reason',
        'cancelled_at','cancellation_reason','converted_invoice_id','updated_at'])
    THEN RAISE EXCEPTION 'Issued quotation terms are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION inv.guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_number IS NOT NULL THEN RAISE EXCEPTION 'Issued invoices cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.snapshot IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['status','cancelled_at','cancellation_reason','voided_at','void_reason','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','cancelled_at','cancellation_reason','voided_at','void_reason','updated_at'])
    THEN RAISE EXCEPTION 'Issued invoice values are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quotation_history BEFORE UPDATE OR DELETE ON inv.quotations
  FOR EACH ROW EXECUTE FUNCTION inv.guard_quotation();
CREATE TRIGGER invoice_history BEFORE UPDATE OR DELETE ON inv.invoices
  FOR EACH ROW EXECUTE FUNCTION inv.guard_invoice();

/* Line items freeze as soon as their parent document is issued. */
CREATE FUNCTION inv.guard_quotation_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; issued boolean;
BEGIN
  parent_id := COALESCE(NEW.quotation_id, OLD.quotation_id);
  SELECT snapshot IS NOT NULL OR status <> 'DRAFT' INTO issued FROM inv.quotations WHERE id = parent_id;
  IF issued THEN RAISE EXCEPTION 'Line items of an issued quotation are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION inv.guard_invoice_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; issued boolean;
BEGIN
  parent_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT snapshot IS NOT NULL OR status <> 'DRAFT' INTO issued FROM inv.invoices WHERE id = parent_id;
  IF issued THEN RAISE EXCEPTION 'Line items of an issued invoice are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER quotation_items_guard BEFORE UPDATE OR DELETE ON inv.quotation_items
  FOR EACH ROW EXECUTE FUNCTION inv.guard_quotation_item();
CREATE TRIGGER invoice_items_guard BEFORE UPDATE OR DELETE ON inv.invoice_items
  FOR EACH ROW EXECUTE FUNCTION inv.guard_invoice_item();
