/*
 * 007_marketing_contracts.sql
 * Influencer marketing & revenue-sharing contract management module:
 * - inv.brand_assets for company and Nextora POS product logo storage
 * - inv.document_sequences expanded to support INFLUENCER_AGREEMENT
 * - inv.business_settings expanded with influencer_contract_prefix
 * - inv.influencers for influencer contact & partnership information
 * - inv.influencer_agreements for commercial revenue-sharing contracts & snapshots
 * - inv.influencer_attributions for verified sales attribution & commission ledger
 */

CREATE TABLE IF NOT EXISTS inv.brand_assets (
  name text PRIMARY KEY CHECK (name IN ('company_logo', 'product_logo')),
  png bytea NOT NULL CHECK (octet_length(png) BETWEEN 24 AND 1048576),
  sha256 text NOT NULL,
  mime_type text NOT NULL DEFAULT 'image/png',
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  updated_by uuid NOT NULL REFERENCES inv.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO inv.brand_assets (name, png, sha256, updated_by, updated_at)
SELECT name, png, sha256, updated_by, updated_at FROM inv.company_assets
ON CONFLICT (name) DO NOTHING;

ALTER TABLE inv.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_doc_type_check;
ALTER TABLE inv.document_sequences ADD CONSTRAINT document_sequences_doc_type_check
  CHECK (doc_type IN ('QUOTATION','INVOICE','PAYMENT_RECEIPT','CREDIT_NOTE','DEBIT_NOTE','INFLUENCER_AGREEMENT'));

ALTER TABLE inv.business_settings
  ADD COLUMN IF NOT EXISTS influencer_contract_prefix text NOT NULL DEFAULT 'NC/INF'
  CHECK (length(influencer_contract_prefix) BETWEEN 1 AND 12);

CREATE TABLE IF NOT EXISTS inv.influencers (
  id uuid PRIMARY KEY,
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  instagram_username text NOT NULL CHECK (length(btrim(instagram_username)) > 0),
  instagram_url text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state_code text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'India',
  niche text NOT NULL DEFAULT '',
  follower_count integer NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  other_social_links text NOT NULL DEFAULT '',
  profile_image_url text NOT NULL DEFAULT '',
  internal_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS influencers_name_idx ON inv.influencers (lower(legal_name));
CREATE INDEX IF NOT EXISTS influencers_instagram_idx ON inv.influencers (lower(instagram_username));
CREATE INDEX IF NOT EXISTS influencers_email_idx ON inv.influencers (lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS influencers_status_idx ON inv.influencers (status);

CREATE TABLE IF NOT EXISTS inv.influencer_agreements (
  id uuid PRIMARY KEY,
  contract_number text UNIQUE NOT NULL,
  influencer_id uuid NOT NULL REFERENCES inv.influencers(id),
  title text NOT NULL DEFAULT 'Influencer Marketing & Revenue-Sharing Agreement — Nextora POS',
  brand_name text NOT NULL DEFAULT 'Nextora Creations',
  product_name text NOT NULL DEFAULT 'Nextora POS',
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','SENT','ACCEPTED','SIGNED','ACTIVE','EXPIRED','TERMINATED')),
  commission_basis_points integer NOT NULL CHECK (commission_basis_points > 0 AND commission_basis_points <= 10000),
  commission_basis text NOT NULL DEFAULT 'NET_SALES_EX_GST' CHECK (commission_basis IN ('NET_SALES_EX_GST','COLLECTED_NET_REFUNDS','GROSS_COLLECTED','CUSTOM')),
  custom_basis_description text NOT NULL DEFAULT '',
  product_tax_mode text NOT NULL DEFAULT 'EXCLUSIVE' CHECK (product_tax_mode IN ('INCLUSIVE','EXCLUSIVE')),
  commission_tax_terms text NOT NULL DEFAULT 'EXCLUSIVE' CHECK (commission_tax_terms IN ('INCLUSIVE','EXCLUSIVE','EXEMPT','NOT_APPLICABLE')),
  influencer_gst_registered boolean NOT NULL DEFAULT false,
  influencer_gstin text NOT NULL DEFAULT '',
  withholding_tax_rate_bp integer NOT NULL DEFAULT 0 CHECK (withholding_tax_rate_bp BETWEEN 0 AND 3000),
  withholding_section text NOT NULL DEFAULT '194H',
  start_date date NOT NULL,
  end_date date,
  is_indefinite boolean NOT NULL DEFAULT false,
  payment_frequency text NOT NULL DEFAULT 'MONTHLY' CHECK (payment_frequency IN ('MONTHLY','QUARTERLY','BI_MONTHLY','ON_MILESTONE','CUSTOM')),
  payment_due_days integer NOT NULL DEFAULT 15 CHECK (payment_due_days BETWEEN 0 AND 365),
  minimum_payout_minor bigint NOT NULL DEFAULT 100000 CHECK (minimum_payout_minor >= 0),
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_clauses jsonb NOT NULL DEFAULT '{}'::jsonb,
  special_terms text NOT NULL DEFAULT '',
  signatory_name text NOT NULL DEFAULT '',
  signatory_title text NOT NULL DEFAULT '',
  influencer_signatory_name text NOT NULL DEFAULT '',
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_indefinite OR end_date IS NOT NULL),
  CHECK (is_indefinite OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS influencer_agreements_influencer_idx ON inv.influencer_agreements (influencer_id);
CREATE INDEX IF NOT EXISTS influencer_agreements_status_idx ON inv.influencer_agreements (status);
CREATE INDEX IF NOT EXISTS influencer_agreements_number_idx ON inv.influencer_agreements (contract_number);

CREATE TABLE IF NOT EXISTS inv.influencer_attributions (
  id uuid PRIMARY KEY,
  influencer_id uuid NOT NULL REFERENCES inv.influencers(id),
  agreement_id uuid REFERENCES inv.influencer_agreements(id),
  referral_code text NOT NULL DEFAULT '',
  order_reference text NOT NULL DEFAULT '',
  customer_name text NOT NULL DEFAULT '',
  sale_amount_minor bigint NOT NULL DEFAULT 0 CHECK (sale_amount_minor >= 0),
  net_revenue_minor bigint NOT NULL DEFAULT 0 CHECK (net_revenue_minor >= 0),
  commission_minor bigint NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','PAID','DISPUTED','CANCELLED')),
  attributed_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS influencer_attributions_influencer_idx ON inv.influencer_attributions (influencer_id);
CREATE INDEX IF NOT EXISTS influencer_attributions_status_idx ON inv.influencer_attributions (status);
