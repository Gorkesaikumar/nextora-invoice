/*
 * Nextora POS customer tracker.
 *
 * Customers are tracked separately from inv.clients, which is the billing party
 * on a document: a POS customer may not be invoiced yet, and an invoiced client
 * may never buy POS. A customer therefore links to a billing client when one
 * exists instead of duplicating the invoice model, and products are reused from
 * inv.products rather than repeated here.
 *
 * A customer owns many subscriptions, so renewals and upgrades keep their
 * history instead of overwriting the previous purchase.
 */

/* ----------------------------------------------------------------- employees */

CREATE TABLE inv.pos_employees (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  email text NOT NULL DEFAULT '',
  user_id uuid REFERENCES inv.users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id)
);
CREATE UNIQUE INDEX pos_employees_user_idx ON inv.pos_employees (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX pos_employees_status_idx ON inv.pos_employees (status, lower(name));

/* ------------------------------------------------- subscription plan options */

/*
 * Plans are rows, not code: duration and pricing stay the owner's decision, and
 * a new plan never needs a migration.
 */
CREATE TABLE inv.pos_subscription_plans (
  id uuid PRIMARY KEY,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  duration_months integer NOT NULL DEFAULT 12 CHECK (duration_months BETWEEN 0 AND 600),
  is_lifetime boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  notes text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  CHECK (is_lifetime = (duration_months = 0))
);
CREATE UNIQUE INDEX pos_plans_label_idx ON inv.pos_subscription_plans (lower(label));

/* ----------------------------------------------------------------- customers */

CREATE TABLE inv.pos_customers (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  business_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  employee_id uuid REFERENCES inv.pos_employees(id),
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  remarks text NOT NULL DEFAULT '',
  client_id uuid REFERENCES inv.clients(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id)
);
CREATE INDEX pos_customers_name_idx ON inv.pos_customers (lower(name));
CREATE INDEX pos_customers_business_idx ON inv.pos_customers (lower(business_name));
CREATE INDEX pos_customers_status_idx ON inv.pos_customers (status, created_at DESC);
CREATE INDEX pos_customers_employee_idx ON inv.pos_customers (employee_id);

CREATE TABLE inv.pos_subscriptions (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES inv.pos_customers(id),
  product_id uuid REFERENCES inv.products(id),
  plan_id uuid REFERENCES inv.pos_subscription_plans(id),
  plan_label text NOT NULL DEFAULT '',
  purchase_date date NOT NULL,
  start_date date NOT NULL,
  expiry_date date,
  is_lifetime boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED','TRIAL')),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  transaction_reference text NOT NULL DEFAULT '',
  invoice_id uuid REFERENCES inv.invoices(id),
  notes text NOT NULL DEFAULT '',
  renewed_from uuid REFERENCES inv.pos_subscriptions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  /* A lifetime plan has no expiry; a dated plan must state one. An expiry that
     precedes the purchase date is a data-entry warning, not a database error,
     so the service reports it instead of refusing the row. */
  CHECK (is_lifetime = (expiry_date IS NULL))
);
CREATE INDEX pos_subscriptions_customer_idx ON inv.pos_subscriptions (customer_id, purchase_date DESC);
CREATE INDEX pos_subscriptions_expiry_idx ON inv.pos_subscriptions (expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX pos_subscriptions_product_idx ON inv.pos_subscriptions (product_id);

/* -------------------------------------------------------------- custom fields */

/*
 * One row per definition and one row per value: adding a spreadsheet column is
 * data, never a schema change, and existing customers stay valid because a
 * missing value row simply means "empty".
 */
CREATE TABLE inv.custom_field_definitions (
  id uuid PRIMARY KEY,
  entity text NOT NULL DEFAULT 'POS_CUSTOMER' CHECK (entity = 'POS_CUSTOMER'),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  field_type text NOT NULL CHECK (field_type IN ('TEXT','LONG_TEXT','NUMBER','CURRENCY','DATE','DROPDOWN',
    'MULTI_SELECT','CHECKBOX','URL','EMAIL','PHONE')),
  description text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_value text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  width integer NOT NULL DEFAULT 160 CHECK (width BETWEEN 80 AND 600),
  editor_roles text[] NOT NULL DEFAULT ARRAY['OWNER','ADMIN']::text[],
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  CHECK (field_type <> 'DROPDOWN' AND field_type <> 'MULTI_SELECT' OR jsonb_typeof(options) = 'array'),
  CHECK (editor_roles <@ ARRAY['OWNER','ADMIN','FINANCE','ACCOUNTANT']::text[])
);
CREATE UNIQUE INDEX custom_field_label_idx ON inv.custom_field_definitions (entity, lower(label));
CREATE INDEX custom_field_position_idx ON inv.custom_field_definitions (status, position);

CREATE TABLE inv.custom_field_values (
  definition_id uuid NOT NULL REFERENCES inv.custom_field_definitions(id),
  customer_id uuid NOT NULL REFERENCES inv.pos_customers(id),
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES inv.users(id),
  PRIMARY KEY (definition_id, customer_id)
);
CREATE INDEX custom_field_values_customer_idx ON inv.custom_field_values (customer_id);

/* ------------------------------------------------------------ share settings */

/*
 * A share always names its own scope. Private shares are read-only and are
 * granted to identified people; public shares are disabled until the owner
 * explicitly creates one, carry only the columns listed here, and store a hash
 * of the token rather than the token itself.
 */
CREATE TABLE inv.pos_shares (
  id uuid PRIMARY KEY,
  share_type text NOT NULL CHECK (share_type IN ('PRIVATE','PUBLIC')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  owner_id uuid NOT NULL REFERENCES inv.users(id),
  scope_all boolean NOT NULL DEFAULT false,
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_search boolean NOT NULL DEFAULT true,
  allow_filter boolean NOT NULL DEFAULT true,
  allow_download boolean NOT NULL DEFAULT false,
  password_hash text,
  token_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES inv.users(id),
  CHECK (share_type = 'PUBLIC' OR token_hash IS NULL),
  CHECK (share_type = 'PUBLIC' OR password_hash IS NULL),
  CHECK (jsonb_typeof(columns) = 'array'),
  CHECK (jsonb_typeof(filter) = 'object')
);
CREATE UNIQUE INDEX pos_shares_token_idx ON inv.pos_shares (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX pos_shares_owner_idx ON inv.pos_shares (share_type, created_at DESC);

CREATE TABLE inv.pos_share_recipients (
  share_id uuid NOT NULL REFERENCES inv.pos_shares(id) ON DELETE CASCADE,
  user_id uuid REFERENCES inv.users(id),
  email text NOT NULL CHECK (length(btrim(email)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (share_id, email)
);
CREATE INDEX pos_share_recipients_user_idx ON inv.pos_share_recipients (user_id);

CREATE TABLE inv.pos_share_customers (
  share_id uuid NOT NULL REFERENCES inv.pos_shares(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES inv.pos_customers(id),
  PRIMARY KEY (share_id, customer_id)
);

CREATE TABLE inv.pos_share_access (
  id uuid PRIMARY KEY,
  share_id uuid NOT NULL REFERENCES inv.pos_shares(id) ON DELETE CASCADE,
  recipient_email text NOT NULL DEFAULT '',
  ip_hash text NOT NULL DEFAULT '',
  outcome text NOT NULL CHECK (outcome IN ('VIEWED','DENIED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_share_access_idx ON inv.pos_share_access (share_id, created_at DESC);

/* A share token is a bearer credential: the audit trail and access log are append-only. */
CREATE TRIGGER pos_share_access_append_only BEFORE UPDATE OR DELETE ON inv.pos_share_access
  FOR EACH ROW EXECUTE FUNCTION inv.reject_mutation();

/* Archiving keeps the customer's history; a hard delete is not offered in the UI. */
COMMENT ON TABLE inv.pos_customers IS 'POS customers; archive rather than delete so subscriptions keep their history.';
COMMENT ON COLUMN inv.pos_shares.token_hash IS 'SHA-256 of the public link token; the token itself is never stored.';
