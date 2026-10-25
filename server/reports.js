import { pagination, searchTerm } from './service.js';
import { resolveDatePreset, DATE_PRESETS, parseIsoDate } from './date-presets.js';
import { assert, HttpError } from './domain.js';

const escapeLike = value => value.replace(/[!%_]/g, '!$&');
// An omitted range becomes SQL NULL, never an empty string.
const range = url => ({
  from: (url.searchParams.get('from') || '').trim() || null,
  to: (url.searchParams.get('to') || '').trim() || null,
});

/**
 * Defaults to the current Indian financial year. Every number below is read from
 * stored records - nothing is hardcoded and nothing is estimated.
 */
const BOUNDS = `WITH bounds AS (
  SELECT COALESCE($1::date, CASE WHEN extract(month FROM CURRENT_DATE) >= 4
      THEN make_date(extract(year FROM CURRENT_DATE)::int, 4, 1)
      ELSE make_date(extract(year FROM CURRENT_DATE)::int - 1, 4, 1) END) AS from_date,
    COALESCE($2::date, CURRENT_DATE) AS to_date)`;

const balanceExpr = (invAlias = 'i', payAlias = 'p') =>
  `(((${invAlias}.totals->>'grand_total_minor')::bigint - COALESCE(${payAlias}.paid_minor,0))::bigint)`;
const BALANCE = balanceExpr('i', 'p');

export async function dashboard(db, url) {
  const { from, to } = range(url);
  const params = [from, to];
  const [invoiced, collected, receivables, overdue, quotationSummary, converted, monthCollected, recentInvoices,
    recentQuotations, upcoming] = await Promise.all([
    db.query(`${BOUNDS} SELECT COALESCE(sum((i.totals->>'grand_total_minor')::bigint),0)::bigint AS total,
        count(*)::int AS count FROM inv.invoices i, bounds
      WHERE i.status='ISSUED' AND i.issue_date BETWEEN bounds.from_date AND bounds.to_date
        AND i.issue_date >= bounds.from_date AND i.issue_date <= bounds.to_date`, params),
    db.query(`${BOUNDS} SELECT COALESCE(sum(p.amount_minor),0)::bigint AS total, count(*)::int AS count
      FROM inv.payments p, bounds WHERE p.paid_on BETWEEN bounds.from_date AND bounds.to_date`, params),
    db.query(`SELECT COALESCE(sum(${BALANCE}),0)::bigint AS total, count(*)::int AS count
      FROM inv.invoices i LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p
        ON p.invoice_id = i.id
      WHERE i.status='ISSUED' AND ${BALANCE} > 0`),
    db.query(`SELECT COALESCE(sum(${BALANCE}),0)::bigint AS total, count(*)::int AS count
      FROM inv.invoices i LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p
        ON p.invoice_id = i.id
      WHERE i.status='ISSUED' AND ${BALANCE} > 0 AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE`),
    db.query(`SELECT
        count(*) FILTER (WHERE status='DRAFT')::int AS draft,
        count(*) FILTER (WHERE status='SENT' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE))::int AS awaiting_response,
        count(*) FILTER (WHERE status='SENT' AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE)::int AS expired,
        count(*) FILTER (WHERE status='ACCEPTED')::int AS accepted,
        count(*) FILTER (WHERE status='REJECTED')::int AS rejected,
        count(*) FILTER (WHERE status='CANCELLED')::int AS cancelled FROM inv.quotations`),
    db.query(`SELECT count(*)::int AS converted FROM inv.quotations WHERE converted_invoice_id IS NOT NULL`),
    db.query(`SELECT COALESCE(sum(amount_minor),0)::bigint AS total FROM inv.payments
      WHERE paid_on >= date_trunc('month', CURRENT_DATE)::date AND paid_on <= CURRENT_DATE`),
    db.query(`SELECT i.id,i.invoice_number,i.status,i.issue_date,i.due_date,i.totals,c.name AS client_name,
        COALESCE(p.paid_minor,0)::bigint AS paid_minor, ${BALANCE} AS balance_due_minor
      FROM inv.invoices i JOIN inv.clients c ON c.id=i.client_id
      LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p ON p.invoice_id=i.id
      ORDER BY i.created_at DESC LIMIT 6`),
    db.query(`SELECT q.id,q.quotation_number,q.status,q.title,q.issue_date,q.expiry_date,q.totals,q.converted_invoice_id,
        c.name AS client_name,
        CASE WHEN q.status='SENT' AND q.expiry_date IS NOT NULL AND q.expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE q.status END AS effective_status
      FROM inv.quotations q JOIN inv.clients c ON c.id=q.client_id ORDER BY q.created_at DESC LIMIT 6`),
    db.query(`SELECT i.id,i.invoice_number,i.due_date,c.name AS client_name, ${BALANCE} AS balance_due_minor
      FROM inv.invoices i JOIN inv.clients c ON c.id=i.client_id
      LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p ON p.invoice_id=i.id
      WHERE i.status='ISSUED' AND ${BALANCE} > 0 AND i.due_date IS NOT NULL
        AND i.due_date >= CURRENT_DATE AND i.due_date <= CURRENT_DATE + 30
      ORDER BY i.due_date LIMIT 8`),
  ]);

  const quotations = quotationSummary.rows[0];
  const decided = quotations.accepted + quotations.rejected;
  return {
    range: { from: from || 'current financial year', to: to || 'today' },
    invoiced: { total_minor: invoiced.rows[0].total, count: invoiced.rows[0].count },
    collected: { total_minor: collected.rows[0].total, count: collected.rows[0].count },
    // An invoice is never counted as collected money and a quotation is never counted as revenue.
    outstanding: { total_minor: receivables.rows[0].total, count: receivables.rows[0].count },
    overdue: { total_minor: overdue.rows[0].total, count: overdue.rows[0].count },
    quotations: { ...quotations, converted: converted.rows[0].converted,
      conversion_rate_bp: decided ? Math.round((quotations.accepted / decided) * 10000) : 0 },
    collected_this_month_minor: monthCollected.rows[0].total,
    recent_invoices: recentInvoices.rows,
    recent_quotations: recentQuotations.rows,
    upcoming_dues: upcoming.rows,
  };
}

