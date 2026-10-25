import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { assert, HttpError } from './domain.js';
import { audit } from './audit.js';
import { requireManager, settings } from './service.js';
import { createBackup } from './backup.js';
import {
  getInvoice, getQuotation, invoiceSnapshotForRender, quotationSnapshotForRender,
} from './documents.js';
import { renderDocument } from './pdf.js';
import { toCsv } from './reports.js';
import { sanitizeCell } from './excel.js';

const CONFIRMATION_PHRASES = {
  QUOTATIONS: 'DELETE QUOTATIONS',
  INVOICES: 'DELETE INVOICES',
};

const sha256File = filePath => {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
};

const sha256String = str => createHash('sha256').update(str).digest('hex');

// In-memory verification token cache (maps verificationToken -> verificationManifest)
// Tokens expire after 60 minutes.
const activeTokens = new Map();

function storeVerificationToken(manifest) {
  const token = randomBytes(24).toString('hex');
  activeTokens.set(token, {
    manifest,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  // Clean up expired tokens
  for (const [key, item] of activeTokens.entries()) {
    if (Date.now() > item.expiresAt) activeTokens.delete(key);
  }
  return token;
}

function retrieveVerificationToken(token) {
  const item = activeTokens.get(token);
  if (!item) {
    throw new HttpError(400, 'Export verification token has expired or is invalid. Please re-run the export and verification.',
      'INVALID_VERIFICATION_TOKEN');
  }
  if (Date.now() > item.expiresAt) {
    activeTokens.delete(token);
    throw new HttpError(400, 'Export verification token has expired. Please re-run the export.', 'EXPIRED_VERIFICATION_TOKEN');
  }
  return item.manifest;
}

export function resolveSafeExportDir(category, stamp, customDir = null) {
  if (customDir) {
    try {
      mkdirSync(customDir, { recursive: true });
      return customDir;
    } catch { /* try safe locations */ }
  }

  const subfolder = `cleanup-${category.toLowerCase()}-${stamp}`;

  // 1. process.env.EXPORTS_DIR
  if (process.env.EXPORTS_DIR) {
    try {
      const p = join(process.env.EXPORTS_DIR, subfolder);
      mkdirSync(p, { recursive: true });
      return p;
    } catch { /* fallback */ }
  }

  // 2. userData relative to DATABASE_PATH
  if (process.env.DATABASE_PATH && process.env.DATABASE_PATH !== ':memory:') {
    try {
      const p = join(dirname(process.env.DATABASE_PATH), 'exports', subfolder);
      mkdirSync(p, { recursive: true });
      return p;
    } catch { /* fallback */ }
  }

  // 3. APPDATA / HOME
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? join(process.env.HOME || '', 'Library', 'Application Support') : join(process.env.HOME || '', '.config'));
  if (appData) {
    try {
      const p = join(appData, 'nextora-invoicing', 'exports', subfolder);
      mkdirSync(p, { recursive: true });
      return p;
    } catch { /* fallback */ }
  }

  // 4. cwd data/exports
  try {
    const p = resolve(process.cwd(), 'data', 'exports', subfolder);
    mkdirSync(p, { recursive: true });
    return p;
  } catch { /* fallback */ }

  // 5. OS tempdir
  const tmpPath = join(tmpdir(), 'nextora-invoicing', 'exports', subfolder);
  mkdirSync(tmpPath, { recursive: true });
  return tmpPath;
}

export function resolveSafeBackupDir(customDir = null) {
  if (customDir) {
    try {
      mkdirSync(customDir, { recursive: true });
      return customDir;
    } catch { /* fallback */ }
  }
  if (process.env.BACKUPS_DIR) {
    try {
      mkdirSync(process.env.BACKUPS_DIR, { recursive: true });
      return process.env.BACKUPS_DIR;
    } catch { /* fallback */ }
  }
  if (process.env.DATABASE_PATH && process.env.DATABASE_PATH !== ':memory:') {
    try {
      const p = join(dirname(process.env.DATABASE_PATH), 'backups');
      mkdirSync(p, { recursive: true });
      return p;
    } catch { /* fallback */ }
  }
  const appData = process.env.APPDATA;
  if (appData) {
    try {
      const p = join(appData, 'nextora-invoicing', 'backups');
      mkdirSync(p, { recursive: true });
      return p;
    } catch { /* fallback */ }
  }
  try {
    const p = resolve(process.cwd(), 'data', 'backups');
    mkdirSync(p, { recursive: true });
    return p;
  } catch { /* fallback */ }
  const tmpPath = join(tmpdir(), 'nextora-invoicing', 'backups');
  mkdirSync(tmpPath, { recursive: true });
  return tmpPath;
}

/**
 * Inspects the current database and returns counts, statuses, date ranges,
 * and eligibility breakdowns for both Quotations and Invoices.
 */
export async function inspectCleanupData(db) {
  // 1. Quotations inspection
  const quotationCountsRow = (await db.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
      count(*) FILTER (WHERE status = 'SENT')::int AS issued,
      count(*) FILTER (WHERE status = 'ACCEPTED')::int AS accepted,
      count(*) FILTER (WHERE status IN ('REJECTED', 'EXPIRED', 'CANCELLED'))::int AS rejected_or_expired,
      min(issue_date) AS earliest_date,
      max(issue_date) AS latest_date
    FROM inv.quotations
  `)).rows[0];

  // Eligible quotations: NOT linked to an invoice (converted_invoice_id IS NULL AND not referenced in inv.invoices)
  const quotationEligibilityRow = (await db.query(`
    SELECT
      count(*)::int AS eligible_count,
      (SELECT count(*)::int FROM inv.quotations WHERE converted_invoice_id IS NOT NULL
        OR id IN (SELECT quotation_id FROM inv.invoices WHERE quotation_id IS NOT NULL)) AS blocked_count
    FROM inv.quotations q
    WHERE q.converted_invoice_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM inv.invoices i WHERE i.quotation_id = q.id)
  `)).rows[0];

  // Affected quotation items and milestones for eligible quotations
  const quotationItemsRow = (await db.query(`
    SELECT
      count(*)::int AS affected_items,
      (SELECT count(*)::int FROM inv.quotation_milestones m
       WHERE m.quotation_id IN (
         SELECT q.id FROM inv.quotations q
         WHERE q.converted_invoice_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM inv.invoices i WHERE i.quotation_id = q.id)
       )) AS affected_milestones
    FROM inv.quotation_items qi
    WHERE qi.quotation_id IN (
      SELECT q.id FROM inv.quotations q
      WHERE q.converted_invoice_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM inv.invoices i WHERE i.quotation_id = q.id)
    )
  `)).rows[0];

  // 2. Invoices inspection
  const invoiceCountsRow = (await db.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
      count(*) FILTER (WHERE status = 'ISSUED')::int AS issued,
      count(*) FILTER (WHERE status IN ('CANCELLED', 'VOID'))::int AS cancelled_or_void,
      min(issue_date) AS earliest_date,
      max(issue_date) AS latest_date
    FROM inv.invoices
  `)).rows[0];

  // Payment statuses for invoices
  const invoicePaymentBreakdown = (await db.query(`
    WITH invoice_payments AS (
      SELECT
        i.id,
        i.status,
        (i.totals->>'grand_total_minor')::bigint AS grand_total_minor,
        COALESCE(sum(p.amount_minor), 0)::bigint AS paid_minor
      FROM inv.invoices i
      LEFT JOIN inv.payments p ON p.invoice_id = i.id
      GROUP BY i.id, i.status, i.totals
    )
    SELECT
      count(*) FILTER (WHERE status = 'ISSUED' AND paid_minor >= grand_total_minor)::int AS paid,
      count(*) FILTER (WHERE status = 'ISSUED' AND paid_minor > 0 AND paid_minor < grand_total_minor)::int AS partially_paid,
      count(*) FILTER (WHERE status = 'ISSUED' AND paid_minor = 0)::int AS unpaid
    FROM invoice_payments
  `)).rows[0];

  // Invoices eligibility breakdown
  const invoiceEligibilityRow = (await db.query(`
    SELECT
      count(*) FILTER (WHERE
        NOT EXISTS (SELECT 1 FROM inv.payments p WHERE p.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM inv.adjustment_notes n WHERE n.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM inv.pos_subscriptions s WHERE s.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM inv.quotations q WHERE q.converted_invoice_id = i.id)
      )::int AS eligible_count,
      count(*) FILTER (WHERE
        EXISTS (SELECT 1 FROM inv.payments p WHERE p.invoice_id = i.id)
        OR EXISTS (SELECT 1 FROM inv.adjustment_notes n WHERE n.invoice_id = i.id)
        OR EXISTS (SELECT 1 FROM inv.pos_subscriptions s WHERE s.invoice_id = i.id)
        OR EXISTS (SELECT 1 FROM inv.quotations q WHERE q.converted_invoice_id = i.id)
      )::int AS blocked_count,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM inv.payments p WHERE p.invoice_id = i.id))::int AS blocked_with_payments,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM inv.adjustment_notes n WHERE n.invoice_id = i.id))::int AS blocked_with_credit_notes,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM inv.pos_subscriptions s WHERE s.invoice_id = i.id))::int AS blocked_with_subscriptions,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM inv.quotations q WHERE q.converted_invoice_id = i.id))::int AS blocked_with_quotations
    FROM inv.invoices i
  `)).rows[0];

  const invoiceItemsRow = (await db.query(`
    SELECT count(*)::int AS affected_items
    FROM inv.invoice_items ii
    WHERE ii.invoice_id IN (
      SELECT i.id FROM inv.invoices i
      WHERE NOT EXISTS (SELECT 1 FROM inv.payments p WHERE p.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM inv.adjustment_notes n WHERE n.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM inv.pos_subscriptions s WHERE s.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM inv.quotations q WHERE q.converted_invoice_id = i.id)
    )
  `)).rows[0];

  // Storage info
  let sizeBytes = 0;
  let walBytes = 0;
  if (db.driver === 'sqlite' && db.file && db.file !== ':memory:' && existsSync(db.file)) {
    sizeBytes = statSync(db.file).size;
    if (existsSync(`${db.file}-wal`)) walBytes = statSync(`${db.file}-wal`).size;
  }

  // Storage estimation: average quotation ~ 3500 bytes, average invoice ~ 4500 bytes
  const quotationEstReclaim = Number(quotationEligibilityRow.eligible_count || 0) * 3500;
  const invoiceEstReclaim = Number(invoiceEligibilityRow.eligible_count || 0) * 4500;

  return {
    storage: {
      driver: db.driver,
      file: db.driver === 'sqlite' ? db.file : null,
      size_bytes: sizeBytes,
      wal_bytes: walBytes,
      total_bytes: sizeBytes + walBytes,
    },
    quotations: {
      total: Number(quotationCountsRow.total || 0),
      draft: Number(quotationCountsRow.draft || 0),
      issued: Number(quotationCountsRow.issued || 0),
      accepted: Number(quotationCountsRow.accepted || 0),
      rejected_or_expired: Number(quotationCountsRow.rejected_or_expired || 0),
      earliest_date: quotationCountsRow.earliest_date || null,
      latest_date: quotationCountsRow.latest_date || null,
      eligible_count: Number(quotationEligibilityRow.eligible_count || 0),
      blocked_count: Number(quotationEligibilityRow.blocked_count || 0),
      affected_items: Number(quotationItemsRow.affected_items || 0),
      affected_milestones: Number(quotationItemsRow.affected_milestones || 0),
      estimated_reclaim_bytes: quotationEstReclaim,
    },
    invoices: {
      total: Number(invoiceCountsRow.total || 0),
      draft: Number(invoiceCountsRow.draft || 0),
      issued: Number(invoiceCountsRow.issued || 0),
      paid: Number(invoicePaymentBreakdown.paid || 0),
      partially_paid: Number(invoicePaymentBreakdown.partially_paid || 0),
      unpaid: Number(invoicePaymentBreakdown.unpaid || 0),
      cancelled_or_void: Number(invoiceCountsRow.cancelled_or_void || 0),
      earliest_date: invoiceCountsRow.earliest_date || null,
      latest_date: invoiceCountsRow.latest_date || null,
      eligible_count: Number(invoiceEligibilityRow.eligible_count || 0),
      blocked_count: Number(invoiceEligibilityRow.blocked_count || 0),
      blocked_breakdown: {
        with_payments: Number(invoiceEligibilityRow.blocked_with_payments || 0),
        with_credit_notes: Number(invoiceEligibilityRow.blocked_with_credit_notes || 0),
        with_subscriptions: Number(invoiceEligibilityRow.blocked_with_subscriptions || 0),
        with_converted_quotations: Number(invoiceEligibilityRow.blocked_with_quotations || 0),
      },
      affected_items: Number(invoiceItemsRow.affected_items || 0),
      estimated_reclaim_bytes: invoiceEstReclaim,
    },
  };
}

