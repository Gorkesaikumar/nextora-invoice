ALTER TABLE inv_business_settings
  ADD COLUMN product_price_tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (product_price_tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv_quotations
  ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv_invoices
  ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv_quotation_items
  ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv_invoice_items
  ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv_products
  ADD COLUMN tax_mode TEXT
  CHECK (tax_mode IS NULL OR tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv_adjustment_notes
  ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));

ALTER TABLE inv_adjustment_note_items
  ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'
  CHECK (tax_mode IN ('INCLUSIVE','EXCLUSIVE'));
