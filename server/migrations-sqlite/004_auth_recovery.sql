/*
 * SQLite port of server/migrations/004_auth_recovery.sql for the desktop app.
 * Adds account recovery key support to business settings.
 */
ALTER TABLE inv_business_settings ADD COLUMN recovery_key_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS users_email_active_idx ON inv_users (email) WHERE disabled = 0;
