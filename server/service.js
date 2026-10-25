import { randomUUID } from 'node:crypto';
import { assert, HttpError } from './domain.js';
import { audit } from './audit.js';
import { canManageSettings, canWrite, hash } from './auth.js';
import { gstinChecksumValid, gstinStateCode } from './gst.js';

const PAGE_SIZE = 25;
const escapeLike = value => value.replace(/[!%_]/g, '!$&');

export const settings = async db => (await db.query('SELECT * FROM inv.business_settings WHERE id=true')).rows[0];

export function requireWriter(actor) {
  assert(canWrite(actor), 403, 'Your role cannot modify financial records.', 'FORBIDDEN');
}

export function requireManager(actor) {
  assert(canManageSettings(actor), 403, 'Only the owner or an administrator can change this.', 'FORBIDDEN');
}

export function pagination(url) {
  const page = Number(url.searchParams.get('page') || 1);
  assert(Number.isInteger(page) && page >= 1 && page <= 100000, 400, 'Invalid page number.', 'VALIDATION_ERROR');
  const limitParam = Number(url.searchParams.get('limit') || PAGE_SIZE);
  const limit = Number.isInteger(limitParam) && limitParam >= 1 && limitParam <= 100 ? limitParam : PAGE_SIZE;
  return { page, limit, offset: (page - 1) * limit };
}

export const searchTerm = url => (url.searchParams.get('search') || '').trim().slice(0, 100);

/* ------------------------------------------------------------------ clients */

/** Duplicate detection warns the operator; it never blocks a legitimate record. */
export async function clientWarnings(db, { name, company_name = '', email = '', gstin = '', state_code = '', exclude_id = null }) {
  // Ranked by how strongly each candidate matches, so the most likely duplicate
  // surfaces first even when many records share a company name.
  const { rows } = await db.query(`
    SELECT id, name, company_name, email, gstin,
      (CASE WHEN length($4) > 0 AND gstin = $4 THEN 3 ELSE 0 END
        + CASE WHEN length($1) > 0 AND lower(name) = lower($1) THEN 2 ELSE 0 END
        + CASE WHEN length($2) > 0 AND lower(company_name) = lower($2) THEN 1 ELSE 0 END
        + CASE WHEN length($3) > 0 AND email = lower($3) THEN 1 ELSE 0 END) AS relevance
    FROM inv.clients
    WHERE id <> COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ((length($1) > 0 AND lower(name) = lower($1))
        OR (length($2) > 0 AND lower(company_name) = lower($2))
        OR (length($3) > 0 AND email = lower($3))
        OR (length($4) > 0 AND gstin = $4))
    ORDER BY relevance DESC, created_at ASC
    LIMIT 5`, [name || '', company_name, email, gstin, exclude_id]);
  const notes = [];
  if (rows.some(row => gstin && row.gstin === gstin)) notes.push('Another client already uses this GSTIN.');
  if (rows.length) notes.push(`A similar client exists: ${rows.map(row => row.name).join(', ')}.`);
  // Format and check digit are advisory only: they are not proof of GST registration.
  if (gstin && !gstinChecksumValid(gstin)) notes.push('The GSTIN format is valid but its check digit does not match - please confirm it with the client.');
  const embedded = gstinStateCode(gstin);
  if (embedded && state_code && embedded !== state_code) {
    notes.push(`The GSTIN starts with state code ${embedded}, but the client state code is ${state_code}.`);
  }
  return { duplicates: rows, warnings: notes };
}