/* ------------------------------------------------------------------ reports */

export async function invoiceRegister(db, url) {
  const { from, to } = range(url);
  const status = (url.searchParams.get('status') || '').toUpperCase();
  const client = (url.searchParams.get('client_id') || '').trim() || null;
  const rows = (await db.query(`
    SELECT i.invoice_number, i.issue_date, i.due_date, i.status, i.client_id,
      c.name AS client_name, c.gstin AS client_gstin,
      (i.totals->>'taxable_total_minor')::bigint AS taxable_minor,
      (i.totals->>'cgst_total_minor')::bigint AS cgst_minor,
      (i.totals->>'sgst_total_minor')::bigint AS sgst_minor,
      (i.totals->>'igst_total_minor')::bigint AS igst_minor,
      (i.totals->>'grand_total_minor')::bigint AS grand_total_minor,
      COALESCE(p.paid_minor,0)::bigint AS paid_minor,
      ${BALANCE} AS balance_due_minor,
      CASE
        WHEN i.status IN ('CANCELLED','VOID') THEN i.status
        WHEN COALESCE(p.paid_minor,0) >= (i.totals->>'grand_total_minor')::bigint THEN 'PAID'
        WHEN COALESCE(p.paid_minor,0) > 0 THEN 'PARTIALLY_PAID'
        WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'OVERDUE'
        ELSE 'UNPAID' END AS payment_status
    FROM inv.invoices i JOIN inv.clients c ON c.id=i.client_id
    LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p ON p.invoice_id=i.id
    WHERE ($1::date IS NULL OR i.issue_date >= $1::date) AND ($2::date IS NULL OR i.issue_date <= $2::date)
      AND ($3='' OR i.status=$3) AND ($4::uuid IS NULL OR i.client_id=$4::uuid)
    ORDER BY i.issue_date DESC, i.invoice_number DESC`, [from, to, status, client])).rows;
  return {
    rows,
    totals: sumBy(rows, 'grand_total_minor'),
    taxable_minor: sumBy(rows, 'taxable_minor'),
    tax_minor: rows.reduce((acc, r) => acc + Number(r.cgst_minor || 0) + Number(r.sgst_minor || 0) + Number(r.igst_minor || 0), 0),
    paid_minor: sumBy(rows, 'paid_minor'),
    balance_due_minor: sumBy(rows, 'balance_due_minor'),
  };
}

