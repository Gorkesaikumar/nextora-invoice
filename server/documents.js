import { randomUUID } from 'node:crypto';
import { assert } from './domain.js';
import { computeDocument, percentOf } from './money.js';
import { supplyTypeFor } from './gst.js';
import { allocateNumber } from './numbering.js';
import { audit, statusChange } from './audit.js';
import { requireWriter, settings, pagination, searchTerm } from './service.js';
import { amountInWords } from './words.js';

const escapeLike = value => value.replace(/[!%_]/g, '!$&');
// Empty filters must reach SQL as NULL: an empty string is not a valid date or uuid.
const optionalParam = (url, name) => ((url.searchParams.get(name) || '').trim() || null);

const QUOTATION_TRANSITIONS = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: [],
  REJECTED: ['SENT'],
  EXPIRED: ['SENT', 'ACCEPTED'],
  CANCELLED: [],
};

const ITEM_COLUMNS = ['position', 'product_id', 'description', 'category', 'hsn_sac', 'unit', 'quantity_milli',
  'unit_price_minor', 'discount_bp', 'discount_minor', 'tax_rate_bp', 'tax_treatment', 'gross_minor',
  'item_discount_minor', 'invoice_discount_minor', 'taxable_minor', 'cgst_minor', 'sgst_minor', 'igst_minor',
  'tax_minor', 'total_minor', 'tax_mode'];

/* ------------------------------------------------------------------ loading */

export async function loadClient(tx, id) {
  const client = (await tx.query('SELECT * FROM inv.clients WHERE id=$1', [id])).rows[0];
  assert(client, 400, 'Select an existing client before saving.', 'CLIENT_REQUIRED');
  return client;
}

/** Resolves the place of supply and the resulting tax split for a document. */
export async function resolveSupply(tx, input) {
  const business = await settings(tx);
  const client = await loadClient(tx, input.client_id);
  const place = input.place_of_supply_state_code || client.state_code || '';
  const taxable = input.items.some(item => item.tax_treatment === 'TAXABLE')
    || (input.additional_charges || []).some(charge => charge.tax_treatment === 'TAXABLE');
  const supply_type = taxable ? supplyTypeFor(business.state_code, place) : 'INTRA';
  return { business, client, place, supply_type,
    warnings: client.status === 'ARCHIVED' ? ['This client is archived.'] : [] };
}

export function documentTotals(input, supply_type, defaultTaxMode = 'EXCLUSIVE') {
  const taxMode = input.tax_mode || defaultTaxMode || 'EXCLUSIVE';
  const computed = computeDocument({
    items: (input.items || []).map(item => ({
      ...item,
      tax_mode: item.tax_mode || taxMode,
    })),
    additional_charges: input.additional_charges || [],
    invoice_discount_bp: input.invoice_discount_bp || 0,
    invoice_discount_minor: input.invoice_discount_minor || 0,
    supply_type,
    round_off_enabled: input.round_off_enabled !== false,
    tax_mode: taxMode,
  });
  return { ...computed, totals: { ...computed.totals, amount_in_words: amountInWords(computed.totals.grand_total_minor) } };
}

/** Milestone amounts are derived from shares so they can never contradict the total. */
export function validateMilestones(milestones, grandTotalMinor) {
  if (!milestones.length) return [];
  const shareTotal = milestones.reduce((total, milestone) => total + (milestone.share_bp || 0), 0);
  const amountTotal = milestones.reduce((total, milestone) => total + (milestone.amount_minor || 0), 0);
  if (shareTotal > 0) {
    assert(milestones.every(m => m.share_bp > 0), 400, 'Give every milestone a share, or leave all shares empty.', 'MILESTONE_MISMATCH');
    assert(shareTotal <= 10000, 400, 'Milestone shares cannot add up to more than 100%.', 'MILESTONE_MISMATCH');
return milestones.map((milestone, index) => ({
      ...milestone,
      position: index,
      amount_minor: percentOf(grandTotalMinor, milestone.share_bp),
    }));
  }
  assert(amountTotal <= grandTotalMinor || grandTotalMinor === 0, 400,
    'Milestone amounts cannot exceed the document total.', 'MILESTONE_MISMATCH');
  return milestones.map((milestone, index) => ({ ...milestone, position: index }));
}

async function writeItems(tx, table, fkColumn, documentId, lines) {
  for (const [index, line] of lines.entries()) {
    const values = [randomUUID(), documentId, index, line.product_id, line.description, line.category, line.hsn_sac,
      line.unit, line.quantity_milli, line.unit_price_minor, line.discount_bp, line.discount_minor, line.tax_rate_bp,
      line.tax_treatment, line.gross_minor, line.item_discount_minor, line.invoice_discount_minor, line.taxable_minor,
      line.cgst_minor, line.sgst_minor, line.igst_minor, line.tax_minor, line.total_minor, line.tax_mode || 'EXCLUSIVE'];
    await tx.query(`INSERT INTO ${table}(id,${fkColumn},${ITEM_COLUMNS.join(',')})
      VALUES($1,$2,${ITEM_COLUMNS.map((_, i) => `$${i + 3}`).join(',')})`, values);
  }
}

