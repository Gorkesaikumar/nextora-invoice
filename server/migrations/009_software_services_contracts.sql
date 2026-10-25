/*
 * 009_software_services_contracts.sql
 * Software Development Services Agreement Module:
 * - Update inv.document_sequences to include SOFTWARE_SERVICES_AGREEMENT
 * - Add software_contract_prefix to inv.business_settings
 * - Create inv.software_agreements for professional software development contracts,
 *   feature scope, GST-compliant financial calculations, support, and maintenance.
 */

ALTER TABLE inv.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_doc_type_check;
ALTER TABLE inv.document_sequences ADD CONSTRAINT document_sequences_doc_type_check
  CHECK (doc_type IN ('QUOTATION','INVOICE','PAYMENT_RECEIPT','CREDIT_NOTE','DEBIT_NOTE','INFLUENCER_AGREEMENT','SOFTWARE_SERVICES_AGREEMENT'));

ALTER TABLE inv.business_settings
  ADD COLUMN IF NOT EXISTS software_contract_prefix text NOT NULL DEFAULT 'NC/SDA'
  CHECK (length(software_contract_prefix) BETWEEN 1 AND 12);

CREATE TABLE IF NOT EXISTS inv.software_agreements (
  id uuid PRIMARY KEY,
  contract_number text UNIQUE NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','ACCEPTED','SIGNED','ACTIVE','COMPLETED','TERMINATED','CANCELLED')),
  client_id uuid REFERENCES inv.clients(id),

  -- Client Details (Phase 3)
  client_name text NOT NULL CHECK (length(btrim(client_name)) > 0),
  client_legal_name text NOT NULL DEFAULT '',
  contact_person text NOT NULL DEFAULT '',
  client_email text NOT NULL DEFAULT '',
  client_phone text NOT NULL DEFAULT '',
  billing_address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state_code text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'India',
  client_gstin text NOT NULL DEFAULT '',
  client_pan text NOT NULL DEFAULT '',
  client_business_type text NOT NULL DEFAULT '',
  signatory_name text NOT NULL DEFAULT '',
  signatory_designation text NOT NULL DEFAULT '',

  -- Project and Service Details (Phase 4)
  title text NOT NULL DEFAULT 'Software Development Services Agreement',
  service_category text NOT NULL DEFAULT 'Custom software development',
  service_category_custom text NOT NULL DEFAULT '',
  service_description text NOT NULL DEFAULT '',
  business_objectives text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  estimated_completion_date date,
  development_duration text NOT NULL DEFAULT '1 Month',
  requirements_finalization_date date,
  deployment_target text NOT NULL DEFAULT '',
  hosting_responsibility text NOT NULL DEFAULT '',
  client_assets_access text NOT NULL DEFAULT '',
  third_party_integrations text NOT NULL DEFAULT '',
  acceptance_criteria text NOT NULL DEFAULT '',
  project_notes text NOT NULL DEFAULT '',

  -- Requirements and Feature Scope (Phase 5)
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  included_services text NOT NULL DEFAULT '',
  excluded_services text NOT NULL DEFAULT '',
  client_responsibilities text NOT NULL DEFAULT '',
  third_party_dependencies text NOT NULL DEFAULT '',
  technical_assumptions text NOT NULL DEFAULT '',
  scope_limitations text NOT NULL DEFAULT '',

  -- Project Pricing and GST Calculations (Phase 6, Phase 7)
  pricing_mode text NOT NULL DEFAULT 'EXCLUSIVE' CHECK (pricing_mode IN ('EXCLUSIVE','INCLUSIVE')),
  base_price_minor bigint NOT NULL DEFAULT 0 CHECK (base_price_minor >= 0),
  gst_rate_bp integer NOT NULL DEFAULT 1800 CHECK (gst_rate_bp >= 0),
  gst_treatment text NOT NULL DEFAULT 'TAXABLE' CHECK (gst_treatment IN ('TAXABLE','EXEMPT','NIL_RATED','NON_GST')),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  additional_charges_minor bigint NOT NULL DEFAULT 0 CHECK (additional_charges_minor >= 0),
  taxable_amount_minor bigint NOT NULL DEFAULT 0 CHECK (taxable_amount_minor >= 0),
  cgst_minor bigint NOT NULL DEFAULT 0 CHECK (cgst_minor >= 0),
  sgst_minor bigint NOT NULL DEFAULT 0 CHECK (sgst_minor >= 0),
  igst_minor bigint NOT NULL DEFAULT 0 CHECK (igst_minor >= 0),
  total_gst_minor bigint NOT NULL DEFAULT 0 CHECK (total_gst_minor >= 0),
  final_amount_minor bigint NOT NULL DEFAULT 0 CHECK (final_amount_minor >= 0),
  advance_percentage_bp integer NOT NULL DEFAULT 1000 CHECK (advance_percentage_bp BETWEEN 0 AND 10000),
  advance_amount_minor bigint NOT NULL DEFAULT 0 CHECK (advance_amount_minor >= 0),
  remaining_balance_minor bigint NOT NULL DEFAULT 0 CHECK (remaining_balance_minor >= 0),
  payment_milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_terms_notes text NOT NULL DEFAULT '',

  -- Development Timeline & Milestones (Phase 8)
  timeline_milestones jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Support & Maintenance (Phase 9, Phase 10, Phase 11)
  free_support_months integer NOT NULL DEFAULT 3 CHECK (free_support_months >= 0),
  support_start_date date,
  support_end_date date,
  support_scope text NOT NULL DEFAULT '',
  support_reporting_process text NOT NULL DEFAULT '',
  post_support_feature_rate_minor bigint NOT NULL DEFAULT 500000 CHECK (post_support_feature_rate_minor >= 0),
  post_support_terms text NOT NULL DEFAULT '',
  maintenance_included boolean NOT NULL DEFAULT false,
  maintenance_rate_minor bigint NOT NULL DEFAULT 200000 CHECK (maintenance_rate_minor >= 0),
  maintenance_start_date date,
  maintenance_frequency text NOT NULL DEFAULT 'MONTHLY',
  maintenance_scope text NOT NULL DEFAULT '',
  maintenance_exclusions text NOT NULL DEFAULT '',

  -- Terms and Signatures (Phase 12)
  custom_clauses jsonb NOT NULL DEFAULT '{}'::jsonb,
  special_terms text NOT NULL DEFAULT '',
  nextora_signatory_name text NOT NULL DEFAULT '',
  nextora_signatory_title text NOT NULL DEFAULT '',
  client_signatory_name text NOT NULL DEFAULT '',
  client_signatory_title text NOT NULL DEFAULT '',

  sent_at timestamptz,
  accepted_at timestamptz,
  signed_at timestamptz,
  terminated_at timestamptz,
  termination_reason text NOT NULL DEFAULT '',
  pdf_generated_at timestamptz,
  snapshot jsonb,
  created_by uuid NOT NULL REFERENCES inv.users(id),
  approved_by uuid REFERENCES inv.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS software_agreements_client_idx ON inv.software_agreements (client_id);
CREATE INDEX IF NOT EXISTS software_agreements_status_idx ON inv.software_agreements (status);
CREATE INDEX IF NOT EXISTS software_agreements_number_idx ON inv.software_agreements (contract_number);
CREATE INDEX IF NOT EXISTS software_agreements_created_idx ON inv.software_agreements (created_at DESC);