/**
 * Previews which documents match the user's selection and returns
 * eligible documents, blocked documents with reasons, and estimated impact.
 */
export async function previewCleanup(db, { category, filterType = 'ALL', fromDate = null, toDate = null, selectedIds = [] }) {
  assert(['QUOTATIONS', 'INVOICES'].includes(category), 400, 'Invalid cleanup category.', 'VALIDATION_ERROR');

  if (category === 'QUOTATIONS') {
    let whereClause = '1=1';
    const params = [];
    if (filterType === 'DATE_RANGE') {
      if (fromDate) { params.push(fromDate); whereClause += ` AND q.issue_date >= $${params.length}`; }
      if (toDate) { params.push(toDate); whereClause += ` AND q.issue_date <= $${params.length}`; }
    } else if (filterType === 'IDS') {
      params.push(selectedIds);
      whereClause += ` AND q.id = ANY($${params.length}::uuid[])`;
    }

    const { rows } = await db.query(`
      SELECT
        q.id, q.quotation_number, q.title, q.status, q.issue_date, q.expiry_date,
        (q.totals->>'grand_total_minor')::bigint AS grand_total_minor,
        c.name AS client_name,
        q.converted_invoice_id,
        (SELECT count(*)::int FROM inv.quotation_items qi WHERE qi.quotation_id = q.id) AS items_count,
        (SELECT count(*)::int FROM inv.quotation_milestones qm WHERE qm.quotation_id = q.id) AS milestones_count,
        (SELECT count(*)::int FROM inv.invoices iv WHERE iv.quotation_id = q.id) AS linked_invoices_count
      FROM inv.quotations q
      JOIN inv.clients c ON c.id = q.client_id
      WHERE ${whereClause}
      ORDER BY q.issue_date ASC, q.created_at ASC
    `, params);

    const eligible = [];
    const blocked = [];

    for (const row of rows) {
      const blockedReasons = [];
      if (row.converted_invoice_id) {
        blockedReasons.push('Converted to an invoice (retained for invoice audit trail)');
      }
      if (row.linked_invoices_count > 0) {
        blockedReasons.push(`Referenced by ${row.linked_invoices_count} invoice(s)`);
      }

      if (blockedReasons.length > 0) {
        blocked.push({
          id: row.id,
          number: row.quotation_number || 'Draft',
          title: row.title,
          status: row.status,
          issue_date: row.issue_date,
          client_name: row.client_name,
          grand_total_minor: row.grand_total_minor,
          reasons: blockedReasons,
        });
      } else {
        eligible.push({
          id: row.id,
          number: row.quotation_number || 'Draft',
          title: row.title,
          status: row.status,
          issue_date: row.issue_date,
          expiry_date: row.expiry_date,
          client_name: row.client_name,
          grand_total_minor: row.grand_total_minor,
          items_count: row.items_count,
          milestones_count: row.milestones_count,
        });
      }
    }

    const affectedItems = eligible.reduce((acc, r) => acc + r.items_count, 0);
    const affectedMilestones = eligible.reduce((acc, r) => acc + r.milestones_count, 0);

    return {
      category: 'QUOTATIONS',
      filter_type: filterType,
      selected_count: eligible.length,
      blocked_count: blocked.length,
      eligible_records: eligible,
      blocked_records: blocked,
      affected_related_records: {
        items: affectedItems,
        milestones: affectedMilestones,
        total_sub_records: affectedItems + affectedMilestones,
      },
      estimated_storage_reclaim_bytes: eligible.length * 3500,
    };
  }

  // INVOICES category
  let whereClause = '1=1';
  const params = [];
  if (filterType === 'DATE_RANGE') {
    if (fromDate) { params.push(fromDate); whereClause += ` AND i.issue_date >= $${params.length}`; }
    if (toDate) { params.push(toDate); whereClause += ` AND i.issue_date <= $${params.length}`; }
  } else if (filterType === 'IDS') {
    params.push(selectedIds);
    whereClause += ` AND i.id = ANY($${params.length}::uuid[])`;
  }

  const { rows } = await db.query(`
    SELECT
      i.id, i.invoice_number, i.title, i.status, i.issue_date, i.due_date,
      (i.totals->>'grand_total_minor')::bigint AS grand_total_minor,
      c.name AS client_name,
      COALESCE(p.paid_minor, 0)::bigint AS paid_minor,
      COALESCE(p.payment_count, 0)::int AS payment_count,
      (SELECT count(*)::int FROM inv.adjustment_notes an WHERE an.invoice_id = i.id) AS notes_count,
      (SELECT count(*)::int FROM inv.pos_subscriptions sub WHERE sub.invoice_id = i.id) AS subscriptions_count,
      (SELECT count(*)::int FROM inv.quotations q WHERE q.converted_invoice_id = i.id) AS converted_quotations_count,
      (SELECT count(*)::int FROM inv.invoice_items ii WHERE ii.invoice_id = i.id) AS items_count
    FROM inv.invoices i
    JOIN inv.clients c ON c.id = i.client_id
    LEFT JOIN (
      SELECT invoice_id, sum(amount_minor) AS paid_minor, count(*)::int AS payment_count
      FROM inv.payments GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    WHERE ${whereClause}
    ORDER BY i.issue_date ASC, i.created_at ASC
  `, params);

  const eligible = [];
  const blocked = [];

  for (const row of rows) {
    const blockedReasons = [];
    if (row.payment_count > 0 || row.paid_minor > 0) {
      blockedReasons.push(`Has ${row.payment_count} recorded payment(s) totaling ${row.paid_minor} minor units (statutory accounting ledger)`);
    }
    if (row.notes_count > 0) {
      blockedReasons.push(`Has ${row.notes_count} credit/debit adjustment note(s) (statutory GST records)`);
    }
    if (row.subscriptions_count > 0) {
      blockedReasons.push(`Linked to ${row.subscriptions_count} POS customer subscription(s)`);
    }
    if (row.converted_quotations_count > 0) {
      blockedReasons.push(`Referenced as converted invoice by ${row.converted_quotations_count} quotation(s)`);
    }

    if (blockedReasons.length > 0) {
      blocked.push({
        id: row.id,
        number: row.invoice_number || 'Draft',
        title: row.title,
        status: row.status,
        issue_date: row.issue_date,
        client_name: row.client_name,
        grand_total_minor: row.grand_total_minor,
        reasons: blockedReasons,
      });
    } else {
      eligible.push({
        id: row.id,
        number: row.invoice_number || 'Draft',
        title: row.title,
        status: row.status,
        issue_date: row.issue_date,
        due_date: row.due_date,
        client_name: row.client_name,
        grand_total_minor: row.grand_total_minor,
        items_count: row.items_count,
      });
    }
  }

  const affectedItems = eligible.reduce((acc, r) => acc + r.items_count, 0);

  return {
    category: 'INVOICES',
    filter_type: filterType,
    selected_count: eligible.length,
    blocked_count: blocked.length,
    eligible_records: eligible,
    blocked_records: blocked,
    affected_related_records: {
      items: affectedItems,
      total_sub_records: affectedItems,
    },
    estimated_storage_reclaim_bytes: eligible.length * 4500,
  };
}