export async function collectionReport(db, url) {
  const { from, to } = range(url);
  const rows = (await db.query(`
    SELECT p.receipt_number, p.paid_on, p.method, p.reference, p.amount_minor,
      i.invoice_number, c.name AS client_name
    FROM inv.payments p JOIN inv.invoices i ON i.id=p.invoice_id JOIN inv.clients c ON c.id=i.client_id
    WHERE ($1::date IS NULL OR p.paid_on >= $1::date) AND ($2::date IS NULL OR p.paid_on <= $2::date)
    ORDER BY p.paid_on DESC, p.receipt_number DESC`, [from, to])).rows;
  const byMonth = (await db.query(`
    SELECT to_char(date_trunc('month', p.paid_on), 'YYYY-MM') AS month, sum(p.amount_minor)::bigint AS collected_minor,
      count(*)::int AS receipts
    FROM inv.payments p WHERE ($1::date IS NULL OR p.paid_on >= $1::date) AND ($2::date IS NULL OR p.paid_on <= $2::date)
    GROUP BY 1 ORDER BY 1 DESC`, [from, to])).rows;
  return { rows, by_month: byMonth, collected_minor: sumBy(rows, 'amount_minor') };
}

export async function receivables(db) {
  const rows = (await db.query(`
    SELECT i.id, i.invoice_number, i.issue_date, i.due_date, c.name AS client_name, c.company_name AS client_company,
      (i.totals->>'grand_total_minor')::bigint AS grand_total_minor,
      COALESCE(p.paid_minor,0)::bigint AS paid_minor, ${BALANCE} AS balance_due_minor,
      CASE WHEN i.due_date IS NULL OR i.due_date >= CURRENT_DATE THEN 'NOT_DUE'
        WHEN CURRENT_DATE - i.due_date <= 30 THEN '1-30'
        WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60'
        WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90'
        ELSE 'OVER_90' END AS ageing,
      CASE WHEN i.due_date IS NULL THEN 0 ELSE GREATEST(CURRENT_DATE - i.due_date, 0) END::int AS days_overdue
    FROM inv.invoices i JOIN inv.clients c ON c.id=i.client_id
    LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p ON p.invoice_id=i.id
    WHERE i.status='ISSUED' AND ${BALANCE} > 0
    ORDER BY i.due_date NULLS LAST, i.issue_date`)).rows;
  const buckets = { NOT_DUE: 0, '1-30': 0, '31-60': 0, '61-90': 0, OVER_90: 0 };
  for (const row of rows) buckets[row.ageing] += row.balance_due_minor;
  return { rows, buckets, total_minor: rows.reduce((total, row) => total + row.balance_due_minor, 0) };
}

export async function quotationReport(db, url) {
  const { from, to } = range(url);
  const rows = (await db.query(`
    SELECT q.quotation_number, q.status, q.title, q.issue_date, q.expiry_date, c.name AS client_name,
      (q.totals->>'grand_total_minor')::bigint AS grand_total_minor,
      q.converted_invoice_id IS NOT NULL AS converted,
      CASE WHEN q.status='SENT' AND q.expiry_date IS NOT NULL AND q.expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE q.status END AS effective_status
    FROM inv.quotations q JOIN inv.clients c ON c.id=q.client_id
    WHERE ($1::date IS NULL OR q.issue_date >= $1::date) AND ($2::date IS NULL OR q.issue_date <= $2::date)
    ORDER BY q.issue_date DESC, q.created_at DESC`, [from, to])).rows.map(row => ({
    ...row,
    converted: Boolean(row.converted),
  }));
  const accepted = rows.filter(row => row.status === 'ACCEPTED').length;
  const rejected = rows.filter(row => row.status === 'REJECTED').length;
  const converted = rows.filter(row => row.converted).length;
  const decided = accepted + rejected;
  return { rows, accepted, rejected, converted,
    conversion_rate_bp: decided ? Math.round((accepted / decided) * 10000) : 0,
    decided_value_minor: rows.filter(row => row.status === 'ACCEPTED').reduce((total, row) => total + row.grand_total_minor, 0) };
}

