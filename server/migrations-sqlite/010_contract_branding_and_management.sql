/*
 * SQLite Migration 010: Contract Branding Modes and Safe Deletion/Archival Statuses
 * - Add branding_mode column ('BOTH', 'COMPANY_ONLY', 'PRODUCT_ONLY', 'TEXT_ONLY') to inv_influencer_agreements (default: BOTH)
 * - Add branding_mode column ('BOTH', 'COMPANY_ONLY', 'PRODUCT_ONLY', 'TEXT_ONLY') to inv_software_agreements (default: COMPANY_ONLY)
 * - Expand status check constraints to support 'ARCHIVED' and 'CANCELLED' for contracts
 */

CREATE TABLE IF NOT EXISTS inv_influencer_agreements_new (
  id TEXT PRIMARY KEY,
  contract_number TEXT UNIQUE NOT NULL,
  influencer_id TEXT NOT NULL REFERENCES inv_influencers(id),
  title TEXT NOT NULL DEFAULT 'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
  brand_name TEXT NOT NULL DEFAULT 'Nextora Creations',
  product_name TEXT NOT NULL DEFAULT 'Nextora POS',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','SENT','ACCEPTED','SIGNED','ACTIVE','EXPIRED','TERMINATED','ARCHIVED','CANCELLED')),
  branding_mode TEXT NOT NULL DEFAULT 'BOTH' CHECK (branding_mode IN ('BOTH','COMPANY_ONLY','PRODUCT_ONLY','TEXT_ONLY')),
  commission_basis_points INTEGER NOT NULL CHECK (commission_basis_points > 0 AND commission_basis_points <= 10000),
  commission_basis TEXT NOT NULL DEFAULT 'NET_SALES_EX_GST' CHECK (commission_basis IN ('NET_SALES_EX_GST','COLLECTED_NET_REFUNDS','GROSS_COLLECTED','CUSTOM')),
  custom_basis_description TEXT NOT NULL DEFAULT '',
  product_tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK (product_tax_mode IN ('INCLUSIVE','EXCLUSIVE')),
  commission_tax_terms TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK (commission_tax_terms IN ('INCLUSIVE','EXCLUSIVE','EXEMPT','NOT_APPLICABLE')),
  influencer_gst_registered INTEGER NOT NULL DEFAULT 0 CHECK (influencer_gst_registered IN (0,1)),
  influencer_gstin TEXT NOT NULL DEFAULT '',
  withholding_tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (withholding_tax_rate_bp BETWEEN 0 AND 3000),
  withholding_section TEXT NOT NULL DEFAULT '194H',
  start_date TEXT NOT NULL,
  end_date TEXT,
  is_indefinite INTEGER NOT NULL DEFAULT 0 CHECK (is_indefinite IN (0,1)),
  payment_frequency TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (payment_frequency IN ('MONTHLY','QUARTERLY','BI_MONTHLY','ON_MILESTONE','CUSTOM')),
  payment_due_days INTEGER NOT NULL DEFAULT 15 CHECK (payment_due_days BETWEEN 0 AND 365),
  minimum_payout_minor INTEGER NOT NULL DEFAULT 100000 CHECK (minimum_payout_minor >= 0),
  deliverables TEXT NOT NULL DEFAULT '[]',
  custom_clauses TEXT NOT NULL DEFAULT '{}',
  special_terms TEXT NOT NULL DEFAULT '',
  signatory_name TEXT NOT NULL DEFAULT '',
  signatory_title TEXT NOT NULL DEFAULT '',
  influencer_signatory_name TEXT NOT NULL DEFAULT '',
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  CHECK (is_indefinite = 1 OR end_date IS NOT NULL),
  CHECK (is_indefinite = 1 OR end_date >= start_date)
);

INSERT INTO inv_influencer_agreements_new (
  id, contract_number, influencer_id, title, brand_name, product_name, version, status,
  branding_mode, commission_basis_points, commission_basis, custom_basis_description,
  product_tax_mode, commission_tax_terms, influencer_gst_registered, influencer_gstin,
  withholding_tax_rate_bp, withholding_section, start_date, end_date, is_indefinite,
  payment_frequency, payment_due_days, minimum_payout_minor, deliverables, custom_clauses,
  special_terms, signatory_name, signatory_title, influencer_signatory_name, sent_at,
  accepted_at, signed_at, terminated_at, termination_reason, pdf_generated_at, snapshot,
  created_by, approved_by, created_at, updated_at
)
SELECT
  id, contract_number, influencer_id, title, brand_name, product_name, version, status,
  'BOTH', commission_basis_points, commission_basis, custom_basis_description,
  product_tax_mode, commission_tax_terms, influencer_gst_registered, influencer_gstin,
  withholding_tax_rate_bp, withholding_section, start_date, end_date, is_indefinite,
  payment_frequency, payment_due_days, minimum_payout_minor, deliverables, custom_clauses,
  special_terms, signatory_name, signatory_title, influencer_signatory_name, sent_at,
  accepted_at, signed_at, terminated_at, termination_reason, pdf_generated_at, snapshot,
  created_by, approved_by, created_at, updated_at
FROM inv_influencer_agreements;

DROP TABLE inv_influencer_agreements;
ALTER TABLE inv_influencer_agreements_new RENAME TO inv_influencer_agreements;

