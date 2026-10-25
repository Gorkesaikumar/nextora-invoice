/*
 * SQLite port of server/migrations/002_pos_customers.sql for the desktop app.
 * Same porting rules as 001 (see its header). Notes for this file:
 *   text[] editor_roles  -> TEXT holding a JSON array, DEFAULT
 *     '["OWNER","ADMIN"]', with the PG `<@` subset check expressed as
 *     subset_of(editor_roles, '[...]') - a function server/db.js registers;
 *   jsonb_typeof()      -> json_type();
 *   COMMENT ON          -> dropped (SQLite has no column comments); the
 *     documentation lives in docs/desktop-data.md instead.
 */

/* ----------------------------------------------------------------- employees */

CREATE TABLE inv_pos_employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT NOT NULL DEFAULT '',
  user_id TEXT REFERENCES inv_users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id)
);
CREATE UNIQUE INDEX pos_employees_user_idx ON inv_pos_employees (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX pos_employees_status_idx ON inv_pos_employees (status, lower(name));

/* ------------------------------------------------- subscription plan options */

/*
 * Plans are rows, not code: duration and pricing stay the owner's decision, and
 * a new plan never needs a migration.
 */
CREATE TABLE inv_pos_subscription_plans (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  duration_months INTEGER NOT NULL DEFAULT 12 CHECK (duration_months BETWEEN 0 AND 600),
  is_lifetime BOOLEAN NOT NULL DEFAULT 0 CHECK (is_lifetime IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  notes TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  CHECK (is_lifetime = (duration_months = 0))
);
CREATE UNIQUE INDEX pos_plans_label_idx ON inv_pos_subscription_plans (lower(label));

/* ----------------------------------------------------------------- customers */

CREATE TABLE inv_pos_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  business_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  employee_id TEXT REFERENCES inv_pos_employees(id),
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  client_id TEXT REFERENCES inv_clients(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id)
);
CREATE INDEX pos_customers_name_idx ON inv_pos_customers (lower(name));
CREATE INDEX pos_customers_business_idx ON inv_pos_customers (lower(business_name));
CREATE INDEX pos_customers_status_idx ON inv_pos_customers (status, created_at DESC);
CREATE INDEX pos_customers_employee_idx ON inv_pos_customers (employee_id);

CREATE TABLE inv_pos_subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES inv_pos_customers(id),
  product_id TEXT REFERENCES inv_products(id),
  plan_id TEXT REFERENCES inv_pos_subscription_plans(id),
  plan_label TEXT NOT NULL DEFAULT '',
  purchase_date DATE NOT NULL,
  start_date DATE NOT NULL,
  expiry_date DATE,
  is_lifetime BOOLEAN NOT NULL DEFAULT 0 CHECK (is_lifetime IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED','TRIAL')),
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  transaction_reference TEXT NOT NULL DEFAULT '',
  invoice_id TEXT REFERENCES inv_invoices(id),
  notes TEXT NOT NULL DEFAULT '',
  renewed_from TEXT REFERENCES inv_pos_subscriptions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  /* A lifetime plan has no expiry; a dated plan must state one. An expiry that
     precedes the purchase date is a data-entry warning, not a database error,
     so the service reports it instead of refusing the row. */
  CHECK (is_lifetime = (expiry_date IS NULL))
);
CREATE INDEX pos_subscriptions_customer_idx ON inv_pos_subscriptions (customer_id, purchase_date DESC);
CREATE INDEX pos_subscriptions_expiry_idx ON inv_pos_subscriptions (expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX pos_subscriptions_product_idx ON inv_pos_subscriptions (product_id);

/* -------------------------------------------------------------- custom fields */

/*
 * One row per definition and one row per value: adding a spreadsheet column is
 * data, never a schema change, and existing customers stay valid because a
 * missing value row simply means "empty".
 */
CREATE TABLE inv_custom_field_definitions (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL DEFAULT 'POS_CUSTOMER' CHECK (entity = 'POS_CUSTOMER'),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  field_type TEXT NOT NULL CHECK (field_type IN ('TEXT','LONG_TEXT','NUMBER','CURRENCY','DATE','DROPDOWN',
    'MULTI_SELECT','CHECKBOX','URL','EMAIL','PHONE')),
  description TEXT NOT NULL DEFAULT '',
  required BOOLEAN NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  options JSONB NOT NULL DEFAULT '[]' CHECK (json_valid(options)),
  default_value TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  visible BOOLEAN NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  width INTEGER NOT NULL DEFAULT 160 CHECK (width BETWEEN 80 AND 600),
  editor_roles TEXT NOT NULL DEFAULT '["OWNER","ADMIN"]',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  CHECK (field_type <> 'DROPDOWN' AND field_type <> 'MULTI_SELECT' OR json_type(options) = 'array'),
  CHECK (subset_of(editor_roles, '["OWNER","ADMIN","FINANCE","ACCOUNTANT"]'))
);
CREATE UNIQUE INDEX custom_field_label_idx ON inv_custom_field_definitions (entity, lower(label));
CREATE INDEX custom_field_position_idx ON inv_custom_field_definitions (status, position);

CREATE TABLE inv_custom_field_values (
  definition_id TEXT NOT NULL REFERENCES inv_custom_field_definitions(id),
  customer_id TEXT NOT NULL REFERENCES inv_pos_customers(id),
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES inv_users(id),
  PRIMARY KEY (definition_id, customer_id)
);
CREATE INDEX custom_field_values_customer_idx ON inv_custom_field_values (customer_id);

/* ------------------------------------------------------------ share settings */

/*
 * A share always names its own scope. Private shares are read-only and are
 * granted to identified people; public shares are disabled until the owner
 * explicitly creates one, carry only the columns listed here, and store a hash
 * of the token rather than the token itself.
 */
CREATE TABLE inv_pos_shares (
  id TEXT PRIMARY KEY,
  share_type TEXT NOT NULL CHECK (share_type IN ('PRIVATE','PUBLIC')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  owner_id TEXT NOT NULL REFERENCES inv_users(id),
  scope_all BOOLEAN NOT NULL DEFAULT 0 CHECK (scope_all IN (0,1)),
  filter JSONB NOT NULL DEFAULT '{}' CHECK (json_valid(filter)),
  columns JSONB NOT NULL DEFAULT '[]' CHECK (json_valid(columns)),
  allow_search BOOLEAN NOT NULL DEFAULT 1 CHECK (allow_search IN (0,1)),
  allow_filter BOOLEAN NOT NULL DEFAULT 1 CHECK (allow_filter IN (0,1)),
  allow_download BOOLEAN NOT NULL DEFAULT 0 CHECK (allow_download IN (0,1)),
  password_hash TEXT,
  token_hash TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL REFERENCES inv_users(id),
  CHECK (share_type = 'PUBLIC' OR token_hash IS NULL),
  CHECK (share_type = 'PUBLIC' OR password_hash IS NULL),
  CHECK (json_type(columns) = 'array'),
  CHECK (json_type(filter) = 'object')
);
CREATE UNIQUE INDEX pos_shares_token_idx ON inv_pos_shares (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX pos_shares_owner_idx ON inv_pos_shares (share_type, created_at DESC);

CREATE TABLE inv_pos_share_recipients (
  share_id TEXT NOT NULL REFERENCES inv_pos_shares(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES inv_users(id),
  email TEXT NOT NULL CHECK (length(trim(email)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (share_id, email)
);
CREATE INDEX pos_share_recipients_user_idx ON inv_pos_share_recipients (user_id);

CREATE TABLE inv_pos_share_customers (
  share_id TEXT NOT NULL REFERENCES inv_pos_shares(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES inv_pos_customers(id),
  PRIMARY KEY (share_id, customer_id)
);

CREATE TABLE inv_pos_share_access (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES inv_pos_shares(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('VIEWED','DENIED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pos_share_access_idx ON inv_pos_share_access (share_id, created_at DESC);

/* A share token is a bearer credential: the audit trail and access log are append-only. */
CREATE TRIGGER pos_share_access_append_only_update BEFORE UPDATE ON inv_pos_share_access FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
CREATE TRIGGER pos_share_access_append_only_delete BEFORE DELETE ON inv_pos_share_access FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Historical record is immutable'); END;