async function writeMilestones(tx, quotationId, milestones) {
  for (const milestone of milestones) {
    await tx.query(`INSERT INTO inv.quotation_milestones(id,quotation_id,position,title,description,share_bp,amount_minor,due_offset_days)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), quotationId, milestone.position, milestone.title, milestone.description,
      milestone.share_bp, milestone.amount_minor, milestone.due_offset_days]);
  }
}

/* ----------------------------------------------------------------- snapshot */

/**
 * The immutable record of what was actually issued. Catalog edits, price
 * changes or a renamed client never rewrite an issued document.
 */
export function buildSnapshot({ kind, number, document, client, business, lines, charges, milestones, totals, place }) {
  return {
    kind,
    number,
    generated_at: new Date().toISOString(),
    document: {
      title: document.title,
      issue_date: document.issue_date,
      expiry_date: document.expiry_date || null,
      due_date: document.due_date || null,
      presentation_date: document.issue_date,
      place_of_supply_state_code: place,
      supply_type: document.supply_type,
      payment_terms_days: document.payment_terms_days,
      payment_terms: document.payment_terms,
      po_reference: document.po_reference,
      project_reference: document.project_reference,
      description: document.description,
      scope_of_work: document.scope_of_work,
      inclusions: document.inclusions,
      exclusions: document.exclusions,
      assumptions: document.assumptions,
      warranty_terms: document.warranty_terms,
      delivery_timeline: document.delivery_timeline,
      notes: document.notes,
      terms: document.terms,
      tax_mode: document.tax_mode || totals.tax_mode || 'EXCLUSIVE',
    },
    client: {
      name: client.name, company_name: client.company_name, contact_person: client.contact_person,
      email: client.email, phone: client.phone, billing_address: client.billing_address,
      service_address: client.service_address, gstin: client.gstin, state_code: client.state_code,
      country: client.country,
    },
    business: {
      business_name: business.business_name, legal_name: business.legal_name, address: business.address,
      email: business.email, phone: business.phone, website: business.website, gstin: business.gstin,
      state_code: business.state_code, pan: business.pan, bank_account_name: business.bank_account_name,
      bank_account_number: business.bank_account_number, bank_ifsc: business.bank_ifsc, bank_name: business.bank_name,
      bank_branch: business.bank_branch, upi_id: business.upi_id, signatory_name: business.signatory_name,
      signatory_title: business.signatory_title, pdf_accent_color: business.pdf_accent_color,
      show_bank_details: business.show_bank_details, show_signatory: business.show_signatory,
      show_amount_in_words: business.show_amount_in_words, reverse_charge: business.reverse_charge,
      terms: business.terms,
    },
    lines: lines.map(line => ({ ...line, tax_mode: line.tax_mode || totals.tax_mode || 'EXCLUSIVE' })),
    charges: charges.map(charge => ({ ...charge })),
    milestones: milestones.map(milestone => ({ ...milestone })),
    // charges_pre_tax keeps the printed totals rows from double-counting charge tax.
    totals: { ...totals, tax_mode: totals.tax_mode || document.tax_mode || 'EXCLUSIVE', charges_pre_tax_minor: charges.reduce((total, charge) => total + charge.amount_minor, 0) },
    amount_in_words: totals.amount_in_words,
  };
}

/* ------------------------------------------------------------- pdf snapshots */

/**
 * Issued documents render from their stored snapshot; drafts render from live
 * rows with a watermark. Either way the PDF is produced from one code path.
 */
export async function quotationSnapshotForRender(db, id) {
  const { quotation, items, milestones, client, business } = await getQuotation(db, id);
  if (quotation.snapshot) return { snapshot: quotation.snapshot, issued: true };
  return { issued: false, snapshot: buildSnapshot({
    kind: 'QUOTATION', number: quotation.quotation_number, document: quotation, client, business,
    lines: items, charges: quotation.additional_charges, milestones, totals: quotation.totals,
    place: quotation.place_of_supply_state_code,
  }) };
}

export async function invoiceSnapshotForRender(db, id) {
  const invoice = (await db.query('SELECT * FROM inv.invoices WHERE id=$1', [id])).rows[0];
  assert(invoice, 404, 'That invoice does not exist.', 'NOT_FOUND');
  const paid = (await db.query('SELECT COALESCE(sum(amount_minor),0)::bigint AS paid FROM inv.payments WHERE invoice_id=$1', [id])).rows[0].paid;
  const grand = invoice.totals.grand_total_minor ?? 0;
  const paymentSummary = { amount_paid_minor: paid, balance_due_minor: grand - paid };
  if (invoice.snapshot) {
    return { snapshot: { ...invoice.snapshot, payment_summary: paymentSummary }, issued: true };
  }
  const items = (await db.query('SELECT * FROM inv.invoice_items WHERE invoice_id=$1 ORDER BY position', [id])).rows;
  const client = (await db.query('SELECT * FROM inv.clients WHERE id=$1', [invoice.client_id])).rows[0];
  const business = await settings(db);
  return { issued: false, snapshot: buildSnapshot({
    kind: 'TAX_INVOICE', number: invoice.invoice_number, document: invoice, client, business,
    lines: items, charges: invoice.additional_charges, milestones: [], totals: invoice.totals,
    place: invoice.place_of_supply_state_code,
  }) };
}

/* --------------------------------------------------------------- quotations */

export async function listQuotations(db, url) {
  const { page, limit, offset } = pagination(url);
  const status = (url.searchParams.get('status') || '').toUpperCase();
  const pattern = `%${escapeLike(searchTerm(url))}%`;
  const client = optionalParam(url, 'client_id');
  const from = optionalParam(url, 'from');
  const to = optionalParam(url, 'to');
  const filters = `
    WHERE ($1 = '' OR CASE WHEN q.status='SENT' AND q.expiry_date IS NOT NULL AND q.expiry_date < CURRENT_DATE
      THEN 'EXPIRED' ELSE q.status END = $1)
      AND ($2::uuid IS NULL OR q.client_id = $2::uuid)
      AND ($3::date IS NULL OR q.issue_date >= $3::date)
      AND ($4::date IS NULL OR q.issue_date <= $4::date)
      AND ($5 = '' OR q.quotation_number ILIKE $5 ESCAPE '!' OR q.title ILIKE $5 ESCAPE '!'
        OR c.name ILIKE $5 ESCAPE '!' OR c.company_name ILIKE $5 ESCAPE '!')`;
  const values = [status, client, from, to, pattern];
  const quotations = (await db.query(`
    SELECT q.id,q.quotation_number,q.status,q.title,q.issue_date,q.expiry_date,q.totals,q.converted_invoice_id,
      c.name AS client_name, c.company_name AS client_company,
      CASE WHEN q.status='SENT' AND q.expiry_date IS NOT NULL AND q.expiry_date < CURRENT_DATE
        THEN 'EXPIRED' ELSE q.status END AS effective_status
    FROM inv.quotations q JOIN inv.clients c ON c.id = q.client_id
    ${filters} ORDER BY q.issue_date DESC, q.created_at DESC LIMIT $6 OFFSET $7`, [...values, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*)::int AS total FROM inv.quotations q
    JOIN inv.clients c ON c.id = q.client_id ${filters}`, values)).rows[0].total;
  return { quotations, total, page, limit };
}