export async function listClients(db, url) {
  const { page, limit, offset } = pagination(url);
  const status = ['', 'ACTIVE', 'ARCHIVED'].includes(url.searchParams.get('status') || '') ? url.searchParams.get('status') || '' : '';
  const term = escapeLike(searchTerm(url));
  const pattern = `%${term}%`;
  const values = [status, pattern, limit, offset];
  const rows = (await db.query(`
    SELECT c.*,
      (SELECT count(*) FROM inv.quotations q WHERE q.client_id = c.id)::int AS quotation_count,
      (SELECT count(*) FROM inv.invoices i WHERE i.client_id = c.id)::int AS invoice_count,
      (SELECT COALESCE(sum((i.totals->>'grand_total_minor')::bigint),0) FROM inv.invoices i
        WHERE i.client_id = c.id AND i.status = 'ISSUED')::bigint AS invoiced_minor,
      (SELECT COALESCE(sum(p.amount_minor),0) FROM inv.payments p JOIN inv.invoices i ON i.id = p.invoice_id
        WHERE i.client_id = c.id)::bigint AS collected_minor
    FROM inv.clients c
    WHERE ($1 = '' OR c.status = $1)
      AND ($2 = '' OR c.name ILIKE $2 ESCAPE '!' OR c.company_name ILIKE $2 ESCAPE '!'
        OR c.email ILIKE $2 ESCAPE '!' OR c.contact_person ILIKE $2 ESCAPE '!' OR c.gstin ILIKE $2 ESCAPE '!')
    ORDER BY lower(c.name) LIMIT $3 OFFSET $4`, values)).rows;
  const total = (await db.query(`
    SELECT count(*)::int AS total FROM inv.clients c
    WHERE ($1 = '' OR c.status = $1)
      AND ($2 = '' OR c.name ILIKE $2 ESCAPE '!' OR c.company_name ILIKE $2 ESCAPE '!'
        OR c.email ILIKE $2 ESCAPE '!' OR c.contact_person ILIKE $2 ESCAPE '!' OR c.gstin ILIKE $2 ESCAPE '!')`,
  [values[0], pattern])).rows[0].total;
  return { clients: rows, total, page, limit };
}

export async function getClient(db, id) {
  const client = (await db.query('SELECT * FROM inv.clients WHERE id=$1', [id])).rows[0];
  assert(client, 404, 'That client does not exist.', 'NOT_FOUND');
  const quotations = (await db.query(`SELECT id,quotation_number,status,title,issue_date,expiry_date,totals,
      CASE WHEN status='SENT' AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE status END AS effective_status
    FROM inv.quotations WHERE client_id=$1 ORDER BY issue_date DESC, created_at DESC LIMIT 20`, [id])).rows;
  const invoices = (await db.query(`
    SELECT i.id,i.invoice_number,i.status,i.title,i.issue_date,i.due_date,i.totals,
      COALESCE(p.paid_minor,0)::bigint AS paid_minor,
      ((i.totals->>'grand_total_minor')::bigint - COALESCE(p.paid_minor,0))::bigint AS balance_due_minor,
      CASE
        WHEN i.status IN ('CANCELLED','VOID') THEN i.status
        WHEN COALESCE(p.paid_minor,0) >= (i.totals->>'grand_total_minor')::bigint THEN 'PAID'
        WHEN COALESCE(p.paid_minor,0) > 0 THEN 'PARTIALLY_PAID'
        WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'OVERDUE'
        ELSE 'UNPAID' END AS payment_status
    FROM inv.invoices i
    LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p ON p.invoice_id = i.id
    WHERE i.client_id=$1 ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 20`, [id])).rows;
  return { client, quotations, invoices };
}

export async function createClient(db, actor, input) {
  requireWriter(actor);
  const id = randomUUID();
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO inv.clients(id,kind,name,company_name,contact_person,email,phone,billing_address,
        service_address,gstin,state_code,country,notes,payment_terms_days,gst_registered,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, input.kind, input.name, input.company_name, input.contact_person, input.email, input.phone,
      input.billing_address, input.service_address, input.gstin, input.state_code, input.country,
      input.notes, input.payment_terms_days, input.gst_registered, actor.id]);
    await audit(tx, 'CLIENT_CREATED', { actorId: actor.id, entityType: 'CLIENT', entityId: id, metadata: { name: input.name } });
  });
  return (await db.query('SELECT * FROM inv.clients WHERE id=$1', [id])).rows[0];
}

export async function updateClient(db, actor, id, input) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.clients WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That client does not exist.', 'NOT_FOUND');
    await tx.query(`UPDATE inv.clients SET kind=$2,name=$3,company_name=$4,contact_person=$5,email=$6,phone=$7,
        billing_address=$8,service_address=$9,gstin=$10,state_code=$11,country=$12,notes=$13,
        payment_terms_days=$14,gst_registered=$15,updated_at=now() WHERE id=$1`,
    [id, input.kind, input.name, input.company_name, input.contact_person, input.email, input.phone,
      input.billing_address, input.service_address, input.gstin, input.state_code, input.country,
      input.notes, input.payment_terms_days, input.gst_registered]);
    await audit(tx, 'CLIENT_UPDATED', { actorId: actor.id, entityType: 'CLIENT', entityId: id });
    return (await tx.query('SELECT * FROM inv.clients WHERE id=$1', [id])).rows[0];
  });
}

