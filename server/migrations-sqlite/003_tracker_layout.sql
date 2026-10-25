/*
 * SQLite port of server/migrations/003_tracker_layout.sql for the desktop app.
 * The spreadsheet remembers how the owner arranged it: position, width and
 * visibility per column. Only the presentation lives here - labels and types
 * stay in code for default columns, so a stored row can never rename a system
 * column or reinterpret its values.
 */
CREATE TABLE inv_pos_column_layout (
  key TEXT PRIMARY KEY CHECK (key REGEXP '^[a-z_]+$'),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  visible BOOLEAN NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  width INTEGER NOT NULL DEFAULT 160 CHECK (width BETWEEN 80 AND 600),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES inv_users(id)
);
CREATE INDEX pos_column_layout_position_idx ON inv_pos_column_layout (position);