/**
 * Builds export files (XLSX, CSV, PDF, and structured JSON) for the selected IDs.
 * Verifies every generated file, computes SHA-256 checksums, and issues a
 * verification token required to authorize deletion.
 */
export async function generateExportArchive(db, { category, ids = [], destinationDir = null }) {
  assert(['QUOTATIONS', 'INVOICES'].includes(category), 400, 'Invalid category.', 'VALIDATION_ERROR');
  assert(Array.isArray(ids) && ids.length > 0, 400, 'No document IDs were provided for export.', 'EMPTY_SELECTION');

  // Verify that all IDs exist and are currently eligible
  const preview = await previewCleanup(db, { category, filterType: 'IDS', selectedIds: ids });
  assert(preview.selected_count === ids.length, 422,
    `Some selected records are ineligible or blocked from cleanup (${preview.blocked_count} blocked).`,
    'INELIGIBLE_RECORDS');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = resolveSafeExportDir(category, stamp, destinationDir);

  const manifest = {
    category,
    record_count: ids.length,
    document_ids: ids,
    export_directory: baseDir,
    created_at: new Date().toISOString(),
    files: {},
  };

  if (category === 'QUOTATIONS') {
    await exportQuotationsBundle(db, ids, baseDir, manifest);
  } else {
    await exportInvoicesBundle(db, ids, baseDir, manifest);
  }

  // Write initial manifest.json
  const manifestPath = join(baseDir, 'manifest.json');
  manifest.manifest_path = manifestPath;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Verify the generated files across all 4 formats (JSON, XLSX, CSV, PDF)
  const verification = await verifyExportManifest(manifest);
  manifest.verified = true;
  manifest.verification_time = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Create token
  const token = storeVerificationToken(manifest);

  return {
    verification_token: token,
    manifest,
    verification,
  };
}