export async function getQuotation(db, id) {
  const quotation = (await db.query('SELECT * FROM inv.quotations WHERE id=$1', [id])).rows[0];
  assert(quotation, 404, 'That quotation does not exist.', 'NOT_FOUND');
  const items = (await db.query('SELECT * FROM inv.quotation_items WHERE quotation_id=$1 ORDER BY position', [id])).rows;
  const milestones = (await db.query('SELECT * FROM inv.quotation_milestones WHERE quotation_id=$1 ORDER BY position', [id])).rows;
  const client = (await db.query('SELECT * FROM inv.clients WHERE id=$1', [quotation.client_id])).rows[0];
  const business = await settings(db);
  const history = (await db.query(`SELECT * FROM inv.document_status_history
    WHERE document_type='QUOTATION' AND document_id=$1 ORDER BY created_at DESC LIMIT 50`, [id])).rows;
  const converted = quotation.converted_invoice_id
    ? (await db.query('SELECT id,invoice_number,status FROM inv.invoices WHERE id=$1', [quotation.converted_invoice_id])).rows[0]
    : null;
  return { quotation, items, milestones, client, business, history, converted_invoice: converted || null };
}

export async function createQuotation(db, actor, input) {
  requireWriter(actor);
  const id = randomUUID();
  await db.transaction(async tx => {
    const { business, client, place, supply_type, warnings } = await resolveSupply(tx, input);
    const tax_mode = input.tax_mode || business.product_price_tax_mode || 'EXCLUSIVE';
    const computed = documentTotals({ ...input, tax_mode }, supply_type, tax_mode);
    const milestones = validateMilestones(input.milestones || [], computed.totals.grand_total_minor);
    await tx.query(`INSERT INTO inv.quotations(id,client_id,status,title,description,scope_of_work,inclusions,exclusions,
        assumptions,warranty_terms,delivery_timeline,notes,terms,issue_date,expiry_date,place_of_supply_state_code,
        supply_type,payment_terms_days,payment_terms,project_reference,invoice_discount_bp,invoice_discount_minor,
        round_off_enabled,tax_mode,additional_charges,totals,created_by)
      VALUES($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [id, input.client_id, input.title, input.description, input.scope_of_work, input.inclusions, input.exclusions,
      input.assumptions, input.warranty_terms, input.delivery_timeline, input.notes, input.terms, input.issue_date,
      input.expiry_date, place, supply_type, input.payment_terms_days, input.payment_terms, input.project_reference,
      input.invoice_discount_bp, input.invoice_discount_minor, input.round_off_enabled, tax_mode,
      JSON.stringify(computed.charges), JSON.stringify(computed.totals), actor.id]);
    await writeItems(tx, 'inv.quotation_items', 'quotation_id', id, computed.lines);
    await writeMilestones(tx, id, milestones);
    await statusChange(tx, { documentType: 'QUOTATION', documentId: id, from: null, to: 'DRAFT', actorId: actor.id });
    await audit(tx, 'QUOTATION_CREATED', { actorId: actor.id, entityType: 'QUOTATION', entityId: id,
      metadata: { client_id: client.id, grand_total_minor: computed.totals.grand_total_minor } });
  });
  return { ...(await getQuotation(db, id)), warnings: [] };
}

export async function updateQuotation(db, actor, id, input) {
  requireWriter(actor);
  await db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.quotations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That quotation does not exist.', 'NOT_FOUND');
    assert(existing.status === 'DRAFT', 409, 'A quotation that has been sent can no longer be edited. Duplicate it instead.', 'NOT_EDITABLE');
    const { place, supply_type } = await resolveSupply(tx, input);
    const tax_mode = input.tax_mode || existing.tax_mode || 'EXCLUSIVE';
    const computed = documentTotals({ ...input, tax_mode }, supply_type, tax_mode);
    const milestones = validateMilestones(input.milestones || [], computed.totals.grand_total_minor);
    await tx.query(`UPDATE inv.quotations SET client_id=$2,title=$3,description=$4,scope_of_work=$5,inclusions=$6,
        exclusions=$7,assumptions=$8,warranty_terms=$9,delivery_timeline=$10,notes=$11,terms=$12,issue_date=$13,
        expiry_date=$14,place_of_supply_state_code=$15,supply_type=$16,payment_terms_days=$17,payment_terms=$18,
        project_reference=$19,invoice_discount_bp=$20,invoice_discount_minor=$21,round_off_enabled=$22,
        tax_mode=$23,additional_charges=$24,totals=$25,updated_at=now() WHERE id=$1`,
    [id, input.client_id, input.title, input.description, input.scope_of_work, input.inclusions, input.exclusions,
      input.assumptions, input.warranty_terms, input.delivery_timeline, input.notes, input.terms, input.issue_date,
      input.expiry_date, place, supply_type, input.payment_terms_days, input.payment_terms, input.project_reference,
      input.invoice_discount_bp, input.invoice_discount_minor, input.round_off_enabled, tax_mode,
      JSON.stringify(computed.charges), JSON.stringify(computed.totals)]);
    await tx.query('DELETE FROM inv.quotation_items WHERE quotation_id=$1', [id]);
    await tx.query('DELETE FROM inv.quotation_milestones WHERE quotation_id=$1', [id]);
    await writeItems(tx, 'inv.quotation_items', 'quotation_id', id, computed.lines);
    await writeMilestones(tx, id, milestones);
    await audit(tx, 'QUOTATION_UPDATED', { actorId: actor.id, entityType: 'QUOTATION', entityId: id,
      metadata: { grand_total_minor: computed.totals.grand_total_minor } });
  });
  return getQuotation(db, id);
}

export async function deleteDraftQuotation(db, actor, id) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.quotations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That quotation does not exist.', 'NOT_FOUND');
    assert(existing.status === 'DRAFT' && !existing.quotation_number, 409,
      'Only unsent drafts can be deleted. Cancel an issued quotation instead.', 'NOT_DELETABLE');
    await tx.query('DELETE FROM inv.quotations WHERE id=$1', [id]);
    await audit(tx, 'QUOTATION_DRAFT_DELETED', { actorId: actor.id, entityType: 'QUOTATION', entityId: id });
    return { deleted: true };
  });
}

/** Sending allocates the number and freezes the commercial terms into a snapshot. */
export async function sendQuotation(db, actor, id) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const quotation = (await tx.query('SELECT * FROM inv.quotations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(quotation, 404, 'That quotation does not exist.', 'NOT_FOUND');
    assert(quotation.status === 'DRAFT', 409, 'This quotation has already been sent.', 'INVALID_TRANSITION');
    const items = (await tx.query('SELECT * FROM inv.quotation_items WHERE quotation_id=$1 ORDER BY position', [id])).rows;
    assert(items.length > 0, 400, 'Add at least one line item before sending.', 'EMPTY_DOCUMENT');
    const business = await settings(tx);
    const client = await loadClient(tx, quotation.client_id);
    const milestones = (await tx.query('SELECT * FROM inv.quotation_milestones WHERE quotation_id=$1 ORDER BY position', [id])).rows;
    const allocated = await allocateNumber(tx, { docType: 'QUOTATION', prefix: business.quotation_prefix, date: quotation.issue_date });
    const snapshot = buildSnapshot({
      kind: 'QUOTATION', number: allocated.number, document: quotation, client, business,
      lines: items, charges: quotation.additional_charges, milestones, totals: quotation.totals,
      place: quotation.place_of_supply_state_code,
    });
    await tx.query(`UPDATE inv.quotations SET quotation_number=$2, financial_year=$3, status='SENT', sent_at=now(),
        snapshot=$4, updated_at=now() WHERE id=$1`, [id, allocated.number, allocated.financial_year, JSON.stringify(snapshot)]);
    await statusChange(tx, { documentType: 'QUOTATION', documentId: id, from: 'DRAFT', to: 'SENT', actorId: actor.id, note: allocated.number });
    await audit(tx, 'QUOTATION_SENT', { actorId: actor.id, entityType: 'QUOTATION', entityId: id,
      metadata: { number: allocated.number } });
    return { ...(await getQuotation(tx, id)), prefix_mismatch: allocated.prefix_mismatch };
  });
}

export async function transitionQuotation(db, actor, id, next, { note = '' } = {}) {
  requireWriter(actor);
  const target = String(next || '').toUpperCase();
  return db.transaction(async tx => {
    const quotation = (await tx.query('SELECT * FROM inv.quotations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(quotation, 404, 'That quotation does not exist.', 'NOT_FOUND');
    assert(QUOTATION_TRANSITIONS[quotation.status]?.includes(target), 409,
      `A quotation in ${quotation.status} cannot move to ${target}.`, 'INVALID_TRANSITION');
    if (target === 'ACCEPTED') {
      assert(quotation.quotation_number, 409, 'Send the quotation before recording acceptance.', 'INVALID_TRANSITION');
    }
    const columns = {
      ACCEPTED: 'accepted_at=now()',
      REJECTED: 'rejected_at=now(), rejection_reason=$3',
      EXPIRED: 'expiry_date=COALESCE(expiry_date, CURRENT_DATE)',
      SENT: 'sent_at=COALESCE(sent_at, now()), rejected_at=NULL, rejection_reason=NULL',
      CANCELLED: 'cancelled_at=now(), cancellation_reason=$3',
    }[target];
    await tx.query(`UPDATE inv.quotations SET status=$2, ${columns}, updated_at=now() WHERE id=$1`,
      target === 'REJECTED' || target === 'CANCELLED' ? [id, target, note] : [id, target]);
    await statusChange(tx, { documentType: 'QUOTATION', documentId: id, from: quotation.status, to: target, note, actorId: actor.id });
    await audit(tx, `QUOTATION_${target}`, { actorId: actor.id, entityType: 'QUOTATION', entityId: id, metadata: { note } });
    return getQuotation(tx, id);
  });
}

export async function duplicateQuotation(db, actor, id) {
  requireWriter(actor);
  const { quotation, items, milestones } = await getQuotation(db, id);
  const input = {
    ...quotation,
    tax_mode: quotation.tax_mode || 'EXCLUSIVE',
    title: `${quotation.title} (copy)`.slice(0, 160),
    items: items.map(toItemInput),
    milestones: milestones.map(m => ({ title: m.title, description: m.description, share_bp: m.share_bp,
      amount_minor: m.amount_minor, due_offset_days: m.due_offset_days })),
    additional_charges: quotation.additional_charges,
    expiry_date: quotation.expiry_date,
  };
  return createQuotation(db, actor, input);
}

const toItemInput = row => ({
  product_id: row.product_id,
  description: row.description,
  category: row.category,
  hsn_sac: row.hsn_sac,
  unit: row.unit,
  quantity_milli: row.quantity_milli,
  unit_price_minor: row.unit_price_minor,
  discount_bp: row.discount_bp,
  discount_minor: row.discount_minor,
  tax_rate_bp: row.tax_rate_bp,
  tax_treatment: row.tax_treatment,
  tax_mode: row.tax_mode || 'EXCLUSIVE',
});

/* ----------------------------------------------------------------- invoices */

export async function listInvoices(db, url) {
  const { page, limit, offset } = pagination(url);
  const status = (url.searchParams.get('status') || '').toUpperCase();
  const payment = (url.searchParams.get('payment_status') || '').toUpperCase();
  const pattern = `%${escapeLike(searchTerm(url))}%`;
  const client = optionalParam(url, 'client_id');
  const from = optionalParam(url, 'from');
  const to = optionalParam(url, 'to');
  const base = `
    FROM inv.invoices i JOIN inv.clients c ON c.id = i.client_id
    LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p
      ON p.invoice_id = i.id
    WHERE ($1 = '' OR i.status = $1)
      AND ($2::uuid IS NULL OR i.client_id = $2::uuid)
      AND ($3::date IS NULL OR i.issue_date >= $3::date)
      AND ($4::date IS NULL OR i.issue_date <= $4::date)
      AND ($5 = '' OR i.invoice_number ILIKE $5 ESCAPE '!' OR i.title ILIKE $5 ESCAPE '!'
        OR c.name ILIKE $5 ESCAPE '!' OR c.company_name ILIKE $5 ESCAPE '!')
      AND ($6 = '' OR (
        CASE
          WHEN i.status IN ('CANCELLED','VOID') THEN i.status
          WHEN COALESCE(p.paid_minor,0) >= (i.totals->>'grand_total_minor')::bigint THEN 'PAID'
          WHEN COALESCE(p.paid_minor,0) > 0 THEN 'PARTIALLY_PAID'
          WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'OVERDUE'
          ELSE 'UNPAID' END) = $6)`;
  const values = [status, client, from, to, pattern, payment];
  const invoices = (await db.query(`
    SELECT i.id,i.invoice_number,i.status,i.title,i.issue_date,i.due_date,i.totals,i.quotation_id,
      c.name AS client_name, c.company_name AS client_company,
      COALESCE(p.paid_minor,0)::bigint AS paid_minor,
      ((i.totals->>'grand_total_minor')::bigint - COALESCE(p.paid_minor,0))::bigint AS balance_due_minor,
      CASE
        WHEN i.status IN ('CANCELLED','VOID') THEN i.status
        WHEN COALESCE(p.paid_minor,0) >= (i.totals->>'grand_total_minor')::bigint THEN 'PAID'
        WHEN COALESCE(p.paid_minor,0) > 0 THEN 'PARTIALLY_PAID'
        WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'OVERDUE'
        ELSE 'UNPAID' END AS payment_status
    ${base} ORDER BY i.issue_date DESC, i.created_at DESC LIMIT $7 OFFSET $8`, [...values, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*)::int AS total ${base}`, values)).rows[0].total;
  return { invoices, total, page, limit };
}

export async function getInvoice(db, id) {
  const invoice = (await db.query('SELECT * FROM inv.invoices WHERE id=$1', [id])).rows[0];
  assert(invoice, 404, 'That invoice does not exist.', 'NOT_FOUND');
  const items = (await db.query('SELECT * FROM inv.invoice_items WHERE invoice_id=$1 ORDER BY position', [id])).rows;
  const payments = (await db.query('SELECT * FROM inv.payments WHERE invoice_id=$1 ORDER BY paid_on, recorded_at', [id])).rows;
  const client = (await db.query('SELECT * FROM inv.clients WHERE id=$1', [invoice.client_id])).rows[0];
  const business = await settings(db);
  const history = (await db.query(`SELECT * FROM inv.document_status_history
    WHERE document_type='INVOICE' AND document_id=$1 ORDER BY created_at DESC LIMIT 50`, [id])).rows;
  const notes = (await db.query('SELECT id,note_number,kind,issue_date,reason,totals FROM inv.adjustment_notes WHERE invoice_id=$1 ORDER BY issue_date', [id])).rows;
  const paid = payments.reduce((total, payment) => total + payment.amount_minor, 0);
  const grand = invoice.totals.grand_total_minor ?? 0;
  const paymentStatus = ['CANCELLED', 'VOID'].includes(invoice.status) ? invoice.status
    : paid >= grand ? (paid > grand ? 'OVERPAID' : 'PAID')
      : paid > 0 ? 'PARTIALLY_PAID'
        : invoice.status === 'ISSUED' && invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10) ? 'OVERDUE'
          : 'UNPAID';
  return { invoice, items, payments, client, business, history, adjustment_notes: notes,
    amount_paid_minor: paid, balance_due_minor: grand - paid, payment_status: paymentStatus };
}

