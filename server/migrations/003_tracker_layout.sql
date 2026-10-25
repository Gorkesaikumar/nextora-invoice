/*
 * The spreadsheet remembers how the owner arranged it: position, width and
 * visibility per column. Only the presentation lives here - labels and types
 * stay in code for default columns, so a stored row can never rename a system
 * column or reinterpret its values.
 */
CREATE TABLE inv.pos_column_layout (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  visible boolean NOT NULL DEFAULT true,
  width integer NOT NULL DEFAULT 160 CHECK (width BETWEEN 80 AND 600),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES inv.users(id)
);
CREATE INDEX pos_column_layout_position_idx ON inv.pos_column_layout (position);