async function exportQuotationsBundle(db, ids, baseDir, manifest) {
  // Load full quotation documents
  const fullRecords = [];
  for (const id of ids) {
    const doc = await getQuotation(db, id);
    fullRecords.push(doc);
  }

  // 1. Structured JSON Backup (lossless relational dump)
  const jsonPath = join(baseDir, `quotations-structured-backup.json`);
  const jsonContent = JSON.stringify({
    format: 'nextora-invoicing-quotation-archive-v1',
    exported_at: new Date().toISOString(),
    count: fullRecords.length,
    quotations: fullRecords,
  }, null, 2);
  writeFileSync(jsonPath, jsonContent, 'utf8');
  manifest.files.json = {
    path: jsonPath,
    filename: `quotations-structured-backup.json`,
    size_bytes: statSync(jsonPath).size,
    sha256: sha256File(jsonPath),
    record_count: fullRecords.length,
  };

  // 2. CSV Exports: Master sheet & Line items sheet
  const masterColumns = [
    { key: 'quotation_number', label: 'Quotation Number' },
    { key: 'status', label: 'Status' },
    { key: 'issue_date', label: 'Issue Date' },
    { key: 'expiry_date', label: 'Expiry Date' },
    { key: 'client_name', label: 'Client Name' },
    { key: 'client_company', label: 'Company' },
    { key: 'client_gstin', label: 'Client GSTIN' },
    { key: 'supply_type', label: 'Supply Type' },
    { key: 'subtotal_minor', label: 'Subtotal (INR Minor)' },
    { key: 'tax_minor', label: 'Tax Total (INR Minor)' },
    { key: 'grand_total_minor', label: 'Grand Total (INR Minor)' },
    { key: 'terms', label: 'Terms' },
    { key: 'notes', label: 'Notes' },
  ];
  const masterRows = fullRecords.map(r => ({
    quotation_number: r.quotation.quotation_number || 'DRAFT',
    status: r.quotation.status,
    issue_date: r.quotation.issue_date,
    expiry_date: r.quotation.expiry_date || '',
    client_name: r.client?.name || '',
    client_company: r.client?.company_name || '',
    client_gstin: r.client?.gstin || '',
    supply_type: r.quotation.supply_type,
    subtotal_minor: r.quotation.totals?.taxable_total_minor ?? 0,
    tax_minor: r.quotation.totals?.tax_total_minor ?? 0,
    grand_total_minor: r.quotation.totals?.grand_total_minor ?? 0,
    terms: r.quotation.terms || '',
    notes: r.quotation.notes || '',
  }));
  const masterCsvPath = join(baseDir, `quotations-master.csv`);
  writeFileSync(masterCsvPath, toCsv(masterColumns, masterRows), 'utf8');
  manifest.files.csv_master = {
    path: masterCsvPath,
    filename: `quotations-master.csv`,
    size_bytes: statSync(masterCsvPath).size,
    sha256: sha256File(masterCsvPath),
    record_count: masterRows.length,
  };

  const itemColumns = [
    { key: 'quotation_number', label: 'Quotation Number' },
    { key: 'position', label: 'Position' },
    { key: 'description', label: 'Description' },
    { key: 'hsn_sac', label: 'HSN/SAC' },
    { key: 'quantity_milli', label: 'Quantity (Milli)' },
    { key: 'unit_price_minor', label: 'Unit Price (Minor)' },
    { key: 'discount_bp', label: 'Discount BP' },
    { key: 'tax_rate_bp', label: 'Tax Rate BP' },
    { key: 'taxable_minor', label: 'Taxable (Minor)' },
    { key: 'cgst_minor', label: 'CGST (Minor)' },
    { key: 'sgst_minor', label: 'SGST (Minor)' },
    { key: 'igst_minor', label: 'IGST (Minor)' },
    { key: 'total_minor', label: 'Total (Minor)' },
  ];
  const itemRows = [];
  for (const r of fullRecords) {
    const qNum = r.quotation.quotation_number || 'DRAFT';
    for (const itm of r.items) {
      itemRows.push({
        quotation_number: qNum,
        position: itm.position,
        description: itm.description,
        hsn_sac: itm.hsn_sac || '',
        quantity_milli: itm.quantity_milli,
        unit_price_minor: itm.unit_price_minor,
        discount_bp: itm.discount_bp,
        tax_rate_bp: itm.tax_rate_bp,
        taxable_minor: itm.taxable_minor,
        cgst_minor: itm.cgst_minor,
        sgst_minor: itm.sgst_minor,
        igst_minor: itm.igst_minor,
        total_minor: itm.total_minor,
      });
    }
  }
  const itemsCsvPath = join(baseDir, `quotations-line-items.csv`);
  writeFileSync(itemsCsvPath, toCsv(itemColumns, itemRows), 'utf8');
  manifest.files.csv_items = {
    path: itemsCsvPath,
    filename: `quotations-line-items.csv`,
    size_bytes: statSync(itemsCsvPath).size,
    sha256: sha256File(itemsCsvPath),
    record_count: itemRows.length,
  };

  // 3. Multi-Sheet Excel Workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nextora Creations Invoicing';
  workbook.created = new Date();

  const wsMaster = workbook.addWorksheet('Quotations Master');
  wsMaster.columns = masterColumns.map(c => ({ header: c.label, key: c.key, width: 20 }));
  wsMaster.getRow(1).font = { bold: true };
  for (const row of masterRows) {
    const sanitized = {};
    for (const [k, v] of Object.entries(row)) sanitized[k] = sanitizeCell(v);
    wsMaster.addRow(sanitized);
  }

  const wsItems = workbook.addWorksheet('Line Items');
  wsItems.columns = itemColumns.map(c => ({ header: c.label, key: c.key, width: 20 }));
  wsItems.getRow(1).font = { bold: true };
  for (const row of itemRows) {
    const sanitized = {};
    for (const [k, v] of Object.entries(row)) sanitized[k] = sanitizeCell(v);
    wsItems.addRow(sanitized);
  }

  const xlsxPath = join(baseDir, `quotations-archive.xlsx`);
  await workbook.xlsx.writeFile(xlsxPath);
  manifest.files.xlsx = {
    path: xlsxPath,
    filename: `quotations-archive.xlsx`,
    size_bytes: statSync(xlsxPath).size,
    sha256: sha256File(xlsxPath),
    record_count: fullRecords.length,
  };

  // 4. Compiled Human-Readable PDF Archive
  const compiledPdf = await PDFDocument.create();
  for (const id of ids) {
    const { snapshot } = await quotationSnapshotForRender(db, id);
    const pdfBytes = await renderDocument(snapshot);
    const docToMerge = await PDFDocument.load(pdfBytes);
    const copiedPages = await compiledPdf.copyPages(docToMerge, docToMerge.getPageIndices());
    for (const page of copiedPages) compiledPdf.addPage(page);
  }
  const pdfBytes = await compiledPdf.save();
  const pdfPath = join(baseDir, `quotations-human-readable-archive.pdf`);
  writeFileSync(pdfPath, Buffer.from(pdfBytes));
  manifest.files.pdf = {
    path: pdfPath,
    filename: `quotations-human-readable-archive.pdf`,
    size_bytes: statSync(pdfPath).size,
    sha256: sha256File(pdfPath),
    record_count: fullRecords.length,
  };
}

