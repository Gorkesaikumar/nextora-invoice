/*
 * 008_influencer_sales_tracking.sql
 * Influencer-wise sales tracking, excel import, revenue calculation & reporting:
 * - inv.influencer_sales_batches for import auditing, deduplication, and file tracking
 * - inv.influencer_sales_records for customer sales segregation, revenue attribution,
 *   commission calculation snapshots, and settlement status tracking
 */

CREATE TABLE IF NOT EXISTS inv.influencer_sales_batches (
  id uuid PRIMARY KEY,
  filename text NOT NULL,
  file_sha256 text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  valid_row_count integer NOT NULL DEFAULT 0,
  invalid_row_count integer NOT NULL DEFAULT 0,
  duplicate_row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PREVIEW','COMPLETED','FAILED','REVERTED')),
  notes text NOT NULL DEFAULT '',
  imported_by uuid NOT NULL REFERENCES inv.users(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS influencer_sales_batches_imported_at_idx ON inv.influencer_sales_batches (imported_at DESC);
CREATE INDEX IF NOT EXISTS influencer_sales_batches_sha_idx ON inv.influencer_sales_batches (file_sha256);

CREATE TABLE IF NOT EXISTS inv.influencer_sales_records (
  id uuid PRIMARY KEY,
  batch_id uuid REFERENCES inv.influencer_sales_batches(id),
  serial_number integer NOT NULL DEFAULT 0,
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) > 0),
  business_name text NOT NULL DEFAULT '',
  purchased_date date NOT NULL,
  product_name text NOT NULL DEFAULT '',
  expiry_date date,
  is_lifetime boolean NOT NULL DEFAULT false,
  customer_location text NOT NULL DEFAULT '',
  raw_influencer_name text NOT NULL DEFAULT '',
  influencer_id uuid REFERENCES inv.influencers(id),
  agreement_id uuid REFERENCES inv.influencer_agreements(id),
  order_reference text NOT NULL DEFAULT '',
  sale_amount_minor bigint,
  discount_amount_minor bigint NOT NULL DEFAULT 0,
  gst_rate_bp integer NOT NULL DEFAULT 0,
  gst_amount_minor bigint NOT NULL DEFAULT 0,
  refund_amount_minor bigint NOT NULL DEFAULT 0,
  eligible_revenue_minor bigint,
  commission_basis text NOT NULL DEFAULT 'NET_SALES_EX_GST',
  commission_rate_bp integer,
  calculated_commission_minor bigint,
  commission_status text NOT NULL DEFAULT 'PENDING' CHECK (commission_status IN ('PENDING','VERIFIED','APPROVED','PAID','REVERSED','DISPUTED')),
  is_revenue_verified boolean NOT NULL DEFAULT false,
  revenue_source text NOT NULL DEFAULT 'IMPORTED',
  snapshot jsonb,
  created_by uuid NOT NULL REFERENCES inv.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS influencer_sales_records_influencer_idx ON inv.influencer_sales_records (influencer_id);
CREATE INDEX IF NOT EXISTS influencer_sales_records_batch_idx ON inv.influencer_sales_records (batch_id);
CREATE INDEX IF NOT EXISTS influencer_sales_records_purchased_idx ON inv.influencer_sales_records (purchased_date);
CREATE INDEX IF NOT EXISTS influencer_sales_records_status_idx ON inv.influencer_sales_records (commission_status);
CREATE INDEX IF NOT EXISTS influencer_sales_records_customer_idx ON inv.influencer_sales_records (lower(customer_name), purchased_date, lower(product_name));
