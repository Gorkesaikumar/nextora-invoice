/*
 * SQLite port of server/migrations/007_marketing_contracts.sql for the desktop app.
 * Influencer marketing & revenue-sharing contract management module:
 * - inv_brand_assets for company and Nextora POS product logo storage
 * - inv_document_sequences expanded to support INFLUENCER_AGREEMENT
 * - inv_business_settings expanded with influencer_contract_prefix
 * - inv_influencers for influencer contact & partnership information
 * - inv_influencer_agreements for commercial revenue-sharing contracts & snapshots
 * - inv_influencer_attributions for verified sales attribution & commission ledger
 */

CREATE TABLE IF NOT EXISTS inv_brand_assets (
  name TEXT PRIMARY KEY CHECK (name IN ('company_logo','product_logo')),
  png BLOB NOT NULL CHECK (length(png) BETWEEN 24 AND 1048576),
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL REFERENCES inv_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO inv_brand_assets (name, png, sha256, updated_by, updated_at)
SELECT name, png, sha256, updated_by, updated_at FROM inv_company_assets;

CREATE TABLE IF NOT EXISTS inv_document_sequences_new (
  doc_type TEXT NOT NULL CHECK (doc_type IN ('QUOTATION','INVOICE','PAYMENT_RECEIPT','CREDIT_NOTE','DEBIT_NOTE','INFLUENCER_AGREEMENT')),
  financial_year TEXT NOT NULL CHECK (financial_year REGEXP '^[0-9]{4}-[0-9]{2}$'),
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_type, financial_year)
);

INSERT OR IGNORE INTO inv_document_sequences_new SELECT * FROM inv_document_sequences;
DROP TABLE IF EXISTS inv_document_sequences;
ALTER TABLE inv_document_sequences_new RENAME TO inv_document_sequences;

ALTER TABLE inv_business_settings ADD COLUMN influencer_contract_prefix TEXT NOT NULL DEFAULT 'NC/INF';

CREATE TABLE IF NOT EXISTS inv_influencers (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  instagram_username TEXT NOT NULL CHECK (length(trim(instagram_username)) > 0),
  instagram_url TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'India',
  niche TEXT NOT NULL DEFAULT '',
  follower_count INTEGER NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  other_social_links TEXT NOT NULL DEFAULT '',
  profile_image_url TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS influencers_name_idx ON inv_influencers (lower(legal_name));
CREATE INDEX IF NOT EXISTS influencers_instagram_idx ON inv_influencers (lower(instagram_username));
CREATE INDEX IF NOT EXISTS influencers_status_idx ON inv_influencers (status);

CREATE TABLE IF NOT EXISTS inv_influencer_agreements (
  id TEXT PRIMARY KEY,
  contract_number TEXT UNIQUE NOT NULL,
  influencer_id TEXT NOT NULL REFERENCES inv_influencers(id),
  title TEXT NOT NULL DEFAULT 'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
  brand_name TEXT NOT NULL DEFAULT 'Nextora Creations',
  product_name TEXT NOT NULL DEFAULT 'Nextora POS',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','SENT','ACCEPTED','SIGNED','ACTIVE','EXPIRED','TERMINATED')),
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

CREATE INDEX IF NOT EXISTS influencer_agreements_influencer_idx ON inv_influencer_agreements (influencer_id);
CREATE INDEX IF NOT EXISTS influencer_agreements_status_idx ON inv_influencer_agreements (status);
CREATE INDEX IF NOT EXISTS influencer_agreements_number_idx ON inv_influencer_agreements (contract_number);

CREATE TABLE IF NOT EXISTS inv_influencer_attributions (
  id TEXT PRIMARY KEY,
  influencer_id TEXT NOT NULL REFERENCES inv_influencers(id),
  agreement_id TEXT REFERENCES inv_influencer_agreements(id),
  referral_code TEXT NOT NULL DEFAULT '',
  order_reference TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  sale_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (sale_amount_minor >= 0),
  net_revenue_minor INTEGER NOT NULL DEFAULT 0 CHECK (net_revenue_minor >= 0),
  commission_minor INTEGER NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','PAID','DISPUTED','CANCELLED')),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS influencer_attributions_influencer_idx ON inv_influencer_attributions (influencer_id);
CREATE INDEX IF NOT EXISTS influencer_attributions_status_idx ON inv_influencer_attributions (status);