export async function createInvoice(db, actor, input) {
  requireWriter(actor);
  const id = randomUUID();
  await db.transaction(async tx => {
    const { business, place, supply_type } = await resolveSupply(tx, input);
    const tax_mode = input.tax_mode || business.product_price_tax_mode || 'EXCLUSIVE';
    const computed = documentTotals({ ...input, tax_mode }, supply_type, tax_mode);
    await tx.query(`INSERT INTO inv.invoices(id,client_id,status,title,description,scope_of_work,inclusions,exclusions,
        assumptions,warranty_terms,delivery_timeline,notes,terms,issue_date,due_date,place_of_supply_state_code,
        supply_type,payment_terms_days,payment_terms,po_reference,project_reference,invoice_discount_bp,
        invoice_discount_minor,round_off_enabled,tax_mode,additional_charges,totals,created_by)
      VALUES($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
    [id, input.client_id, input.title, input.description, input.scope_of_work, input.inclusions, input.exclusions,
      input.assumptions, input.warranty_terms, input.delivery_timeline, input.notes, input.terms, input.issue_date,
      input.due_date, place, supply_type, input.payment_terms_days, input.payment_terms, input.po_reference,
      input.project_reference, input.invoice_discount_bp, input.invoice_discount_minor, input.round_off_enabled,
      tax_mode, JSON.stringify(computed.charges), JSON.stringify(computed.totals), actor.id]);
    await writeItems(tx, 'inv.invoice_items', 'invoice_id', id, computed.lines);
    await statusChange(tx, { documentType: 'INVOICE', documentId: id, from: null, to: 'DRAFT', actorId: actor.id });
    await audit(tx, 'INVOICE_CREATED', { actorId: actor.id, entityType: 'INVOICE', entityId: id,
      metadata: { client_id: input.client_id, grand_total_minor: computed.totals.grand_total_minor } });
  });
  return getInvoice(db, id);
}

export async function updateInvoice(db, actor, id, input) {
  requireWriter(actor);
  await db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.invoices WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That invoice does not exist.', 'NOT_FOUND');
    assert(existing.status === 'DRAFT', 409, 'An issued invoice cannot be edited. Record a credit note instead.', 'NOT_EDITABLE');
    const { place, supply_type } = await resolveSupply(tx, input);
    const tax_mode = input.tax_mode || existing.tax_mode || 'EXCLUSIVE';
    const computed = documentTotals({ ...input, tax_mode }, supply_type, tax_mode);
    await tx.query(`UPDATE inv.invoices SET client_id=$2,title=$3,description=$4,scope_of_work=$5,inclusions=$6,
        exclusions=$7,assumptions=$8,warranty_terms=$9,delivery_timeline=$10,notes=$11,terms=$12,issue_date=$13,
        due_date=$14,place_of_supply_state_code=$15,supply_type=$16,payment_terms_days=$17,payment_terms=$18,
        po_reference=$19,project_reference=$20,invoice_discount_bp=$21,invoice_discount_minor=$22,
        round_off_enabled=$23,tax_mode=$24,additional_charges=$25,totals=$26,updated_at=now() WHERE id=$1`,
    [id, input.client_id, input.title, input.description, input.scope_of_work, input.inclusions, input.exclusions,
      input.assumptions, input.warranty_terms, input.delivery_timeline, input.notes, input.terms, input.issue_date,
      input.due_date, place, supply_type, input.payment_terms_days, input.payment_terms, input.po_reference,
      input.project_reference, input.invoice_discount_bp, input.invoice_discount_minor, input.round_off_enabled,
      tax_mode, JSON.stringify(computed.charges), JSON.stringify(computed.totals)]);
    await tx.query('DELETE FROM inv.invoice_items WHERE invoice_id=$1', [id]);
    await writeItems(tx, 'inv.invoice_items', 'invoice_id', id, computed.lines);
    await audit(tx, 'INVOICE_UPDATED', { actorId: actor.id, entityType: 'INVOICE', entityId: id,
      metadata: { grand_total_minor: computed.totals.grand_total_minor } });
  });
  return getInvoice(db, id);
}

export async function deleteDraftInvoice(db, actor, id) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.invoices WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That invoice does not exist.', 'NOT_FOUND');
    assert(existing.status === 'DRAFT' && !existing.invoice_number, 409,
      'Only unissued drafts can be deleted. Cancel the invoice instead.', 'NOT_DELETABLE');
    const payments = (await tx.query('SELECT count(*)::int AS total FROM inv.payments WHERE invoice_id=$1', [id])).rows[0].total;
    assert(payments === 0, 409, 'This invoice has recorded payments and cannot be deleted.', 'NOT_DELETABLE');
    // Release the source quotation first: the invoice is still referenced by it.
    if (existing.quotation_id) {
      await tx.query('UPDATE inv.quotations SET converted_invoice_id=NULL, updated_at=now() WHERE id=$1 AND converted_invoice_id=$2',
        [existing.quotation_id, id]);
    }
    await tx.query('DELETE FROM inv.invoices WHERE id=$1', [id]);
    await audit(tx, 'INVOICE_DRAFT_DELETED', { actorId: actor.id, entityType: 'INVOICE', entityId: id });
    return { deleted: true };
  });
}

export async function issueInvoice(db, actor, id) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const invoice = (await tx.query('SELECT * FROM inv.invoices WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(invoice, 404, 'That invoice does not exist.', 'NOT_FOUND');
    assert(invoice.status === 'DRAFT', 409, 'This invoice has already been issued.', 'INVALID_TRANSITION');
    const items = (await tx.query('SELECT * FROM inv.invoice_items WHERE invoice_id=$1 ORDER BY position', [id])).rows;
    assert(items.length > 0, 400, 'Add at least one line item before issuing.', 'EMPTY_DOCUMENT');
    const business = await settings(tx);
    const client = await loadClient(tx, invoice.client_id);
    const dueDate = invoice.due_date || addDays(invoice.issue_date, invoice.payment_terms_days);
    const allocated = await allocateNumber(tx, { docType: 'INVOICE', prefix: business.invoice_prefix, date: invoice.issue_date });
    const snapshot = buildSnapshot({
      kind: 'TAX_INVOICE', number: allocated.number, document: { ...invoice, due_date: dueDate }, client, business,
      lines: items, charges: invoice.additional_charges, milestones: [], totals: invoice.totals,
      place: invoice.place_of_supply_state_code,
    });
    await tx.query(`UPDATE inv.invoices SET invoice_number=$2, financial_year=$3, status='ISSUED', issued_at=now(),
        due_date=$4, snapshot=$5, updated_at=now() WHERE id=$1`,
    [id, allocated.number, allocated.financial_year, dueDate, JSON.stringify(snapshot)]);
    await statusChange(tx, { documentType: 'INVOICE', documentId: id, from: 'DRAFT', to: 'ISSUED', actorId: actor.id, note: allocated.number });
    await audit(tx, 'INVOICE_ISSUED', { actorId: actor.id, entityType: 'INVOICE', entityId: id,
      metadata: { number: allocated.number, grand_total_minor: invoice.totals.grand_total_minor } });
    return { ...(await getInvoice(tx, id)), prefix_mismatch: allocated.prefix_mismatch };
  });
}

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
};

/** Cancelling keeps the number for the audit trail but removes it from receivables. */
export async function cancelInvoice(db, actor, id, reason, { voided = false } = {}) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const invoice = (await tx.query('SELECT * FROM inv.invoices WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(invoice, 404, 'That invoice does not exist.', 'NOT_FOUND');
    assert(['DRAFT', 'ISSUED'].includes(invoice.status), 409, 'This invoice is already cancelled or void.', 'INVALID_TRANSITION');
    const payments = (await tx.query('SELECT count(*)::int AS total FROM inv.payments WHERE invoice_id=$1', [id])).rows[0].total;
    assert(payments === 0, 409, 'This invoice has recorded payments. Issue a credit note instead of cancelling it.', 'PAYMENTS_EXIST');
    const target = invoice.status === 'DRAFT' ? 'CANCELLED' : (voided ? 'VOID' : 'CANCELLED');
    const columns = voided && invoice.status !== 'DRAFT'
      ? 'voided_at=now(), void_reason=$3, status=$2'
      : 'cancelled_at=now(), cancellation_reason=$3, status=$2';
    await tx.query(`UPDATE inv.invoices SET ${columns}, updated_at=now() WHERE id=$1`, [id, target, reason]);
    await statusChange(tx, { documentType: 'INVOICE', documentId: id, from: invoice.status, to: target, note: reason, actorId: actor.id });
    await audit(tx, target === 'VOID' ? 'INVOICE_VOIDED' : 'INVOICE_CANCELLED',
      { actorId: actor.id, entityType: 'INVOICE', entityId: id, metadata: { reason, number: invoice.invoice_number } });
    return getInvoice(tx, id);
  });
}

/* ----------------------------------------------------------------- payments */

export async function recordPayment(db, actor, invoiceId, input) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const invoice = (await tx.query('SELECT * FROM inv.invoices WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
    assert(invoice, 404, 'That invoice does not exist.', 'NOT_FOUND');
    assert(invoice.status === 'ISSUED', 409, 'Record payments against an issued invoice only.', 'INVALID_TRANSITION');
    const paid = (await tx.query('SELECT COALESCE(sum(amount_minor),0)::bigint AS paid FROM inv.payments WHERE invoice_id=$1', [invoiceId])).rows[0].paid;
    const grand = invoice.totals.grand_total_minor;
    const balance = grand - paid;
    assert(input.amount_minor <= balance, 409,
      `The payment exceeds the outstanding balance of ${balance} minor units. Overpayments are not recorded here.`, 'OVERPAYMENT');
    const business = await settings(tx);
    const client = await loadClient(tx, invoice.client_id);
    const allocated = await allocateNumber(tx, { docType: 'PAYMENT_RECEIPT', prefix: business.receipt_prefix, date: input.paid_on });
    const id = randomUUID();
    const snapshot = {
      kind: 'PAYMENT_RECEIPT', number: allocated.number, generated_at: new Date().toISOString(),
      receipt: { paid_on: input.paid_on, method: input.method, reference: input.reference, notes: input.notes },
      amount_minor: input.amount_minor, amount_in_words: amountInWords(input.amount_minor),
      invoice: { id: invoice.id, number: invoice.invoice_number, issue_date: invoice.issue_date, due_date: invoice.due_date,
        grand_total_minor: grand, supply_type: invoice.supply_type },
      paid_to_date_minor: paid + input.amount_minor, balance_due_minor: balance - input.amount_minor,
      client, business: { business_name: business.business_name, address: business.address, email: business.email,
        phone: business.phone, website: business.website, gstin: business.gstin, pan: business.pan,
        signatory_name: business.signatory_name, signatory_title: business.signatory_title,
        pdf_accent_color: business.pdf_accent_color, bank_account_name: business.bank_account_name,
        bank_account_number: business.bank_account_number, bank_ifsc: business.bank_ifsc, bank_name: business.bank_name,
        upi_id: business.upi_id, show_signatory: business.show_signatory },
    };
    await tx.query(`INSERT INTO inv.payments(id,receipt_number,financial_year,invoice_id,amount_minor,paid_on,method,reference,notes,snapshot,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, allocated.number, allocated.financial_year, invoiceId, input.amount_minor, input.paid_on, input.method,
      input.reference, input.notes, JSON.stringify(snapshot), actor.id]);
    const status = paid + input.amount_minor >= grand ? 'PAID' : 'PARTIALLY_PAID';
    await statusChange(tx, { documentType: 'INVOICE', documentId: invoiceId, from: invoice.status, to: status,
      note: `${allocated.number} for ${input.amount_minor} minor units`, actorId: actor.id });
    await audit(tx, 'PAYMENT_RECORDED', { actorId: actor.id, entityType: 'INVOICE', entityId: invoiceId,
      metadata: { receipt_number: allocated.number, amount_minor: input.amount_minor, method: input.method } });
    return { ...(await getInvoice(tx, invoiceId)), receipt: { id, number: allocated.number, snapshot } };
  });
}