CREATE INDEX IF NOT EXISTS influencer_agreements_influencer_idx ON inv_influencer_agreements (influencer_id);
CREATE INDEX IF NOT EXISTS influencer_agreements_status_idx ON inv_influencer_agreements (status);
CREATE INDEX IF NOT EXISTS influencer_agreements_number_idx ON inv_influencer_agreements (contract_number);


CREATE TABLE IF NOT EXISTS inv_software_agreements_new (
  id TEXT PRIMARY KEY,
  contract_number TEXT UNIQUE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','ACCEPTED','SIGNED','ACTIVE','COMPLETED','TERMINATED','CANCELLED','ARCHIVED')),
  branding_mode TEXT NOT NULL DEFAULT 'COMPANY_ONLY'
    CHECK (branding_mode IN ('BOTH','COMPANY_ONLY','PRODUCT_ONLY','TEXT_ONLY')),
  client_id TEXT REFERENCES inv_clients(id),

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

  features TEXT NOT NULL DEFAULT '[]',
  included_services TEXT NOT NULL DEFAULT '',
  excluded_services TEXT NOT NULL DEFAULT '',
  client_responsibilities TEXT NOT NULL DEFAULT '',
  third_party_dependencies TEXT NOT NULL DEFAULT '',
  technical_assumptions TEXT NOT NULL DEFAULT '',
  scope_limitations TEXT NOT NULL DEFAULT '',

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

  timeline_milestones TEXT NOT NULL DEFAULT '[]',

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

INSERT INTO inv_software_agreements_new (
  id, contract_number, version, status, branding_mode, client_id,
  client_name, client_legal_name, contact_person, client_email, client_phone,
  billing_address, city, state_code, postal_code, country, client_gstin, client_pan, client_business_type,
  signatory_name, signatory_designation,
  title, service_category, service_category_custom, service_description, business_objectives,
  start_date, estimated_completion_date, development_duration, requirements_finalization_date,
  deployment_target, hosting_responsibility, client_assets_access, third_party_integrations,
  acceptance_criteria, project_notes,
  features, included_services, excluded_services, client_responsibilities, third_party_dependencies,
  technical_assumptions, scope_limitations,
  pricing_mode, base_price_minor, gst_rate_bp, gst_treatment, discount_minor, additional_charges_minor,
  taxable_amount_minor, cgst_minor, sgst_minor, igst_minor, total_gst_minor, final_amount_minor,
  advance_percentage_bp, advance_amount_minor, remaining_balance_minor, payment_milestones, payment_terms_notes,
  timeline_milestones,
  free_support_months, support_start_date, support_end_date, support_scope, support_reporting_process,
  post_support_feature_rate_minor, post_support_terms, maintenance_included, maintenance_rate_minor,
  maintenance_start_date, maintenance_frequency, maintenance_scope, maintenance_exclusions,
  custom_clauses, special_terms, nextora_signatory_name, nextora_signatory_title,
  client_signatory_name, client_signatory_title,
  sent_at, accepted_at, signed_at, terminated_at, termination_reason, pdf_generated_at, snapshot,
  created_by, approved_by, created_at, updated_at
)
SELECT
  id, contract_number, version, status, 'COMPANY_ONLY', client_id,
  client_name, client_legal_name, contact_person, client_email, client_phone,
  billing_address, city, state_code, postal_code, country, client_gstin, client_pan, client_business_type,
  signatory_name, signatory_designation,
  title, service_category, service_category_custom, service_description, business_objectives,
  start_date, estimated_completion_date, development_duration, requirements_finalization_date,
  deployment_target, hosting_responsibility, client_assets_access, third_party_integrations,
  acceptance_criteria, project_notes,
  features, included_services, excluded_services, client_responsibilities, third_party_dependencies,
  technical_assumptions, scope_limitations,
  pricing_mode, base_price_minor, gst_rate_bp, gst_treatment, discount_minor, additional_charges_minor,
  taxable_amount_minor, cgst_minor, sgst_minor, igst_minor, total_gst_minor, final_amount_minor,
  advance_percentage_bp, advance_amount_minor, remaining_balance_minor, payment_milestones, payment_terms_notes,
  timeline_milestones,
  free_support_months, support_start_date, support_end_date, support_scope, support_reporting_process,
  post_support_feature_rate_minor, post_support_terms, maintenance_included, maintenance_rate_minor,
  maintenance_start_date, maintenance_frequency, maintenance_scope, maintenance_exclusions,
  custom_clauses, special_terms, nextora_signatory_name, nextora_signatory_title,
  client_signatory_name, client_signatory_title,
  sent_at, accepted_at, signed_at, terminated_at, termination_reason, pdf_generated_at, snapshot,
  created_by, approved_by, created_at, updated_at
FROM inv_software_agreements;

DROP TABLE inv_software_agreements;
ALTER TABLE inv_software_agreements_new RENAME TO inv_software_agreements;

CREATE INDEX IF NOT EXISTS software_agreements_client_idx ON inv_software_agreements (client_id);
CREATE INDEX IF NOT EXISTS software_agreements_status_idx ON inv_software_agreements (status);
CREATE INDEX IF NOT EXISTS software_agreements_number_idx ON inv_software_agreements (contract_number);
CREATE INDEX IF NOT EXISTS software_agreements_created_idx ON inv_software_agreements (created_at DESC);
