/*
 * Adds account recovery key support to business settings.
 * The recovery key hash allows authorized account password resets
 * without relying on an external SMTP email server in local environments.
 */
ALTER TABLE inv.business_settings ADD COLUMN IF NOT EXISTS recovery_key_hash text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS users_email_active_idx ON inv.users (email) WHERE NOT disabled;
