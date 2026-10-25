ALTER TABLE inv.business_settings
  ADD COLUMN product_price_tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (product_price_tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv.quotations
  ADD COLUMN tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv.invoices
  ADD COLUMN tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv.quotation_items
  ADD COLUMN tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv.invoice_items
  ADD COLUMN tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv.products
  ADD COLUMN tax_mode text
  CHECK (tax_mode IS NULL OR tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv.adjustment_notes
  ADD COLUMN tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv.adjustment_note_items
  ADD COLUMN tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));
