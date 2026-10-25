-- Migration 010: Contract Branding Modes and Safe Deletion/Archival Statuses
-- Add branding_mode column to inv.influencer_agreements and inv.software_agreements
-- Update status constraints to support ARCHIVED and CANCELLED

ALTER TABLE inv.influencer_agreements
  ADD COLUMN IF NOT EXISTS branding_mode text NOT NULL DEFAULT 'BOTH'
  CHECK (branding_mode IN ('BOTH', 'COMPANY_ONLY', 'PRODUCT_ONLY', 'TEXT_ONLY'));

ALTER TABLE inv.influencer_agreements DROP CONSTRAINT IF EXISTS influencer_agreements_status_check;
ALTER TABLE inv.influencer_agreements ADD CONSTRAINT influencer_agreements_status_check
  CHECK (status IN ('DRAFT','PENDING_APPROVAL','SENT','ACCEPTED','SIGNED','ACTIVE','EXPIRED','TERMINATED','ARCHIVED','CANCELLED'));

ALTER TABLE inv.software_agreements
  ADD COLUMN IF NOT EXISTS branding_mode text NOT NULL DEFAULT 'COMPANY_ONLY'
  CHECK (branding_mode IN ('BOTH', 'COMPANY_ONLY', 'PRODUCT_ONLY', 'TEXT_ONLY'));

ALTER TABLE inv.software_agreements DROP CONSTRAINT IF EXISTS software_agreements_status_check;
ALTER TABLE inv.software_agreements ADD CONSTRAINT software_agreements_status_check
  CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','ACCEPTED','SIGNED','ACTIVE','COMPLETED','TERMINATED','CANCELLED','ARCHIVED'));