/** Clients are archived, never deleted - their documents must stay readable. */
export async function setClientStatus(db, actor, id, status) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.clients WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That client does not exist.', 'NOT_FOUND');
    await tx.query('UPDATE inv.clients SET status=$2, updated_at=now() WHERE id=$1', [id, status]);
    await audit(tx, status === 'ARCHIVED' ? 'CLIENT_ARCHIVED' : 'CLIENT_RESTORED', { actorId: actor.id, entityType: 'CLIENT', entityId: id });
    return (await tx.query('SELECT * FROM inv.clients WHERE id=$1', [id])).rows[0];
  });
}

/* ------------------------------------------------------------------ catalog */

export async function listProducts(db, url) {
  const { page, limit, offset } = pagination(url);
  const status = ['', 'ACTIVE', 'ARCHIVED'].includes(url.searchParams.get('status') || '') ? url.searchParams.get('status') || '' : '';
  const category = (url.searchParams.get('category') || '').trim().slice(0, 80);
  const pattern = `%${escapeLike(searchTerm(url))}%`;
  const rows = (await db.query(`
    SELECT * FROM inv.products
    WHERE ($1 = '' OR status = $1) AND ($2 = '' OR category = $2)
      AND ($3 = '' OR name ILIKE $3 ESCAPE '!' OR sku ILIKE $3 ESCAPE '!' OR description ILIKE $3 ESCAPE '!')
    ORDER BY status, lower(name) LIMIT $4 OFFSET $5`, [status, category, pattern, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*)::int AS total FROM inv.products
    WHERE ($1 = '' OR status = $1) AND ($2 = '' OR category = $2)
      AND ($3 = '' OR name ILIKE $3 ESCAPE '!' OR sku ILIKE $3 ESCAPE '!' OR description ILIKE $3 ESCAPE '!')`,
  [status, category, pattern])).rows[0].total;
  const categories = (await db.query('SELECT DISTINCT category FROM inv.products WHERE category <> \'\' ORDER BY category')).rows.map(r => r.category);
  return { products: rows, total, page, limit, categories };
}

export async function createProduct(db, actor, input) {
  requireWriter(actor);
  const id = randomUUID();
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO inv.products(id,name,sku,description,category,unit,unit_price_minor,tax_treatment,
        tax_rate_bp,tax_mode,hsn_sac,status,billing_interval,license_duration_months,validity_notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, input.name, input.sku, input.description, input.category, input.unit, input.unit_price_minor,
      input.tax_treatment, input.tax_rate_bp, input.tax_mode || null, input.hsn_sac, input.status, input.billing_interval,
      input.license_duration_months, input.validity_notes, actor.id]);
    await audit(tx, 'PRODUCT_CREATED', { actorId: actor.id, entityType: 'PRODUCT', entityId: id, metadata: { name: input.name } });
  });
  return (await db.query('SELECT * FROM inv.products WHERE id=$1', [id])).rows[0];
}

export async function updateProduct(db, actor, id, input) {
  requireWriter(actor);
  return db.transaction(async tx => {
    const existing = (await tx.query('SELECT * FROM inv.products WHERE id=$1 FOR UPDATE', [id])).rows[0];
    assert(existing, 404, 'That catalog entry does not exist.', 'NOT_FOUND');
    await tx.query(`UPDATE inv.products SET name=$2,sku=$3,description=$4,category=$5,unit=$6,unit_price_minor=$7,
        tax_treatment=$8,tax_rate_bp=$9,tax_mode=$10,hsn_sac=$11,status=$12,billing_interval=$13,license_duration_months=$14,
        validity_notes=$15,updated_at=now() WHERE id=$1`,
    [id, input.name, input.sku, input.description, input.category, input.unit, input.unit_price_minor,
      input.tax_treatment, input.tax_rate_bp, input.tax_mode || null, input.hsn_sac, input.status, input.billing_interval,
      input.license_duration_months, input.validity_notes]);
    await audit(tx, 'PRODUCT_UPDATED', { actorId: actor.id, entityType: 'PRODUCT', entityId: id });
    return (await tx.query('SELECT * FROM inv.products WHERE id=$1', [id])).rows[0];
  });
}

/* ----------------------------------------------------------------- settings */

export async function updateSettings(db, actor, input) {
  requireManager(actor);
  return db.transaction(async tx => {
    await tx.query(`UPDATE inv.business_settings SET
        business_name=$1, legal_name=$2, address=$3, email=$4, phone=$5, website=$6, gstin=$7, state_code=$8, pan=$9,
        bank_account_name=$10, bank_account_number=$11, bank_ifsc=$12, bank_name=$13, bank_branch=$14, upi_id=$15,
        signatory_name=$16, signatory_title=$17, default_quotation_validity_days=$18, default_payment_terms_days=$19,
        default_currency=$20, rounding_mode=$21, product_price_tax_mode=$22, default_tax_rate_bp=$23, reverse_charge=$24, quotation_prefix=$25,
        invoice_prefix=$26, receipt_prefix=$27, credit_note_prefix=$28, terms=$29, quotation_terms=$30,
        pdf_accent_color=$31, show_bank_details=$32, show_signatory=$33, show_amount_in_words=$34,
        influencer_contract_prefix=COALESCE($35, 'NC/INF'),
        updated_at=now(), updated_by=$36 WHERE id=true`,
    [input.business_name, input.legal_name, input.address, input.email, input.phone, input.website, input.gstin,
      input.state_code, input.pan, input.bank_account_name, input.bank_account_number, input.bank_ifsc,
      input.bank_name, input.bank_branch, input.upi_id, input.signatory_name, input.signatory_title,
      input.default_quotation_validity_days, input.default_payment_terms_days, input.default_currency,
      input.rounding_mode, input.product_price_tax_mode || 'EXCLUSIVE', input.default_tax_rate_bp, input.reverse_charge, input.quotation_prefix,
      input.invoice_prefix, input.receipt_prefix, input.credit_note_prefix, input.terms, input.quotation_terms,
      input.pdf_accent_color, input.show_bank_details, input.show_signatory, input.show_amount_in_words,
      input.influencer_contract_prefix || 'NC/INF', actor.id]);
    await audit(tx, 'SETTINGS_UPDATED', { actorId: actor.id, entityType: 'SETTINGS',
      metadata: { gstin_set: input.gstin.length > 0, business_name: input.business_name } });
    return (await tx.query('SELECT * FROM inv.business_settings WHERE id=true')).rows[0];
  });
}

/** The logo is validated as a real PNG with sane dimensions before it is stored. */
export async function saveLogo(db, actor, base64) {
  requireManager(actor);
  const bytes = Buffer.from(String(base64).replace(/^data:image\/png;base64,/, ''), 'base64');
  assert(bytes.length >= 24 && bytes.length <= 512000, 413, 'The logo must be a PNG of at most 500 KB.', 'INVALID_UPLOAD');
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 415, 'The logo must be a valid PNG file.', 'INVALID_UPLOAD');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert(width >= 40 && height >= 20 && width <= 2000 && height <= 2000, 400, 'The logo dimensions are out of range.', 'INVALID_UPLOAD');
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO inv.company_assets(name,png,sha256,updated_by,updated_at) VALUES('company_logo',$1,$2,$3,now())
      ON CONFLICT(name) DO UPDATE SET png=EXCLUDED.png, sha256=EXCLUDED.sha256, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [bytes, hash(bytes.toString('base64')), actor.id]);
    await tx.query(`INSERT INTO inv.brand_assets(name,png,sha256,mime_type,width,height,updated_by,updated_at)
      VALUES('company_logo',$1,$2,'image/png',$3,$4,$5,now())
      ON CONFLICT(name) DO UPDATE SET png=EXCLUDED.png, sha256=EXCLUDED.sha256, mime_type=EXCLUDED.mime_type,
        width=EXCLUDED.width, height=EXCLUDED.height, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [bytes, hash(bytes.toString('base64')), width, height, actor.id]).catch(() => {});
    await audit(tx, 'LOGO_UPDATED', { actorId: actor.id, entityType: 'SETTINGS', metadata: { bytes: bytes.length, width, height } });
  });
  return { width, height, bytes: bytes.length };
}

export async function logoBytes(db) {
  const brandRow = (await db.query("SELECT png FROM inv.brand_assets WHERE name='company_logo'").catch(() => ({ rows: [] }))).rows[0];
  if (brandRow?.png) return brandRow.png;
  const row = (await db.query("SELECT png FROM inv.company_assets WHERE name='company_logo'")).rows[0];
  return row?.png || null;
}

export { HttpError };
