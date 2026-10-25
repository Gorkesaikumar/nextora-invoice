/**
 * Semantic HTML report generator with print CSS, repeating table headers,
 * page-break handling, and corporate Nextora styling.
 */

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInr(minor) {
  const value = Number(minor || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const [y, m, d] = String(isoStr).slice(0, 10).split('-');
    if (!y || !m || !d) return isoStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  } catch {
    return isoStr;
  }
}

function baseLayout({ title, subtitle, dateRange, generatedAt, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)} — Nextora Creations</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #1a1a1a;
      background: #fdfdfd;
      padding: 32px;
    }
    .report-container { max-width: 1100px; margin: 0 auto; background: #ffffff; padding: 32px; border: 1px solid #e2e8f0; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .company-title { font-size: 18pt; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; }
    .report-title { font-size: 14pt; font-weight: 600; color: #334155; margin-top: 4px; }
    .meta-block { text-align: right; font-size: 9pt; color: #64748b; line-height: 1.4; }
    .meta-tag { display: inline-block; padding: 3px 8px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 3px; font-weight: 600; color: #1e293b; margin-top: 4px; }

    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 14px 16px; }
    .stat-label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; margin-bottom: 4px; }
    .stat-value { font-size: 15pt; font-weight: 700; color: #0f172a; font-feature-settings: 'tnum'; }
    .stat-hint { font-size: 8.5pt; color: #94a3b8; margin-top: 2px; }
    .stat-badge { display: inline-block; font-size: 8pt; font-weight: 600; padding: 1px 6px; border-radius: 2px; }
    .badge-up { background: #dcfce7; color: #166534; }
    .badge-down { background: #fee2e2; color: #991b1b; }
    .badge-flat { background: #f1f5f9; color: #475569; }

    table.report-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 9.5pt; page-break-inside: auto; }
    table.report-table thead { display: table-header-group; background: #0f172a; color: #ffffff; }
    table.report-table th { padding: 9px 10px; font-weight: 600; text-align: left; border: 1px solid #0f172a; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.03em; }
    table.report-table th.num, table.report-table td.num { text-align: right; font-feature-settings: 'tnum'; }
    table.report-table tbody tr { page-break-inside: avoid; page-break-after: auto; }
    table.report-table tbody tr:nth-child(even) { background-color: #f8fafc; }
    table.report-table td { padding: 8px 10px; border: 1px solid #e2e8f0; color: #334155; }
    table.report-table tfoot { display: table-footer-group; font-weight: 700; background: #f1f5f9; }
    table.report-table tfoot td { padding: 9px 10px; border: 1px solid #cbd5e1; border-top: 2px solid #0f172a; color: #0f172a; }

    .section-title { font-size: 12pt; font-weight: 700; color: #0f172a; margin-top: 28px; margin-bottom: 12px; }
    .footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8; }

    @media print {
      body { background: #ffffff; padding: 0; }
      .report-container { max-width: 100%; border: none; box-shadow: none; padding: 0; }
      @page { size: auto; margin: 12mm 10mm; }
      thead { display: table-header-group !important; }
      tfoot { display: table-footer-group !important; }
      tr { page-break-inside: avoid !important; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="header">
      <div>
        <div class="company-title">NEXTORA CREATIONS</div>
        <div class="report-title">${esc(title)}</div>
        ${subtitle ? `<div style="font-size: 9.5pt; color: #64748b; margin-top: 2px;">${esc(subtitle)}</div>` : ''}
      </div>
      <div class="meta-block">
        <div><strong>Generated:</strong> ${esc(generatedAt)}</div>
        <div><strong>Range:</strong> ${esc(dateRange)}</div>
        <div class="meta-tag">Official Business Report</div>
      </div>
    </div>

    ${content}

    <div class="footer">
      <div>Nextora Creations Invoicing &amp; Quotation Management System</div>
      <div>Confidential — For Internal Business Use Only</div>
    </div>
  </div>
</body>
</html>`;
}

export function renderReportHtml(section, data, options = {}) {
  const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const dateRange = options.rangeLabel || (options.from && options.to ? `${options.from} to ${options.to}` : 'All available dates');

  switch (section) {
    case 'overview': {
      const m = data.metrics || {};
      const formatTrend = metric => {
        if (!metric) return '';
        const sign = metric.diff > 0 ? '+' : '';
        const cls = metric.trend === 'up' ? 'badge-up' : metric.trend === 'down' ? 'badge-down' : 'badge-flat';
        return `<span class="stat-badge ${cls}">${sign}${metric.percent}%</span>`;
      };

      const content = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Invoiced Sales</div>
            <div class="stat-value">${formatInr(m.invoiced?.current)}</div>
            <div class="stat-hint">${formatTrend(m.invoiced)} vs prior period (${formatInr(m.invoiced?.prior)})</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Collections Received</div>
            <div class="stat-value">${formatInr(m.collected?.current)}</div>
            <div class="stat-hint">${formatTrend(m.collected)} vs prior period (${formatInr(m.collected?.prior)})</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Receivables</div>
            <div class="stat-value">${formatInr(m.receivables?.total_minor)}</div>
            <div class="stat-hint">${m.receivables?.count || 0} active unpaid invoice(s)</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Overdue Balance</div>
            <div class="stat-value" style="color: ${m.overdue?.total_minor > 0 ? '#b91c1c' : '#0f172a'}">${formatInr(m.overdue?.total_minor)}</div>
            <div class="stat-hint">${m.overdue?.count || 0} overdue invoice(s) past due date</div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Taxable Value</div>
            <div class="stat-value">${formatInr(m.taxable?.current)}</div>
            <div class="stat-hint">${formatTrend(m.taxable)} (${m.invoices_count?.current || 0} invoices issued)</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Tax Output</div>
            <div class="stat-value">${formatInr(m.tax?.current)}</div>
            <div class="stat-hint">CGST: ${formatInr(m.cgst?.current)} | SGST: ${formatInr(m.sgst?.current)} | IGST: ${formatInr(m.igst?.current)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active Clients</div>
            <div class="stat-value">${m.active_clients || 0}</div>
            <div class="stat-hint">Billed within this period</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Cancelled / Void</div>
            <div class="stat-value">${m.cancelled_count || 0}</div>
            <div class="stat-hint">Excluded from invoiced revenue</div>
          </div>
        </div>

        <div class="section-title">Top Products &amp; Services by Revenue</div>
        <table class="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th class="num">Quantity</th>
              <th class="num">Total Invoiced</th>
            </tr>
          </thead>
          <tbody>
            ${(data.top_products || []).map((p, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${esc(p.description)}</strong></td>
                <td class="num">${(Number(p.quantity_milli || 0) / 1000).toLocaleString('en-IN')}</td>
                <td class="num font-bold">${formatInr(p.total_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" style="text-align:center; padding: 20px;">No product sales recorded in this period.</td></tr>'}
          </tbody>
        </table>

        <div class="section-title">Top Clients by Invoiced Value</div>
        <table class="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Client Name</th>
              <th class="num">Invoiced Value</th>
            </tr>
          </thead>
          <tbody>
            ${(data.top_clients || []).map((c, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${esc(c.client_name)}</strong></td>
                <td class="num font-bold">${formatInr(c.invoiced_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="3" style="text-align:center; padding: 20px;">No client billings recorded in this period.</td></tr>'}
          </tbody>
        </table>
      `;

      return baseLayout({
        title: 'Executive Business Overview & KPI Report',
        subtitle: 'Comprehensive financial health and period performance metrics',
        dateRange,
        generatedAt,
        content,
      });
    }

    case 'invoices': {
      const rows = data.rows || [];
      const content = `
        <table class="report-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Date</th>
              <th>Due Date</th>
              <th>Client</th>
              <th>GSTIN</th>
              <th>Status</th>
              <th class="num">Taxable</th>
              <th class="num">Tax</th>
              <th class="num">Total</th>
              <th class="num">Collected</th>
              <th class="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.invoice_number || 'Draft')}</strong></td>
                <td>${formatDate(r.issue_date)}</td>
                <td>${formatDate(r.due_date)}</td>
                <td>${esc(r.client_name)}</td>
                <td>${esc(r.client_gstin || '—')}</td>
                <td>${esc(r.payment_status || r.status)}</td>
                <td class="num">${formatInr(r.taxable_minor)}</td>
                <td class="num">${formatInr(Number(r.cgst_minor || 0) + Number(r.sgst_minor || 0) + Number(r.igst_minor || 0))}</td>
                <td class="num"><strong>${formatInr(r.grand_total_minor)}</strong></td>
                <td class="num">${formatInr(r.paid_minor)}</td>
                <td class="num">${formatInr(r.balance_due_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="11" style="text-align:center; padding: 24px;">No invoices found in this range.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6">TOTAL (${rows.length} invoices)</td>
              <td class="num">${formatInr(data.taxable_minor)}</td>
              <td class="num">${formatInr(data.tax_minor)}</td>
              <td class="num">${formatInr(data.totals)}</td>
              <td class="num">${formatInr(data.paid_minor)}</td>
              <td class="num">${formatInr(data.balance_due_minor)}</td>
            </tr>
          </tfoot>
        </table>
      `;

      return baseLayout({
        title: 'Invoice Register Report',
        subtitle: 'All invoices issued with tax breakdown, collection, and balance tracking',
        dateRange,
        generatedAt,
        content,
      });
    }

    case 'collections': {
      const rows = data.rows || [];
      const content = `
        <table class="report-table">
          <thead>
            <tr>
              <th>Receipt #</th>
              <th>Paid On</th>
              <th>Client</th>
              <th>Invoice #</th>
              <th>Payment Method</th>
              <th>Reference</th>
              <th class="num">Amount Collected</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.receipt_number)}</strong></td>
                <td>${formatDate(r.paid_on)}</td>
                <td>${esc(r.client_name)}</td>
                <td>${esc(r.invoice_number || '—')}</td>
                <td>${esc(r.method)}</td>
                <td>${esc(r.reference || '—')}</td>
                <td class="num font-bold">${formatInr(r.amount_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="7" style="text-align:center; padding: 24px;">No collections recorded in this range.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6">TOTAL COLLECTED (${rows.length} receipts)</td>
              <td class="num font-bold">${formatInr(data.collected_minor)}</td>
            </tr>
          </tfoot>
        </table>
      `;

      return baseLayout({
        title: 'Collections & Cash Receipts Report',
        subtitle: 'Audit-verified payment receipts recorded against customer invoices',
        dateRange,
        generatedAt,
        content,
      });
    }

    case 'products': {
      const rows = data.rows || [];
      const zeroRows = data.zero_sales_rows || [];
      const content = `
        <table class="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item Name</th>
              <th>SKU</th>
              <th>Category</th>
              <th class="num">Qty</th>
              <th>Unit</th>
              <th class="num">Invoices</th>
              <th class="num">Avg Price</th>
              <th class="num">Taxable</th>
              <th class="num">Tax</th>
              <th class="num">Total Sales</th>
              <th class="num">Share</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${esc(r.description)}</strong></td>
                <td>${esc(r.sku || '—')}</td>
                <td>${esc(r.category || '—')}</td>
                <td class="num">${(Number(r.quantity_milli || 0) / 1000).toLocaleString('en-IN')}</td>
                <td>${esc(r.unit || 'NOS')}</td>
                <td class="num">${r.invoices}</td>
                <td class="num">${formatInr(r.average_price_minor)}</td>
                <td class="num">${formatInr(r.taxable_minor)}</td>
                <td class="num">${formatInr(r.tax_minor)}</td>
                <td class="num"><strong>${formatInr(r.total_minor)}</strong></td>
                <td class="num">${esc(r.contribution_pct)}</td>
              </tr>
            `).join('') || '<tr><td colspan="12" style="text-align:center; padding: 24px;">No product sales recorded in this range.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="8">TOTAL SALES (${rows.length} active products)</td>
              <td class="num">${formatInr(data.taxable_minor)}</td>
              <td class="num">${formatInr(data.tax_minor)}</td>
              <td class="num">${formatInr(data.total_minor)}</td>
              <td class="num">100.0%</td>
            </tr>
          </tfoot>
        </table>

        ${zeroRows.length ? `
          <div class="section-title">Zero-Sales Catalog Items (${zeroRows.length} items without sales)</div>
          <table class="report-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Unit</th>
                <th class="num">Standard Price</th>
              </tr>
            </thead>
            <tbody>
              ${zeroRows.map(z => `
                <tr>
                  <td><strong>${esc(z.description)}</strong></td>
                  <td>${esc(z.sku || '—')}</td>
                  <td>${esc(z.category || '—')}</td>
                  <td>${esc(z.unit || 'NOS')}</td>
                  <td class="num">${formatInr(z.unit_price_minor)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}
      `;

      return baseLayout({
        title: 'Product & Service Sales Analytics',
        subtitle: 'Quantity, revenue realization, average prices, and portfolio contribution breakdown',
        dateRange,
        generatedAt,
        content,
      });
    }

    case 'clients': {
      const rows = data.rows || [];
      const content = `
        <table class="report-table">
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Company</th>
              <th>GSTIN</th>
              <th class="num">Invoices</th>
              <th>First Invoice</th>
              <th>Last Invoice</th>
              <th class="num">Total Invoiced</th>
              <th class="num">Collected</th>
              <th class="num">Balance Due</th>
              <th class="num">Overdue</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.client_name)}</strong></td>
                <td>${esc(r.company_name || '—')}</td>
                <td>${esc(r.gstin || '—')}</td>
                <td class="num">${r.invoice_count || 0}</td>
                <td>${formatDate(r.first_invoice_date)}</td>
                <td>${formatDate(r.last_invoice_date)}</td>
                <td class="num"><strong>${formatInr(r.invoiced_minor)}</strong></td>
                <td class="num">${formatInr(r.collected_minor)}</td>
                <td class="num font-bold">${formatInr(r.balance_minor)}</td>
                <td class="num" style="color: ${r.overdue_minor > 0 ? '#b91c1c' : '#334155'}; font-weight: ${r.overdue_minor > 0 ? '700' : '400'};">${formatInr(r.overdue_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="10" style="text-align:center; padding: 24px;">No client activity in this range.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6">TOTAL (${rows.length} clients)</td>
              <td class="num">${formatInr(data.total_invoiced_minor)}</td>
              <td class="num">${formatInr(data.total_collected_minor)}</td>
              <td class="num">${formatInr(data.total_balance_minor)}</td>
              <td class="num">${formatInr(data.total_overdue_minor)}</td>
            </tr>
          </tfoot>
        </table>
      `;

      return baseLayout({
        title: 'Customer-Wise Revenue & Receivables Report',
        subtitle: 'Detailed sales performance, collections, and credit standing by customer',
        dateRange,
        generatedAt,
        content,
      });
    }

    case 'statement': {
      const client = data.client || {};
      const txs = data.transactions || [];
      const content = `
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 18px 20px; margin-bottom: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <div>
            <div style="font-size: 8.5pt; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 4px;">Client Details</div>
            <div style="font-size: 13pt; font-weight: 700; color: #0f172a;">${esc(client.name)}</div>
            ${client.company_name ? `<div style="font-size: 10pt; color: #334155;">${esc(client.company_name)}</div>` : ''}
            ${client.gstin ? `<div style="font-size: 9pt; color: #475569; margin-top: 4px;">GSTIN: <strong>${esc(client.gstin)}</strong></div>` : ''}
            ${client.email ? `<div style="font-size: 9pt; color: #475569;">Email: ${esc(client.email)}</div>` : ''}
            ${client.phone ? `<div style="font-size: 9pt; color: #475569;">Phone: ${esc(client.phone)}</div>` : ''}
          </div>
          <div style="text-align: right;">
            <div style="font-size: 8.5pt; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 4px;">Statement Summary</div>
            <div style="font-size: 9pt; color: #475569;">Opening Balance: <strong>${formatInr(data.opening_balance_minor)}</strong></div>
            <div style="font-size: 9pt; color: #475569;">Invoiced: <strong>${formatInr(data.total_debits_minor)}</strong></div>
            <div style="font-size: 9pt; color: #475569;">Payments: <strong>${formatInr(data.total_credits_minor)}</strong></div>
            <div style="font-size: 14pt; font-weight: 700; color: #0f172a; margin-top: 6px; border-top: 1px solid #cbd5e1; padding-top: 4px;">
              Closing Balance: ${formatInr(data.closing_balance_minor)}
            </div>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Doc / Receipt #</th>
              <th>Description / Reference</th>
              <th class="num">Debit (Invoiced)</th>
              <th class="num">Credit (Paid)</th>
              <th class="num">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background: #f1f5f9; font-weight: 600;">
              <td>${formatDate(options.from) || 'Start'}</td>
              <td>OPENING</td>
              <td>—</td>
              <td>Opening Balance Forward</td>
              <td class="num">—</td>
              <td class="num">—</td>
              <td class="num"><strong>${formatInr(data.opening_balance_minor)}</strong></td>
            </tr>
            ${txs.map(t => `
              <tr>
                <td>${formatDate(t.trans_date)}</td>
                <td><span class="meta-tag" style="margin: 0; font-size: 8pt;">${esc(t.trans_type)}</span></td>
                <td><strong>${esc(t.doc_number)}</strong></td>
                <td>${esc(t.notes || t.method || '—')}</td>
                <td class="num">${t.debit_minor > 0 ? formatInr(t.debit_minor) : '—'}</td>
                <td class="num" style="color: #166534;">${t.credit_minor > 0 ? formatInr(t.credit_minor) : '—'}</td>
                <td class="num"><strong>${formatInr(t.balance_minor)}</strong></td>
              </tr>
            `).join('') || '<tr><td colspan="7" style="text-align:center; padding: 24px;">No ledger transactions during this statement period.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4">PERIOD TOTALS</td>
              <td class="num">${formatInr(data.total_debits_minor)}</td>
              <td class="num" style="color: #166534;">${formatInr(data.total_credits_minor)}</td>
              <td class="num" style="font-size: 11pt;">${formatInr(data.closing_balance_minor)}</td>
            </tr>
          </tfoot>
        </table>
      `;

      return baseLayout({
        title: `Customer Statement of Account — ${client.name}`,
        subtitle: `Itemized transaction ledger and account balance reconciliation`,
        dateRange,
        generatedAt,
        content,
      });
    }

    case 'receivables': {
      const rows = data.rows || [];
      const buckets = data.buckets || {};
      const content = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Not Due Yet</div>
            <div class="stat-value">${formatInr(buckets.NOT_DUE)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">1 - 30 Days Past Due</div>
            <div class="stat-value" style="color: ${buckets['1-30'] > 0 ? '#b45309' : '#0f172a'}">${formatInr(buckets['1-30'])}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">31 - 60 Days Past Due</div>
            <div class="stat-value" style="color: ${buckets['31-60'] > 0 ? '#c2410c' : '#0f172a'}">${formatInr(buckets['31-60'])}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">61 - 90 Days Past Due</div>
            <div class="stat-value" style="color: ${buckets['61-90'] > 0 ? '#dc2626' : '#0f172a'}">${formatInr(buckets['61-90'])}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Over 90 Days Past Due</div>
            <div class="stat-value" style="color: ${buckets.OVER_90 > 0 ? '#991b1b' : '#0f172a'}">${formatInr(buckets.OVER_90)}</div>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Client</th>
              <th>Issue Date</th>
              <th>Due Date</th>
              <th class="num">Days Overdue</th>
              <th>Bucket</th>
              <th class="num">Invoice Total</th>
              <th class="num">Collected</th>
              <th class="num">Outstanding Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.invoice_number)}</strong></td>
                <td>${esc(r.client_name)}</td>
                <td>${formatDate(r.issue_date)}</td>
                <td>${formatDate(r.due_date)}</td>
                <td class="num" style="color: ${r.days_overdue > 0 ? '#b91c1c' : '#334155'}; font-weight: ${r.days_overdue > 0 ? '700' : '400'};">${r.days_overdue}</td>
                <td><span class="meta-tag" style="margin: 0; font-size: 8pt;">${esc(r.ageing === 'NOT_DUE' ? 'Not due' : r.ageing)}</span></td>
                <td class="num">${formatInr(r.grand_total_minor)}</td>
                <td class="num">${formatInr(r.paid_minor)}</td>
                <td class="num font-bold">${formatInr(r.balance_due_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="9" style="text-align:center; padding: 24px;">All invoices are settled. No outstanding receivables.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="8">TOTAL OUTSTANDING</td>
              <td class="num font-bold">${formatInr(data.total_minor)}</td>
            </tr>
          </tfoot>
        </table>
      `;

      return baseLayout({
        title: 'Accounts Receivable & Ageing Analysis',
        subtitle: 'Outstanding balances categorized by aging schedules and collection priority',
        dateRange: 'Current As Of Today',
        generatedAt,
        content,
      });
    }

    case 'tax': {
      const net = data.net || {};
      const rows = data.output_rows || [];
      const content = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Net Taxable Value</div>
            <div class="stat-value">${formatInr(net.taxable_minor)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Net Total GST</div>
            <div class="stat-value">${formatInr(net.tax_minor)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Central GST (CGST)</div>
            <div class="stat-value">${formatInr(net.cgst_minor)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">State GST (SGST)</div>
            <div class="stat-value">${formatInr(net.sgst_minor)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Integrated GST (IGST)</div>
            <div class="stat-value">${formatInr(net.igst_minor)}</div>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th>HSN/SAC</th>
              <th class="num">Rate (%)</th>
              <th class="num">Taxable Value</th>
              <th class="num">CGST</th>
              <th class="num">SGST</th>
              <th class="num">IGST</th>
              <th class="num">Total GST</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.hsn_sac || '—')}</strong></td>
                <td class="num">${((Number(r.tax_rate_bp || 0) / 100)).toFixed(2)}%</td>
                <td class="num">${formatInr(r.taxable_minor)}</td>
                <td class="num">${formatInr(r.cgst_minor)}</td>
                <td class="num">${formatInr(r.sgst_minor)}</td>
                <td class="num">${formatInr(r.igst_minor)}</td>
                <td class="num font-bold">${formatInr(r.tax_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="7" style="text-align:center; padding: 24px;">No taxable supply recorded in this range.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">NET TOTAL</td>
              <td class="num">${formatInr(net.taxable_minor)}</td>
              <td class="num">${formatInr(net.cgst_minor)}</td>
              <td class="num">${formatInr(net.sgst_minor)}</td>
              <td class="num">${formatInr(net.igst_minor)}</td>
              <td class="num font-bold">${formatInr(net.tax_minor)}</td>
            </tr>
          </tfoot>
        </table>
      `;

      return baseLayout({
        title: 'GST Tax Summary & Liability Schedule',
        subtitle: 'HSN/SAC and rate slab tax breakdown derived from issued invoices net of adjustment notes',
        dateRange,
        generatedAt,
        content,
      });
    }

    case 'quotations': {
      const rows = data.rows || [];
      const content = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Accepted Quotes</div>
            <div class="stat-value">${data.accepted || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Rejected Quotes</div>
            <div class="stat-value">${data.rejected || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Converted to Invoices</div>
            <div class="stat-value">${data.converted || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Acceptance Rate</div>
            <div class="stat-value">${((data.conversion_rate_bp || 0) / 100).toFixed(1)}%</div>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th>Quote #</th>
              <th>Client</th>
              <th>Title</th>
              <th>Issue Date</th>
              <th>Expiry Date</th>
              <th>Status</th>
              <th>Converted</th>
              <th class="num">Quoted Value</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.quotation_number || 'Draft')}</strong></td>
                <td>${esc(r.client_name)}</td>
                <td>${esc(r.title)}</td>
                <td>${formatDate(r.issue_date)}</td>
                <td>${formatDate(r.expiry_date)}</td>
                <td>${esc(r.effective_status)}</td>
                <td>${r.converted ? '<span style="color:#166534; font-weight:600;">Yes</span>' : '<span style="color:#64748b;">No</span>'}</td>
                <td class="num font-bold">${formatInr(r.grand_total_minor)}</td>
              </tr>
            `).join('') || '<tr><td colspan="8" style="text-align:center; padding: 24px;">No quotations issued in this range.</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7">DECIDED QUOTATION VALUE (Accepted)</td>
              <td class="num font-bold">${formatInr(data.decided_value_minor)}</td>
            </tr>
          </tfoot>
        </table>
      `;

      return baseLayout({
        title: 'Quotation Performance & Pipeline Analytics',
        subtitle: 'Estimate issuance, acceptance rates, and invoice conversion tracking',
        dateRange,
        generatedAt,
        content,
      });
    }

    default: {
      return baseLayout({
        title: 'Business Report',
        dateRange,
        generatedAt,
        content: '<p style="padding: 24px;">Report data generated.</p>',
      });
    }
  }
}