export async function listPayments(db, url) {
  const { page, limit, offset } = pagination(url);
  const pattern = `%${escapeLike(searchTerm(url))}%`;
  const from = optionalParam(url, 'from');
  const to = optionalParam(url, 'to');
  const filters = `WHERE ($1::date IS NULL OR p.paid_on >= $1::date) AND ($2::date IS NULL OR p.paid_on <= $2::date)
      AND ($3 = '' OR p.receipt_number ILIKE $3 ESCAPE '!' OR i.invoice_number ILIKE $3 ESCAPE '!'
        OR c.name ILIKE $3 ESCAPE '!' OR c.company_name ILIKE $3 ESCAPE '!' OR p.reference ILIKE $3 ESCAPE '!')`;
  const values = [from, to, pattern];
  const payments = (await db.query(`
    SELECT p.id,p.receipt_number,p.amount_minor,p.paid_on,p.method,p.reference,p.notes,
      i.id AS invoice_id, i.invoice_number, c.name AS client_name, c.company_name AS client_company
    FROM inv.payments p JOIN inv.invoices i ON i.id = p.invoice_id JOIN inv.clients c ON c.id = i.client_id
    ${filters} ORDER BY p.paid_on DESC, p.recorded_at DESC LIMIT $4 OFFSET $5`, [...values, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*)::int AS total FROM inv.payments p
    JOIN inv.invoices i ON i.id = p.invoice_id JOIN inv.clients c ON c.id = i.client_id ${filters}`, values)).rows[0].total;
  const collected = (await db.query(`SELECT COALESCE(sum(p.amount_minor),0)::bigint AS collected FROM inv.payments p
    JOIN inv.invoices i ON i.id = p.invoice_id JOIN inv.clients c ON c.id = i.client_id ${filters}`, values)).rows[0].collected;
  return { payments, total, page, limit, collected_minor: collected };
}

export async function getPayment(db, id) {
  const payment = (await db.query(`SELECT p.*, i.invoice_number, i.client_id FROM inv.payments p
    JOIN inv.invoices i ON i.id = p.invoice_id WHERE p.id=$1`, [id])).rows[0];
  assert(payment, 404, 'That payment does not exist.', 'NOT_FOUND');
  return payment;
}

/* ------------------------------------------------------ credit / debit notes */

export async function createAdjustmentNote(db, actor, invoiceId, input) {
  requireWriter(actor);
  const kind = input.kind === 'DEBIT' ? 'DEBIT' : 'CREDIT';
  return db.transaction(async tx => {
    const invoice = (await tx.query('SELECT * FROM inv.invoices WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
    assert(invoice, 404, 'That invoice does not exist.', 'NOT_FOUND');
    assert(invoice.status === 'ISSUED', 409, 'Adjustment notes apply to issued invoices only.', 'INVALID_TRANSITION');
    assert(input.items.length > 0, 400, 'Add at least one line to the note.', 'EMPTY_DOCUMENT');
    const business = await settings(tx);
    const client = await loadClient(tx, invoice.client_id);
    const tax_mode = input.tax_mode || invoice.tax_mode || 'EXCLUSIVE';
    const computed = documentTotals({
      items: input.items, additional_charges: [], invoice_discount_bp: 0, invoice_discount_minor: 0,
      round_off_enabled: false, tax_mode,
    }, invoice.supply_type, tax_mode);
    const previous = (await tx.query(`SELECT COALESCE(sum((totals->>'grand_total_minor')::bigint),0)::bigint AS total
      FROM inv.adjustment_notes WHERE invoice_id=$1 AND kind=$2`, [invoiceId, kind])).rows[0].total;
    const grand = invoice.totals.grand_total_minor;
    assert(previous + computed.totals.grand_total_minor <= grand, 409,
      'The total of credit notes cannot exceed the invoice amount.', 'NOTE_EXCEEDS_INVOICE');
    const docType = kind === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE';
    const prefix = kind === 'CREDIT' ? business.credit_note_prefix : business.credit_note_prefix.replace(/CRN|CN/, 'DBN');
    const allocated = await allocateNumber(tx, { docType, prefix, date: input.issue_date });
    const id = randomUUID();
    const totals = { ...computed.totals, amount_in_words: amountInWords(computed.totals.grand_total_minor) };
    const snapshot = buildSnapshot({
      kind: docType, number: allocated.number,
      document: { ...invoice, title: `${kind === 'CREDIT' ? 'Credit Note' : 'Debit Note'} against ${invoice.invoice_number}`,
        issue_date: input.issue_date, due_date: null, expiry_date: null, notes: input.notes, terms: input.reason, tax_mode },
      client, business, lines: computed.lines, charges: [], milestones: [], totals,
      place: invoice.place_of_supply_state_code,
    });
    await tx.query(`INSERT INTO inv.adjustment_notes(id,note_number,financial_year,kind,invoice_id,client_id,issue_date,
        reason,notes,place_of_supply_state_code,supply_type,tax_mode,totals,snapshot,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, allocated.number, allocated.financial_year, kind, invoiceId, invoice.client_id, input.issue_date,
      input.reason, input.notes, invoice.place_of_supply_state_code, invoice.supply_type, tax_mode,
      JSON.stringify(totals), JSON.stringify(snapshot), actor.id]);
    for (const [index, line] of computed.lines.entries()) {
      await tx.query(`INSERT INTO inv.adjustment_note_items(id,note_id,position,description,hsn_sac,unit,quantity_milli,
          unit_price_minor,tax_rate_bp,tax_treatment,taxable_minor,cgst_minor,sgst_minor,igst_minor,tax_minor,total_minor,tax_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [randomUUID(), id, index, line.description, line.hsn_sac, line.unit, line.quantity_milli, line.unit_price_minor,
        line.tax_rate_bp, line.tax_treatment, line.taxable_minor, line.cgst_minor, line.sgst_minor, line.igst_minor,
        line.tax_minor, line.total_minor, line.tax_mode || tax_mode]);
    }
    await statusChange(tx, { documentType: docType, documentId: id, from: null, to: 'ISSUED', note: input.reason, actorId: actor.id });
    await audit(tx, `${docType}_ISSUED`, { actorId: actor.id, entityType: docType, entityId: id,
      metadata: { invoice_id: invoiceId, number: allocated.number, grand_total_minor: totals.grand_total_minor } });
    return getAdjustmentNote(tx, id);
  });
}

export async function getAdjustmentNote(db, id) {
  const note = (await db.query('SELECT * FROM inv.adjustment_notes WHERE id=$1', [id])).rows[0];
  assert(note, 404, 'That note does not exist.', 'NOT_FOUND');
  const items = (await db.query('SELECT * FROM inv.adjustment_note_items WHERE note_id=$1 ORDER BY position', [id])).rows;
  const invoice = (await db.query('SELECT id,invoice_number,issue_date,totals FROM inv.invoices WHERE id=$1', [note.invoice_id])).rows[0];
  const client = (await db.query('SELECT * FROM inv.clients WHERE id=$1', [note.client_id])).rows[0];
  return { note, items, invoice, client, business: await settings(db) };
}

export async function listAdjustmentNotes(db, url) {
  const { page, limit, offset } = pagination(url);
  const kind = ['', 'CREDIT', 'DEBIT'].includes((url.searchParams.get('kind') || '').toUpperCase())
    ? (url.searchParams.get('kind') || '').toUpperCase() : '';
  const filters = `WHERE ($1 = '' OR n.kind = $1) AND ($2 = '' OR n.note_number ILIKE $2 ESCAPE '!' OR i.invoice_number ILIKE $2 ESCAPE '!' OR c.name ILIKE $2 ESCAPE '!')`;
  const values = [kind, `%${escapeLike(searchTerm(url))}%`];
  const notes = (await db.query(`
    SELECT n.id,n.note_number,n.kind,n.issue_date,n.reason,n.totals,i.invoice_number,i.id AS invoice_id,
      c.name AS client_name FROM inv.adjustment_notes n
    JOIN inv.invoices i ON i.id = n.invoice_id JOIN inv.clients c ON c.id = n.client_id
    ${filters} ORDER BY n.issue_date DESC, n.created_at DESC LIMIT $3 OFFSET $4`, [...values, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*)::int AS total FROM inv.adjustment_notes n
    JOIN inv.invoices i ON i.id = n.invoice_id JOIN inv.clients c ON c.id = n.client_id ${filters}`, values)).rows[0].total;
  return { notes, total, page, limit };
}
