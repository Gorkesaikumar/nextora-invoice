/*
 * SQLite port of server/migrations/008_influencer_sales_tracking.sql for the desktop app.
 * Influencer-wise sales tracking, excel import, revenue calculation & reporting:
 * - inv_influencer_sales_batches for import auditing, deduplication, and file tracking
 * - inv_influencer_sales_records for customer sales segregation, revenue attribution,
 *   commission calculation snapshots, and settlement status tracking
 */

CREATE TABLE IF NOT EXISTS inv_influencer_sales_batches (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_row_count INTEGER NOT NULL DEFAULT 0,
  invalid_row_count INTEGER NOT NULL DEFAULT 0,
  duplicate_row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PREVIEW','COMPLETED','FAILED','REVERTED')),
  notes TEXT NOT NULL DEFAULT '',
  imported_by TEXT NOT NULL REFERENCES inv_users(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS influencer_sales_batches_imported_at_idx ON inv_influencer_sales_batches (imported_at DESC);
CREATE INDEX IF NOT EXISTS influencer_sales_batches_sha_idx ON inv_influencer_sales_batches (file_sha256);

CREATE TABLE IF NOT EXISTS inv_influencer_sales_records (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES inv_influencer_sales_batches(id),
  serial_number INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0),
  business_name TEXT NOT NULL DEFAULT '',
  purchased_date TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  is_lifetime INTEGER NOT NULL DEFAULT 0 CHECK (is_lifetime IN (0,1)),
  customer_location TEXT NOT NULL DEFAULT '',
  raw_influencer_name TEXT NOT NULL DEFAULT '',
  influencer_id TEXT REFERENCES inv_influencers(id),
  agreement_id TEXT REFERENCES inv_influencer_agreements(id),
  order_reference TEXT NOT NULL DEFAULT '',
  sale_amount_minor INTEGER,
  discount_amount_minor INTEGER NOT NULL DEFAULT 0,
  gst_rate_bp INTEGER NOT NULL DEFAULT 0,
  gst_amount_minor INTEGER NOT NULL DEFAULT 0,
  refund_amount_minor INTEGER NOT NULL DEFAULT 0,
  eligible_revenue_minor INTEGER,
  commission_basis TEXT NOT NULL DEFAULT 'NET_SALES_EX_GST',
  commission_rate_bp INTEGER,
  calculated_commission_minor INTEGER,
  commission_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (commission_status IN ('PENDING','VERIFIED','APPROVED','PAID','REVERSED','DISPUTED')),
  is_revenue_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_revenue_verified IN (0,1)),
  revenue_source TEXT NOT NULL DEFAULT 'IMPORTED',
  snapshot TEXT,
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS influencer_sales_records_influencer_idx ON inv_influencer_sales_records (influencer_id);
CREATE INDEX IF NOT EXISTS influencer_sales_records_batch_idx ON inv_influencer_sales_records (batch_id);
CREATE INDEX IF NOT EXISTS influencer_sales_records_purchased_idx ON inv_influencer_sales_records (purchased_date);
CREATE INDEX IF NOT EXISTS influencer_sales_records_status_idx ON inv_influencer_sales_records (commission_status);
CREATE INDEX IF NOT EXISTS influencer_sales_records_customer_idx ON inv_influencer_sales_records (lower(customer_name), purchased_date, lower(product_name));
