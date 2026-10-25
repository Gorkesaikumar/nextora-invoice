/*
 * 005_business_data_cleanup.sql
 * Adds cleanup_context table and adjusts deletion guard triggers to permit
 * verified administrative cleanup while preserving daily immutability for all other operations.
 */

CREATE TABLE IF NOT EXISTS inv.cleanup_context (
  active boolean PRIMARY KEY DEFAULT true
);

CREATE OR REPLACE FUNCTION inv.guard_quotation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.quotation_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inv.cleanup_context) THEN
      RAISE EXCEPTION 'Issued quotations cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.snapshot IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['status','accepted_at','rejected_at','rejection_reason','cancelled_at','cancellation_reason','converted_invoice_id','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','accepted_at','rejected_at','rejection_reason','cancelled_at','cancellation_reason','converted_invoice_id','updated_at'])
    THEN RAISE EXCEPTION 'Issued quotation terms are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inv.guard_quotation_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; issued boolean;
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM inv.cleanup_context) THEN
    RETURN OLD;
  END IF;
  parent_id := COALESCE(NEW.quotation_id, OLD.quotation_id);
  SELECT snapshot IS NOT NULL OR status <> 'DRAFT' INTO issued FROM inv.quotations WHERE id = parent_id;
  IF issued THEN RAISE EXCEPTION 'Line items of an issued quotation are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION inv.guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inv.cleanup_context) THEN
      RAISE EXCEPTION 'Issued invoices cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.snapshot IS NOT NULL THEN
    IF (to_jsonb(NEW) - ARRAY['status','cancelled_at','cancellation_reason','voided_at','void_reason','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','cancelled_at','cancellation_reason','voided_at','void_reason','updated_at'])
    THEN RAISE EXCEPTION 'Issued invoice values are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inv.guard_invoice_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; issued boolean;
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM inv.cleanup_context) THEN
    RETURN OLD;
  END IF;
  parent_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT snapshot IS NOT NULL OR status <> 'DRAFT' INTO issued FROM inv.invoices WHERE id = parent_id;
  IF issued THEN RAISE EXCEPTION 'Line items of an issued invoice are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