async function exportInvoicesBundle(db, ids, baseDir, manifest) {
  const fullRecords = [];
  for (const id of ids) {
    const doc = await getInvoice(db, id);
    fullRecords.push(doc);
  }

  // 1. Structured JSON Backup
  const jsonPath = join(baseDir, `invoices-structured-backup.json`);
  const jsonContent = JSON.stringify({
    format: 'nextora-invoicing-invoice-archive-v1',
    exported_at: new Date().toISOString(),
    count: fullRecords.length,
    invoices: fullRecords,
  }, null, 2);
  writeFileSync(jsonPath, jsonContent, 'utf8');
  manifest.files.json = {
    path: jsonPath,
    filename: `invoices-structured-backup.json`,
    size_bytes: statSync(jsonPath).size,
    sha256: sha256File(jsonPath),
    record_count: fullRecords.length,
  };

  // 2. CSV Exports: Master & Line Items
  const masterColumns = [
    { key: 'invoice_number', label: 'Invoice Number' },
    { key: 'status', label: 'Status' },
    { key: 'issue_date', label: 'Issue Date' },
    { key: 'due_date', label: 'Due Date' },
    { key: 'client_name', label: 'Client Name' },
    { key: 'client_company', label: 'Company' },
    { key: 'client_gstin', label: 'Client GSTIN' },
    { key: 'supply_type', label: 'Supply Type' },
    { key: 'subtotal_minor', label: 'Subtotal (INR Minor)' },
    { key: 'tax_minor', label: 'Tax Total (INR Minor)' },
    { key: 'grand_total_minor', label: 'Grand Total (INR Minor)' },
    { key: 'po_reference', label: 'PO Reference' },
    { key: 'terms', label: 'Terms' },
    { key: 'notes', label: 'Notes' },
  ];
  const masterRows = fullRecords.map(r => ({
    invoice_number: r.invoice.invoice_number || 'DRAFT',
    status: r.invoice.status,
    issue_date: r.invoice.issue_date,
    due_date: r.invoice.due_date || '',
    client_name: r.client?.name || '',
    client_company: r.client?.company_name || '',
    client_gstin: r.client?.gstin || '',
    supply_type: r.invoice.supply_type,
    subtotal_minor: r.invoice.totals?.taxable_total_minor ?? 0,
    tax_minor: r.invoice.totals?.tax_total_minor ?? 0,
    grand_total_minor: r.invoice.totals?.grand_total_minor ?? 0,
    po_reference: r.invoice.po_reference || '',
    terms: r.invoice.terms || '',
    notes: r.invoice.notes || '',
  }));
  const masterCsvPath = join(baseDir, `invoices-master.csv`);
  writeFileSync(masterCsvPath, toCsv(masterColumns, masterRows), 'utf8');
  manifest.files.csv_master = {
    path: masterCsvPath,
    filename: `invoices-master.csv`,
    size_bytes: statSync(masterCsvPath).size,
    sha256: sha256File(masterCsvPath),
    record_count: masterRows.length,
  };

  const itemColumns = [
    { key: 'invoice_number', label: 'Invoice Number' },
    { key: 'position', label: 'Position' },
    { key: 'description', label: 'Description' },
    { key: 'hsn_sac', label: 'HSN/SAC' },
    { key: 'quantity_milli', label: 'Quantity (Milli)' },
    { key: 'unit_price_minor', label: 'Unit Price (Minor)' },
    { key: 'discount_bp', label: 'Discount BP' },
    { key: 'tax_rate_bp', label: 'Tax Rate BP' },
    { key: 'taxable_minor', label: 'Taxable (Minor)' },
    { key: 'cgst_minor', label: 'CGST (Minor)' },
    { key: 'sgst_minor', label: 'SGST (Minor)' },
    { key: 'igst_minor', label: 'IGST (Minor)' },
    { key: 'total_minor', label: 'Total (Minor)' },
  ];
  const itemRows = [];
  for (const r of fullRecords) {
    const invNum = r.invoice.invoice_number || 'DRAFT';
    for (const itm of r.items) {
      itemRows.push({
        invoice_number: invNum,
        position: itm.position,
        description: itm.description,
        hsn_sac: itm.hsn_sac || '',
        quantity_milli: itm.quantity_milli,
        unit_price_minor: itm.unit_price_minor,
        discount_bp: itm.discount_bp,
        tax_rate_bp: itm.tax_rate_bp,
        taxable_minor: itm.taxable_minor,
        cgst_minor: itm.cgst_minor,
        sgst_minor: itm.sgst_minor,
        igst_minor: itm.igst_minor,
        total_minor: itm.total_minor,
      });
    }
  }
  const itemsCsvPath = join(baseDir, `invoices-line-items.csv`);
  writeFileSync(itemsCsvPath, toCsv(itemColumns, itemRows), 'utf8');
  manifest.files.csv_items = {
    path: itemsCsvPath,
    filename: `invoices-line-items.csv`,
    size_bytes: statSync(itemsCsvPath).size,
    sha256: sha256File(itemsCsvPath),
    record_count: itemRows.length,
  };

  // 3. Multi-Sheet Excel Workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nextora Creations Invoicing';
  workbook.created = new Date();

  const wsMaster = workbook.addWorksheet('Invoices Master');
  wsMaster.columns = masterColumns.map(c => ({ header: c.label, key: c.key, width: 20 }));
  wsMaster.getRow(1).font = { bold: true };
  for (const row of masterRows) {
    const sanitized = {};
    for (const [k, v] of Object.entries(row)) sanitized[k] = sanitizeCell(v);
    wsMaster.addRow(sanitized);
  }

  const wsItems = workbook.addWorksheet('Line Items');
  wsItems.columns = itemColumns.map(c => ({ header: c.label, key: c.key, width: 20 }));
  wsItems.getRow(1).font = { bold: true };
  for (const row of itemRows) {
    const sanitized = {};
    for (const [k, v] of Object.entries(row)) sanitized[k] = sanitizeCell(v);
    wsItems.addRow(sanitized);
  }

  const xlsxPath = join(baseDir, `invoices-archive.xlsx`);
  await workbook.xlsx.writeFile(xlsxPath);
  manifest.files.xlsx = {
    path: xlsxPath,
    filename: `invoices-archive.xlsx`,
    size_bytes: statSync(xlsxPath).size,
    sha256: sha256File(xlsxPath),
    record_count: fullRecords.length,
  };

  // 4. Compiled Human-Readable PDF Archive
  const compiledPdf = await PDFDocument.create();
  for (const id of ids) {
    const { snapshot } = await invoiceSnapshotForRender(db, id);
    const pdfBytes = await renderDocument(snapshot);
    const docToMerge = await PDFDocument.load(pdfBytes);
    const copiedPages = await compiledPdf.copyPages(docToMerge, docToMerge.getPageIndices());
    for (const page of copiedPages) compiledPdf.addPage(page);
  }
  const pdfBytes = await compiledPdf.save();
  const pdfPath = join(baseDir, `invoices-human-readable-archive.pdf`);
  writeFileSync(pdfPath, Buffer.from(pdfBytes));
  manifest.files.pdf = {
    path: pdfPath,
    filename: `invoices-human-readable-archive.pdf`,
    size_bytes: statSync(pdfPath).size,
    sha256: sha256File(pdfPath),
    record_count: fullRecords.length,
  };
}

