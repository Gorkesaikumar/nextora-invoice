/*
 * SQLite port of server/migrations/009_software_services_contracts.sql for the desktop build.
 * Software Development Services Agreement Module:
 * - Update inv_document_sequences to include SOFTWARE_SERVICES_AGREEMENT
 * - Add software_contract_prefix to inv_business_settings
 * - Create inv_software_agreements for professional software development contracts.
 */

CREATE TABLE IF NOT EXISTS inv_document_sequences_new (
  doc_type TEXT NOT NULL CHECK (doc_type IN ('QUOTATION','INVOICE','PAYMENT_RECEIPT','CREDIT_NOTE','DEBIT_NOTE','INFLUENCER_AGREEMENT','SOFTWARE_SERVICES_AGREEMENT')),
  financial_year TEXT NOT NULL CHECK (financial_year REGEXP '^[0-9]{4}-[0-9]{2}$'),
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_type, financial_year)
);

INSERT OR IGNORE INTO inv_document_sequences_new SELECT * FROM inv_document_sequences;
DROP TABLE IF EXISTS inv_document_sequences;
ALTER TABLE inv_document_sequences_new RENAME TO inv_document_sequences;

ALTER TABLE inv_business_settings ADD COLUMN software_contract_prefix TEXT NOT NULL DEFAULT 'NC/SDA';

CREATE TABLE IF NOT EXISTS inv_software_agreements (
  id TEXT PRIMARY KEY,
  contract_number TEXT UNIQUE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','ACCEPTED','SIGNED','ACTIVE','COMPLETED','TERMINATED','CANCELLED')),
  client_id TEXT REFERENCES inv_clients(id),

  -- Client Details (Phase 3)
  client_name TEXT NOT NULL CHECK (length(trim(client_name)) > 0),
  client_legal_name TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'India',
  client_gstin TEXT NOT NULL DEFAULT '',
  client_pan TEXT NOT NULL DEFAULT '',
  client_business_type TEXT NOT NULL DEFAULT '',
  signatory_name TEXT NOT NULL DEFAULT '',
  signatory_designation TEXT NOT NULL DEFAULT '',

  -- Project and Service Details (Phase 4)
  title TEXT NOT NULL DEFAULT 'Software Development Services Agreement',
  service_category TEXT NOT NULL DEFAULT 'Custom software development',
  service_category_custom TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  business_objectives TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  estimated_completion_date TEXT,
  development_duration TEXT NOT NULL DEFAULT '1 Month',
  requirements_finalization_date TEXT,
  deployment_target TEXT NOT NULL DEFAULT '',
  hosting_responsibility TEXT NOT NULL DEFAULT '',
  client_assets_access TEXT NOT NULL DEFAULT '',
  third_party_integrations TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  project_notes TEXT NOT NULL DEFAULT '',

  -- Requirements and Feature Scope (Phase 5)
  features TEXT NOT NULL DEFAULT '[]',
  included_services TEXT NOT NULL DEFAULT '',
  excluded_services TEXT NOT NULL DEFAULT '',
  client_responsibilities TEXT NOT NULL DEFAULT '',
  third_party_dependencies TEXT NOT NULL DEFAULT '',
  technical_assumptions TEXT NOT NULL DEFAULT '',
  scope_limitations TEXT NOT NULL DEFAULT '',

  -- Project Pricing and GST Calculations (Phase 6, Phase 7)
  pricing_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK (pricing_mode IN ('EXCLUSIVE','INCLUSIVE')),
  base_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (base_price_minor >= 0),
  gst_rate_bp INTEGER NOT NULL DEFAULT 1800 CHECK (gst_rate_bp >= 0),
  gst_treatment TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (gst_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST')),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  additional_charges_minor INTEGER NOT NULL DEFAULT 0 CHECK (additional_charges_minor >= 0),
  taxable_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (taxable_amount_minor >= 0),
  cgst_minor INTEGER NOT NULL DEFAULT 0 CHECK (cgst_minor >= 0),
  sgst_minor INTEGER NOT NULL DEFAULT 0 CHECK (sgst_minor >= 0),
  igst_minor INTEGER NOT NULL DEFAULT 0 CHECK (igst_minor >= 0),
  total_gst_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_gst_minor >= 0),
  final_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (final_amount_minor >= 0),
  advance_percentage_bp INTEGER NOT NULL DEFAULT 1000 CHECK (advance_percentage_bp BETWEEN 0 AND 10000),
  advance_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (advance_amount_minor >= 0),
  remaining_balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (remaining_balance_minor >= 0),
  payment_milestones TEXT NOT NULL DEFAULT '[]',
  payment_terms_notes TEXT NOT NULL DEFAULT '',

  -- Development Timeline & Milestones (Phase 8)
  timeline_milestones TEXT NOT NULL DEFAULT '[]',

  -- Support & Maintenance (Phase 9, Phase 10, Phase 11)
  free_support_months INTEGER NOT NULL DEFAULT 3 CHECK (free_support_months >= 0),
  support_start_date TEXT,
  support_end_date TEXT,
  support_scope TEXT NOT NULL DEFAULT '',
  support_reporting_process TEXT NOT NULL DEFAULT '',
  post_support_feature_rate_minor INTEGER NOT NULL DEFAULT 500000 CHECK (post_support_feature_rate_minor >= 0),
  post_support_terms TEXT NOT NULL DEFAULT '',
  maintenance_included INTEGER NOT NULL DEFAULT 0,
  maintenance_rate_minor INTEGER NOT NULL DEFAULT 200000 CHECK (maintenance_rate_minor >= 0),
  maintenance_start_date TEXT,
  maintenance_frequency TEXT NOT NULL DEFAULT 'MONTHLY',
  maintenance_scope TEXT NOT NULL DEFAULT '',
  maintenance_exclusions TEXT NOT NULL DEFAULT '',

  -- Terms and Signatures (Phase 12)
  custom_clauses TEXT NOT NULL DEFAULT '{}',
  special_terms TEXT NOT NULL DEFAULT '',
  nextora_signatory_name TEXT NOT NULL DEFAULT '',
  nextora_signatory_title TEXT NOT NULL DEFAULT '',
  client_signatory_name TEXT NOT NULL DEFAULT '',
  client_signatory_title TEXT NOT NULL DEFAULT '',

  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  terminated_at TIMESTAMPTZ,
  termination_reason TEXT NOT NULL DEFAULT '',
  pdf_generated_at TIMESTAMPTZ,
  snapshot TEXT,
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  approved_by TEXT REFERENCES inv_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS software_agreements_client_idx ON inv_software_agreements (client_id);
CREATE INDEX IF NOT EXISTS software_agreements_status_idx ON inv_software_agreements (status);
CREATE INDEX IF NOT EXISTS software_agreements_number_idx ON inv_software_agreements (contract_number);
CREATE INDEX IF NOT EXISTS software_agreements_created_idx ON inv_software_agreements (created_at DESC);
