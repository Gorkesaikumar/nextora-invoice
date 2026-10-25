/*
 * SQLite port of server/migrations/005_business_data_cleanup.sql for the desktop app.
 * Adds inv_cleanup_context table and adjusts deletion guard triggers to permit
 * verified administrative cleanup while preserving daily immutability for all other operations.
 */

CREATE TABLE IF NOT EXISTS inv_cleanup_context (
  active INTEGER PRIMARY KEY DEFAULT 1
);

DROP TRIGGER IF EXISTS quotation_history_delete;
CREATE TRIGGER quotation_history_delete BEFORE DELETE ON inv_quotations FOR EACH ROW
WHEN OLD.quotation_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inv_cleanup_context)
BEGIN SELECT RAISE(ABORT, 'Issued quotations cannot be deleted'); END;

DROP TRIGGER IF EXISTS quotation_items_guard_delete;
CREATE TRIGGER quotation_items_guard_delete BEFORE DELETE ON inv_quotation_items FOR EACH ROW
WHEN (EXISTS (SELECT 1 FROM inv_quotations WHERE id = OLD.quotation_id
  AND (snapshot IS NOT NULL OR status <> 'DRAFT')))
  AND NOT EXISTS (SELECT 1 FROM inv_cleanup_context)
BEGIN SELECT RAISE(ABORT, 'Line items of an issued quotation are immutable'); END;

DROP TRIGGER IF EXISTS invoice_history_delete;
CREATE TRIGGER invoice_history_delete BEFORE DELETE ON inv_invoices FOR EACH ROW
WHEN OLD.invoice_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inv_cleanup_context)
BEGIN SELECT RAISE(ABORT, 'Issued invoices cannot be deleted'); END;

DROP TRIGGER IF EXISTS invoice_items_guard_delete;
CREATE TRIGGER invoice_items_guard_delete BEFORE DELETE ON inv_invoice_items FOR EACH ROW
WHEN (EXISTS (SELECT 1 FROM inv_invoices WHERE id = OLD.invoice_id
  AND (snapshot IS NOT NULL OR status <> 'DRAFT')))
  AND NOT EXISTS (SELECT 1 FROM inv_cleanup_context)
BEGIN SELECT RAISE(ABORT, 'Line items of an issued invoice are immutable'); END;