/**
 * Validates export files against manifest across all four formats:
 * JSON schema & record count, ExcelJS workbook & sheets, CSV row counts,
 * pdf-lib document page count, and SHA-256 cryptographic checksums.
 */
export async function verifyExportManifest(manifest) {
  assert(manifest && typeof manifest === 'object', 400, 'Invalid manifest.', 'VALIDATION_ERROR');
  const files = manifest.files || {};
  const requiredKeys = ['json', 'csv_master', 'csv_items', 'xlsx', 'pdf'];

  for (const key of requiredKeys) {
    const fileInfo = files[key];
    if (!fileInfo || !fileInfo.path) {
      throw new HttpError(422, `Missing export file artifact: ${key}`, 'MISSING_EXPORT_FILE');
    }
    if (!existsSync(fileInfo.path)) {
      throw new HttpError(422, `Export file not found on disk: ${fileInfo.path}`, 'EXPORT_FILE_NOT_FOUND');
    }
    const stat = statSync(fileInfo.path);
    if (!stat.isFile() || stat.size === 0) {
      throw new HttpError(422, `Export file is empty or corrupted: ${fileInfo.path}`, 'EMPTY_EXPORT_FILE');
    }
    const actualChecksum = sha256File(fileInfo.path);
    if (actualChecksum !== fileInfo.sha256) {
      throw new HttpError(422, `Checksum mismatch for export file: ${fileInfo.filename}`, 'CORRUPT_EXPORT_FILE');
    }
  }

  // 1. Parse JSON file to confirm structured integrity
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(files.json.path, 'utf8'));
  } catch (err) {
    throw new HttpError(422, `Structured JSON export failed to parse: ${err.message}`, 'CORRUPT_EXPORT_FILE');
  }

  const items = manifest.category === 'QUOTATIONS' ? parsed.quotations : parsed.invoices;
  if (!Array.isArray(items) || items.length !== manifest.record_count) {
    throw new HttpError(422, `Export record count (${items?.length ?? 0}) does not match selected count (${manifest.record_count}).`,
      'COUNT_MISMATCH');
  }

  // Confirm all document IDs are represented in JSON
  const exportedIdSet = new Set(items.map(it => (it.quotation || it.invoice)?.id));
  for (const id of manifest.document_ids) {
    if (!exportedIdSet.has(id)) {
      throw new HttpError(422, `Document ID ${id} is missing from the export archive.`, 'INCOMPLETE_EXPORT');
    }
  }

  // 2. Reopen and validate Excel workbook (.xlsx)
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(files.xlsx.path);
    const masterSheet = workbook.getWorksheet(1);
    const itemsSheet = workbook.getWorksheet(2);
    if (!masterSheet || !itemsSheet) {
      throw new Error('Workbook is missing required Master or Line Items worksheets.');
    }
    if (masterSheet.actualRowCount < manifest.record_count + 1) {
      throw new Error(`Master worksheet rows (${masterSheet.actualRowCount}) do not cover record count.`);
    }
  } catch (err) {
    throw new HttpError(422, `Excel archive (.xlsx) validation failed: ${err.message}`, 'CORRUPT_EXPORT_FILE');
  }

  // 3. Re-parse Master and Items CSV
  try {
    const masterText = readFileSync(files.csv_master.path, 'utf8');
    const masterLines = masterText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (masterLines.length < manifest.record_count + 1) {
      throw new Error(`Master CSV row count (${masterLines.length - 1}) less than expected records (${manifest.record_count}).`);
    }

    const itemsText = readFileSync(files.csv_items.path, 'utf8');
    const itemLines = itemsText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (itemLines.length < 1) {
      throw new Error('Line items CSV is empty.');
    }
  } catch (err) {
    throw new HttpError(422, `CSV archive validation failed: ${err.message}`, 'CORRUPT_EXPORT_FILE');
  }

  // 4. Validate compiled PDF document
  try {
    const pdfBytes = readFileSync(files.pdf.path);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    if (pdfDoc.getPageCount() < manifest.record_count) {
      throw new Error(`PDF page count (${pdfDoc.getPageCount()}) is less than record count (${manifest.record_count}).`);
    }
  } catch (err) {
    throw new HttpError(422, `PDF archive validation failed: ${err.message}`, 'CORRUPT_EXPORT_FILE');
  }

  return {
    verified: true,
    category: manifest.category,
    record_count: manifest.record_count,
    files: Object.values(files).map(f => ({
      filename: f.filename,
      size_bytes: f.size_bytes,
      sha256: f.sha256,
      verified: true,
    })),
  };
}