export async function revenueByClient(db, url) {
  const { from, to } = range(url);
  const rows = (await db.query(`
    SELECT c.id, c.name AS client_name, c.company_name, c.email, c.phone, c.gstin,
      COALESCE(sum(CASE WHEN i.status='ISSUED' THEN (i.totals->>'grand_total_minor')::bigint ELSE 0 END),0)::bigint AS invoiced_minor,
      COALESCE((SELECT sum(p.amount_minor) FROM inv.payments p JOIN inv.invoices inv2 ON inv2.id = p.invoice_id
        WHERE inv2.client_id = c.id AND ($1::date IS NULL OR p.paid_on >= $1::date) AND ($2::date IS NULL OR p.paid_on <= $2::date)),0)::bigint AS collected_minor,
      count(i.id) FILTER (WHERE i.status='ISSUED')::int AS invoice_count,
      min(i.issue_date) FILTER (WHERE i.status='ISSUED') AS first_invoice_date,
      max(i.issue_date) FILTER (WHERE i.status='ISSUED') AS last_invoice_date,
      COALESCE((SELECT count(*)::int FROM inv.quotations q WHERE q.client_id = c.id
        AND ($1::date IS NULL OR q.issue_date >= $1::date) AND ($2::date IS NULL OR q.issue_date <= $2::date)),0)::int AS quotation_count,
      COALESCE((SELECT sum(((i2.totals->>'grand_total_minor')::bigint - COALESCE(p2.paid_minor,0))::bigint) FROM inv.invoices i2
        LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p2 ON p2.invoice_id = i2.id
        WHERE i2.client_id = c.id AND i2.status = 'ISSUED' AND ((i2.totals->>'grand_total_minor')::bigint - COALESCE(p2.paid_minor,0))::bigint > 0
          AND i2.due_date IS NOT NULL AND i2.due_date < CURRENT_DATE),0)::bigint AS overdue_minor
    FROM inv.clients c
    LEFT JOIN inv.invoices i ON i.client_id = c.id
      AND ($1::date IS NULL OR i.issue_date >= $1::date) AND ($2::date IS NULL OR i.issue_date <= $2::date)
    GROUP BY c.id, c.name, c.company_name, c.email, c.phone, c.gstin
    HAVING COALESCE(sum(CASE WHEN i.status='ISSUED' THEN (i.totals->>'grand_total_minor')::bigint ELSE 0 END),0) > 0
      OR COALESCE((SELECT sum(p.amount_minor) FROM inv.payments p JOIN inv.invoices inv2 ON inv2.id = p.invoice_id WHERE inv2.client_id = c.id AND ($1::date IS NULL OR p.paid_on >= $1::date) AND ($2::date IS NULL OR p.paid_on <= $2::date)),0) > 0
    ORDER BY invoiced_minor DESC LIMIT 200`, [from, to])).rows;

  const enriched = rows.map(r => ({
    ...r,
    balance_minor: Math.max(0, Number(r.invoiced_minor) - Number(r.collected_minor)),
  }));

  return {
    rows: enriched,
    total_invoiced_minor: sumBy(enriched, 'invoiced_minor'),
    total_collected_minor: sumBy(enriched, 'collected_minor'),
    total_balance_minor: sumBy(enriched, 'balance_minor'),
    total_overdue_minor: sumBy(enriched, 'overdue_minor'),
  };
}

export async function revenueByProduct(db, url) {
  const { from, to } = range(url);
  const limitParam = (url.searchParams.get('limit') || '').trim();
  const parsedLimit = parseInt(limitParam, 10);
  const limit = !Number.isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : (limitParam === 'all' ? 1000 : 200);
  const zeroSales = url.searchParams.get('zero_sales') === 'true';

  const rows = (await db.query(`
    SELECT
      items.product_id,
      COALESCE(p.name, NULLIF(items.description,''), 'Unnamed item') AS description,
      COALESCE(p.sku, '') AS sku,
      COALESCE(items.category, p.category, '') AS category,
      COALESCE(items.unit, p.unit, 'NOS') AS unit,
      sum(items.quantity_milli)::bigint AS quantity_milli,
      count(*)::int AS line_items,
      count(DISTINCT i.id)::int AS invoices,
      count(DISTINCT i.client_id)::int AS clients,
      sum(items.taxable_minor)::bigint AS taxable_minor,
      sum(items.tax_minor)::bigint AS tax_minor,
      sum(items.total_minor)::bigint AS total_minor
    FROM inv.invoice_items items
    JOIN inv.invoices i ON i.id = items.invoice_id
    LEFT JOIN inv.products p ON p.id = items.product_id
    WHERE i.status='ISSUED' AND ($1::date IS NULL OR i.issue_date >= $1::date) AND ($2::date IS NULL OR i.issue_date <= $2::date)
    GROUP BY items.product_id, COALESCE(p.name, NULLIF(items.description,''), 'Unnamed item'), COALESCE(p.sku, ''), COALESCE(items.category, p.category, ''), COALESCE(items.unit, p.unit, 'NOS')
    ORDER BY total_minor DESC`, [from, to])).rows;

  const totalInvoiced = sumBy(rows, 'total_minor');
  const enriched = rows.map(r => {
    const qtyUnits = Number(r.quantity_milli || 0) / 1000;
    const avgPrice = qtyUnits > 0 ? Math.round((Number(r.taxable_minor || 0) / qtyUnits)) : 0;
    const pct = totalInvoiced > 0 ? `${((Number(r.total_minor || 0) / totalInvoiced) * 100).toFixed(1)}%` : '0.0%';
    const bp = totalInvoiced > 0 ? Math.round((Number(r.total_minor || 0) / totalInvoiced) * 10000) : 0;
    return {
      ...r,
      average_price_minor: avgPrice,
      contribution_pct: pct,
      contribution_bp: bp,
    };
  });

  let zeroSalesRows = [];
  if (zeroSales) {
    zeroSalesRows = (await db.query(`
      SELECT p.id, p.name AS description, p.sku, p.category, p.unit, p.unit_price_minor
      FROM inv.products p
      WHERE p.status = 'ACTIVE'
        AND p.id NOT IN (
          SELECT DISTINCT items.product_id FROM inv.invoice_items items
          JOIN inv.invoices i ON i.id = items.invoice_id
          WHERE i.status='ISSUED' AND items.product_id IS NOT NULL
            AND ($1::date IS NULL OR i.issue_date >= $1::date)
            AND ($2::date IS NULL OR i.issue_date <= $2::date)
        )
      ORDER BY p.name`, [from, to])).rows;
  }

  const limitedRows = limitParam === 'all' ? enriched : enriched.slice(0, limit);
  return {
    rows: limitedRows,
    total_count: enriched.length,
    total_minor: totalInvoiced,
    taxable_minor: sumBy(rows, 'taxable_minor'),
    tax_minor: sumBy(rows, 'tax_minor'),
    zero_sales_rows: zeroSalesRows,
  };
}

/**
 * Tax summary from stored transaction data, net of credit notes. It is a record
 * of what this system calculated - not a filed return.
 */
export async function taxSummary(db, url) {
  const { from, to } = range(url);
  const output = (await db.query(`
    SELECT items.hsn_sac, items.tax_rate_bp,
      sum(items.taxable_minor)::bigint AS taxable_minor,
      sum(items.cgst_minor)::bigint AS cgst_minor,
      sum(items.sgst_minor)::bigint AS sgst_minor,
      sum(items.igst_minor)::bigint AS igst_minor,
      sum(items.tax_minor)::bigint AS tax_minor
    FROM inv.invoice_items items JOIN inv.invoices i ON i.id = items.invoice_id
    WHERE i.status='ISSUED' AND ($1::date IS NULL OR i.issue_date >= $1::date) AND ($2::date IS NULL OR i.issue_date <= $2::date)
    GROUP BY 1, 2 ORDER BY 1, 2`, [from, to])).rows;
  const notes = (await db.query(`
    SELECT n.kind, sum(items.taxable_minor)::bigint AS taxable_minor,
      sum(items.cgst_minor)::bigint AS cgst_minor, sum(items.sgst_minor)::bigint AS sgst_minor,
      sum(items.igst_minor)::bigint AS igst_minor, sum(items.tax_minor)::bigint AS tax_minor
    FROM inv.adjustment_note_items items JOIN inv.adjustment_notes n ON n.id = items.note_id
    WHERE ($1::date IS NULL OR n.issue_date >= $1::date) AND ($2::date IS NULL OR n.issue_date <= $2::date)
    GROUP BY 1`, [from, to])).rows;
  const exempt = (await db.query(`
    SELECT COALESCE(sum(items.taxable_minor),0)::bigint AS total FROM inv.invoice_items items
    JOIN inv.invoices i ON i.id = items.invoice_id
    WHERE i.status='ISSUED' AND items.tax_treatment <> 'TAXABLE'
      AND ($1::date IS NULL OR i.issue_date >= $1::date) AND ($2::date IS NULL OR i.issue_date <= $2::date)`, [from, to])).rows[0].total;
  const credit = notes.find(row => row.kind === 'CREDIT');
  const debit = notes.find(row => row.kind === 'DEBIT');
  const net = (output.reduce((acc, row) => ({
    taxable_minor: acc.taxable_minor + row.taxable_minor,
    cgst_minor: acc.cgst_minor + row.cgst_minor,
    sgst_minor: acc.sgst_minor + row.sgst_minor,
    igst_minor: acc.igst_minor + row.igst_minor,
    tax_minor: acc.tax_minor + row.tax_minor,
  }), { taxable_minor: 0, cgst_minor: 0, sgst_minor: 0, igst_minor: 0, tax_minor: 0 }));
  for (const [row, sign] of [[credit, -1], [debit, 1]]) {
    if (!row) continue;
    net.taxable_minor += sign * Number(row.taxable_minor);
    net.cgst_minor += sign * Number(row.cgst_minor);
    net.sgst_minor += sign * Number(row.sgst_minor);
    net.igst_minor += sign * Number(row.igst_minor);
    net.tax_minor += sign * Number(row.tax_minor);
  }
  return { output_rows: output, exempt_taxable_minor: exempt, credit_note: credit || null, debit_note: debit || null, net };
}