/**
 * Safely executes deletion of verified, eligible quotations or invoices.
 *
 * Sequence:
 * 1. Role verification (OWNER or ADMIN).
 * 2. Confirmation phrase verification ('DELETE QUOTATIONS' or 'DELETE INVOICES').
 * 3. Export verification check via token.
 * 4. Pre-deletion safety backup of live database.
 * 5. Atomic transaction with cleanup context:
 *    - Re-check document eligibility immediately before deletion.
 *    - Perform deletion.
 *    - Write audit log entry.
 * 6. SQLite maintenance (wal_checkpoint, integrity_check, VACUUM).
 */
export async function executeCleanup(db, actor, {
  category,
  ids = [],
  verificationToken,
  confirmationPhrase,
  backupDir = null,
}) {
  requireManager(actor);

  assert(['QUOTATIONS', 'INVOICES'].includes(category), 400, 'Invalid category.', 'VALIDATION_ERROR');
  const expectedPhrase = CONFIRMATION_PHRASES[category];
  assert(confirmationPhrase === expectedPhrase, 400,
    `Incorrect confirmation phrase. You must enter "${expectedPhrase}" to confirm deletion.`,
    'CONFIRMATION_PHRASE_MISMATCH');

  // Retrieve and verify export token
  const manifest = retrieveVerificationToken(verificationToken);
  assert(manifest.category === category, 400, 'Verification token category mismatch.', 'TOKEN_MISMATCH');
  assert(manifest.record_count === ids.length, 400, 'Record count does not match verified manifest.', 'COUNT_MISMATCH');

  const selectedSet = new Set(ids);
  for (const id of manifest.document_ids) {
    if (!selectedSet.has(id)) {
      throw new HttpError(400, `The IDs for deletion do not match the verified export manifest.`, 'SELECTION_MISMATCH');
    }
  }

  // 1. Pre-deletion safety backup of live database
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = resolveSafeBackupDir(backupDir);
  const safetyBackupPath = join(targetDir, `pre-cleanup-safety-${category.toLowerCase()}-${stamp}.sqlite`);

  let backupResult = null;
  if (db.driver === 'sqlite' && db.file && db.file !== ':memory:') {
    backupResult = await createBackup(db, safetyBackupPath);
  }

  // Measure initial size
  let storageBefore = 0;
  if (db.driver === 'sqlite' && db.file && db.file !== ':memory:' && existsSync(db.file)) {
    storageBefore = statSync(db.file).size;
  }

  // 2. Atomic deletion transaction
  await db.transaction(async tx => {
    // Activate cleanup context for this transaction
    await tx.query('INSERT INTO inv.cleanup_context (active) VALUES (true)');

    // Re-verify eligibility immediately inside transaction
    const preview = await previewCleanup(tx, { category, filterType: 'IDS', selectedIds: ids });
    if (preview.selected_count !== ids.length || preview.blocked_count > 0) {
      throw new HttpError(409,
        `Some selected records cannot be deleted safely (${preview.blocked_count} blocked). Operation aborted.`,
        'CONCURRENT_DEPENDENCY_DETECTED');
    }

    if (category === 'QUOTATIONS') {
      // Cascading line items and milestones are removed automatically by FK ON DELETE CASCADE,
      // but we explicitly delete to ensure clean execution.
      for (const id of ids) {
        await tx.query('DELETE FROM inv.quotation_milestones WHERE quotation_id = $1', [id]);
        await tx.query('DELETE FROM inv.quotation_items WHERE quotation_id = $1', [id]);
        await tx.query('DELETE FROM inv.quotations WHERE id = $1', [id]);
      }
    } else {
      for (const id of ids) {
        await tx.query('DELETE FROM inv.invoice_items WHERE invoice_id = $1', [id]);
        await tx.query('DELETE FROM inv.invoices WHERE id = $1', [id]);
      }
    }

    // Clear cleanup context
    await tx.query('DELETE FROM inv.cleanup_context');

    // Audit log entry
    await audit(tx, 'BUSINESS_DATA_CLEANUP', {
      actorId: actor.id,
      entityType: category,
      entityId: null,
      metadata: {
        category,
        count: ids.length,
        document_ids: ids,
        export_directory: manifest.export_directory,
        safety_backup: backupResult ? safetyBackupPath : null,
      },
    });
  });

  // Expire the verification token so it cannot be reused
  activeTokens.delete(verificationToken);

  // 3. Post-deletion SQLite maintenance (outside transaction)
  let storageAfter = storageBefore;
  let reclaimedBytes = 0;
  let integrityOk = true;

  if (db.driver === 'sqlite' && typeof db.vacuum === 'function') {
    try {
      await db.checkpoint();
      const integrity = await db.integrityCheck();
      integrityOk = integrity?.ok !== false;
      await db.vacuum();
      if (existsSync(db.file)) {
        storageAfter = statSync(db.file).size;
        reclaimedBytes = Math.max(0, storageBefore - storageAfter);
      }
    } catch {
      // VACUUM failure does not invalidate transaction; data was already deleted cleanly
    }
  }

  return {
    success: true,
    category,
    deleted_count: ids.length,
    safety_backup: backupResult ? safetyBackupPath : null,
    storage_before_bytes: storageBefore,
    storage_after_bytes: storageAfter,
    reclaimed_bytes: reclaimedBytes,
    database_integrity_ok: integrityOk,
  };
}