export async function auditTrail(db, url) {
  const { page, limit, offset } = pagination(url);
  const term = `%${escapeLike(searchTerm(url))}%`;
  const rows = (await db.query(`
    SELECT a.id,a.event,a.entity_type,a.entity_id,a.metadata,a.created_at,u.email AS actor_email,u.display_name AS actor_name
    FROM inv.audit_logs a LEFT JOIN inv.users u ON u.id=a.actor_id
    WHERE ($1='' OR a.event ILIKE $1 ESCAPE '!' OR a.entity_type ILIKE $1 ESCAPE '!')
    ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3`, [term, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*)::int AS total FROM inv.audit_logs a
    WHERE ($1='' OR a.event ILIKE $1 ESCAPE '!' OR a.entity_type ILIKE $1 ESCAPE '!')`, [term])).rows[0].total;
  return { events: rows, total, page, limit };
}

/* -------------------------------------------------------- Business Overview & Comparison */

export function compareMetrics(current, prior) {
  const c = Number(current || 0);
  const p = Number(prior || 0);
  const diff = c - p;
  let percent = 0;
  if (p === 0) {
    percent = c > 0 ? 100 : 0;
  } else {
    percent = Math.round((diff / Math.abs(p)) * 1000) / 10;
  }
  return {
    current: c,
    prior: p,
    diff,
    percent,
    trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
  };
}

export async function businessOverview(db, url) {
  const presetKey = (url.searchParams.get('preset') || '').trim();
  const rawFrom = (url.searchParams.get('from') || '').trim();
  const rawTo = (url.searchParams.get('to') || '').trim();

  const preset = presetKey || (!rawFrom && !rawTo ? 'this_fy' : 'custom');
  const resolved = resolveDatePreset(preset, { customFrom: rawFrom, customTo: rawTo });

  const currentFrom = resolved.from;
  const currentTo = resolved.to;
  const priorFrom = resolved.prior.from;
  const priorTo = resolved.prior.to;

  const [invoicesCurr, paymentsCurr, receivablesGlobal, overdueGlobal, cancelledCurr, topProductsCurr, topClientsCurr] = await Promise.all([
    db.query(`
      SELECT
        count(*)::int AS count,
        COALESCE(sum((totals->>'grand_total_minor')::bigint), 0)::bigint AS invoiced_minor,
        COALESCE(sum((totals->>'taxable_total_minor')::bigint), 0)::bigint AS taxable_minor,
        COALESCE(sum((totals->>'cgst_total_minor')::bigint), 0)::bigint AS cgst_minor,
        COALESCE(sum((totals->>'sgst_total_minor')::bigint), 0)::bigint AS sgst_minor,
        COALESCE(sum((totals->>'igst_total_minor')::bigint), 0)::bigint AS igst_minor,
        count(DISTINCT client_id)::int AS active_clients
      FROM inv.invoices
      WHERE status = 'ISSUED'
        AND ($1::date IS NULL OR issue_date >= $1::date)
        AND ($2::date IS NULL OR issue_date <= $2::date)`, [currentFrom, currentTo]),

    db.query(`
      SELECT
        count(*)::int AS count,
        COALESCE(sum(amount_minor), 0)::bigint AS collected_minor
      FROM inv.payments
      WHERE ($1::date IS NULL OR paid_on >= $1::date)
        AND ($2::date IS NULL OR paid_on <= $2::date)`, [currentFrom, currentTo]),

    db.query(`
      SELECT COALESCE(sum(${BALANCE}),0)::bigint AS total, count(*)::int AS count
      FROM inv.invoices i
      LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p
        ON p.invoice_id = i.id
      WHERE i.status='ISSUED' AND ${BALANCE} > 0`),

    db.query(`
      SELECT COALESCE(sum(${BALANCE}),0)::bigint AS total, count(*)::int AS count
      FROM inv.invoices i
      LEFT JOIN (SELECT invoice_id, sum(amount_minor) AS paid_minor FROM inv.payments GROUP BY invoice_id) p
        ON p.invoice_id = i.id
      WHERE i.status='ISSUED' AND ${BALANCE} > 0 AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE`),

    db.query(`
      SELECT count(*)::int AS count
      FROM inv.invoices
      WHERE status IN ('CANCELLED', 'VOID')
        AND ($1::date IS NULL OR issue_date >= $1::date)
        AND ($2::date IS NULL OR issue_date <= $2::date)`, [currentFrom, currentTo]),

    db.query(`
      SELECT COALESCE(p.name, NULLIF(items.description,''), 'Unnamed item') AS description,
        sum(items.total_minor)::bigint AS total_minor,
        sum(items.quantity_milli)::bigint AS quantity_milli
      FROM inv.invoice_items items JOIN inv.invoices i ON i.id = items.invoice_id
      LEFT JOIN inv.products p ON p.id = items.product_id
      WHERE i.status='ISSUED'
        AND ($1::date IS NULL OR i.issue_date >= $1::date)
        AND ($2::date IS NULL OR i.issue_date <= $2::date)
      GROUP BY 1 ORDER BY total_minor DESC LIMIT 5`, [currentFrom, currentTo]),

    db.query(`
      SELECT c.name AS client_name,
        COALESCE(sum((i.totals->>'grand_total_minor')::bigint),0)::bigint AS invoiced_minor
      FROM inv.clients c JOIN inv.invoices i ON i.client_id = c.id
      WHERE i.status='ISSUED'
        AND ($1::date IS NULL OR i.issue_date >= $1::date)
        AND ($2::date IS NULL OR i.issue_date <= $2::date)
      GROUP BY c.id, c.name
      ORDER BY invoiced_minor DESC LIMIT 5`, [currentFrom, currentTo]),
  ]);

  let priorInv = { count: 0, invoiced_minor: 0, taxable_minor: 0, cgst_minor: 0, sgst_minor: 0, igst_minor: 0 };
  let priorPay = { count: 0, collected_minor: 0 };

  if (priorFrom && priorTo) {
    const [pInv, pPay] = await Promise.all([
      db.query(`
        SELECT
          count(*)::int AS count,
          COALESCE(sum((totals->>'grand_total_minor')::bigint), 0)::bigint AS invoiced_minor,
          COALESCE(sum((totals->>'taxable_total_minor')::bigint), 0)::bigint AS taxable_minor,
          COALESCE(sum((totals->>'cgst_total_minor')::bigint), 0)::bigint AS cgst_minor,
          COALESCE(sum((totals->>'sgst_total_minor')::bigint), 0)::bigint AS sgst_minor,
          COALESCE(sum((totals->>'igst_total_minor')::bigint), 0)::bigint AS igst_minor
        FROM inv.invoices
        WHERE status = 'ISSUED'
          AND issue_date >= $1::date AND issue_date <= $2::date`, [priorFrom, priorTo]),
      db.query(`
        SELECT
          count(*)::int AS count,
          COALESCE(sum(amount_minor), 0)::bigint AS collected_minor
        FROM inv.payments
        WHERE paid_on >= $1::date AND paid_on <= $2::date`, [priorFrom, priorTo]),
    ]);
    priorInv = pInv.rows[0];
    priorPay = pPay.rows[0];
  }

  const currInv = invoicesCurr.rows[0];
  const currPay = paymentsCurr.rows[0];
  const currTaxMinor = Number(currInv.cgst_minor || 0) + Number(currInv.sgst_minor || 0) + Number(currInv.igst_minor || 0);
  const priorTaxMinor = Number(priorInv.cgst_minor || 0) + Number(priorInv.sgst_minor || 0) + Number(priorInv.igst_minor || 0);

  return {
    range: resolved,
    metrics: {
      invoiced: compareMetrics(currInv.invoiced_minor, priorInv.invoiced_minor),
      invoices_count: compareMetrics(currInv.count, priorInv.count),
      collected: compareMetrics(currPay.collected_minor, priorPay.collected_minor),
      receipts_count: compareMetrics(currPay.count, priorPay.count),
      taxable: compareMetrics(currInv.taxable_minor, priorInv.taxable_minor),
      tax: compareMetrics(currTaxMinor, priorTaxMinor),
      cgst: compareMetrics(currInv.cgst_minor, priorInv.cgst_minor),
      sgst: compareMetrics(currInv.sgst_minor, priorInv.sgst_minor),
      igst: compareMetrics(currInv.igst_minor, priorInv.igst_minor),
      receivables: {
        total_minor: receivablesGlobal.rows[0].total,
        count: receivablesGlobal.rows[0].count,
      },
      overdue: {
        total_minor: overdueGlobal.rows[0].total,
        count: overdueGlobal.rows[0].count,
      },
      cancelled_count: cancelledCurr.rows[0].count,
      active_clients: currInv.active_clients,
    },
    top_products: topProductsCurr.rows,
    top_clients: topClientsCurr.rows,
  };
}

/* ------------------------------------------------------------- Customer Statement */

export async function customerStatement(db, clientId, url) {
  assert(clientId, 400, 'Client ID is required.', 'CLIENT_REQUIRED');
  const { from, to } = range(url);

  const clientResult = await db.query(
    `SELECT id, name, company_name, email, phone, gstin, billing_address, state_code
     FROM inv.clients WHERE id = $1::uuid`,
    [clientId]
  );
  if (!clientResult.rows.length) {
    throw new HttpError(404, 'Client not found.', 'NOT_FOUND');
  }
  const client = clientResult.rows[0];

  let openingBalance = 0;
  if (from) {
    const priorInv = (await db.query(
      `SELECT COALESCE(sum((totals->>'grand_total_minor')::bigint), 0)::bigint AS total
       FROM inv.invoices WHERE client_id = $1::uuid AND status = 'ISSUED' AND issue_date < $2::date`,
      [clientId, from]
    )).rows[0].total;

    const priorPay = (await db.query(
      `SELECT COALESCE(sum(p.amount_minor), 0)::bigint AS total
       FROM inv.payments p JOIN inv.invoices i ON i.id = p.invoice_id
       WHERE i.client_id = $1::uuid AND i.status = 'ISSUED' AND p.paid_on < $2::date`,
      [clientId, from]
    )).rows[0].total;

    openingBalance = Number(priorInv) - Number(priorPay);
  }

  const invoices = (await db.query(
    `SELECT id, invoice_number AS doc_number, issue_date AS trans_date, due_date,
       'INVOICE' AS trans_type, (totals->>'grand_total_minor')::bigint AS debit_minor,
       0::bigint AS credit_minor, COALESCE(notes, '') AS notes
     FROM inv.invoices
     WHERE client_id = $1::uuid AND status = 'ISSUED'
       AND ($2::date IS NULL OR issue_date >= $2::date)
       AND ($3::date IS NULL OR issue_date <= $3::date)
     ORDER BY issue_date ASC, created_at ASC`,
    [clientId, from, to]
  )).rows;

  const payments = (await db.query(
    `SELECT p.id, p.receipt_number AS doc_number, p.paid_on AS trans_date, NULL AS due_date,
       'PAYMENT' AS trans_type, 0::bigint AS debit_minor,
       p.amount_minor AS credit_minor,
       COALESCE(p.reference, '') AS notes, p.method
     FROM inv.payments p JOIN inv.invoices i ON i.id = p.invoice_id
     WHERE i.client_id = $1::uuid AND i.status = 'ISSUED'
       AND ($2::date IS NULL OR p.paid_on >= $2::date)
       AND ($3::date IS NULL OR p.paid_on <= $3::date)
     ORDER BY p.paid_on ASC, p.recorded_at ASC`,
    [clientId, from, to]
  )).rows;

  const transactions = [...invoices, ...payments].sort((a, b) => {
    if (a.trans_date < b.trans_date) return -1;
    if (a.trans_date > b.trans_date) return 1;
    if (a.trans_type === 'INVOICE' && b.trans_type !== 'INVOICE') return -1;
    if (a.trans_type !== 'INVOICE' && b.trans_type === 'INVOICE') return 1;
    return 0;
  });

  let running = openingBalance;
  let totalDebits = 0;
  let totalCredits = 0;

  const ledger = transactions.map(tx => {
    const debit = Number(tx.debit_minor || 0);
    const credit = Number(tx.credit_minor || 0);
    totalDebits += debit;
    totalCredits += credit;
    running += debit - credit;
    return {
      ...tx,
      debit_minor: debit,
      credit_minor: credit,
      balance_minor: running,
    };
  });

  return {
    client,
    range: { from, to },
    opening_balance_minor: openingBalance,
    transactions: ledger,
    total_debits_minor: totalDebits,
    total_credits_minor: totalCredits,
    closing_balance_minor: running,
  };
}

export const sumBy = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);

/** CSV with a spreadsheet-formula guard so exported data cannot execute on open. */
export function toCsv(columns, rows) {
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = columns.map(column => cell(column.label)).join(',');
  const body = rows.map(row => columns.map(column => cell(row[column.key])).join(','));
  return `${[head, ...body].join('\r\n')}\r\n`;
}
