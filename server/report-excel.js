import ExcelJS from 'exceljs';

const C_NAVY = '0F172A';
const C_HEADER_FILL = '1E293B';
const C_WHITE = 'FFFFFF';
const C_ZEBRA = 'F8FAFC';
const C_BORDER = 'E2E8F0';
const C_TOTALS_FILL = 'F1F5F9';

function formatInrNumber(minor) {
  return Number(minor || 0) / 100;
}

function safeStr(val) {
  if (val === null || val === undefined) return '—';
  return String(val);
}

function applyHeaderStyle(row, colCount) {
  row.height = 24;
  for (let c = 1; c <= colCount; c += 1) {
    const cell = row.getCell(c);
    cell.font = { name: 'Calibri', bold: true, color: { argb: C_WHITE }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: cell.alignment?.horizontal || 'left' };
    cell.border = {
      top: { style: 'thin', color: { argb: C_NAVY } },
      bottom: { style: 'thin', color: { argb: C_NAVY } },
    };
  }
}

function applyZebra(row, isEven, colCount) {
  if (!isEven) return;
  for (let c = 1; c <= colCount; c += 1) {
    const cell = row.getCell(c);
    if (!cell.fill) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_ZEBRA } };
    }
  }
}

function addMetaHeader(sheet, reportTitle, rangeLabel, generatedAt) {
  sheet.addRow(['NEXTORA CREATIONS — INVOICING & BUSINESS INTELLIGENCE']);
  const titleRow = sheet.getRow(1);
  titleRow.font = { name: 'Calibri', bold: true, size: 13, color: { argb: C_NAVY } };

  sheet.addRow([`Report: ${reportTitle}`]);
  sheet.getRow(2).font = { name: 'Calibri', bold: true, size: 11 };

  sheet.addRow([`Date Range: ${rangeLabel || 'All available records'} | Generated: ${generatedAt}`]);
  sheet.getRow(3).font = { name: 'Calibri', italic: true, size: 9, color: { argb: '64748B' } };

  sheet.addRow([]); // Blank spacer
}

function autoFitColumns(sheet) {
  sheet.columns.forEach(column => {
    let maxLen = 12;
    column.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber <= 3) return; // skip header metadata
      const text = cell.value ? String(cell.value) : '';
      if (text.length > maxLen) maxLen = text.length;
    });
    column.width = Math.min(maxLen + 4, 45);
  });
}

export async function renderReportExcel(section, data, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nextora Creations Invoice Generator';
  workbook.created = new Date();

  const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const rangeLabel = options.rangeLabel || (options.from && options.to ? `${options.from} to ${options.to}` : 'All available dates');

  switch (section) {
    case 'monthly_revenue': {
      const sheet = workbook.addWorksheet('Monthly Revenue');
      addMetaHeader(sheet, 'Monthly Company Revenue & Financial Reconciliation', rangeLabel, generatedAt);

      const headers = [
        'Month', 'Invoices Issued', 'Gross Invoiced', 'Discounts', 'Taxable Turnover',
        'CGST', 'SGST', 'IGST', 'Total Invoiced Value', 'Payments Collected',
        'Refunds & Credits', 'Net Collections', 'Outstanding Balance',
        'Influencer Attributed Sales', 'Eligible Commission', 'Commission Paid',
        'Commission Payable', 'MoM Invoiced Growth',
      ];
      sheet.addRow(headers);
      const hRow = sheet.getRow(5);
      applyHeaderStyle(hRow, headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          r.month,
          Number(r.invoices_count || 0),
          formatInrNumber(r.gross_invoiced_minor),
          formatInrNumber(r.discount_minor),
          formatInrNumber(r.taxable_minor),
          formatInrNumber(r.cgst_minor),
          formatInrNumber(r.sgst_minor),
          formatInrNumber(r.igst_minor),
          formatInrNumber(r.invoiced_minor),
          formatInrNumber(r.collected_minor),
          formatInrNumber(r.refunds_minor),
          formatInrNumber(r.net_collected_minor),
          formatInrNumber(r.balance_minor),
          formatInrNumber(r.influencer_sales_minor),
          formatInrNumber(r.commission_earned_minor),
          formatInrNumber(r.commission_paid_minor),
          formatInrNumber(r.commission_payable_minor),
          r.mom_growth_pct !== null && r.mom_growth_pct !== undefined ? `${r.mom_growth_pct}%` : '—',
        ]);
        for (let c = 3; c <= 17; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        added.getCell(2).numFmt = '#,##0';
        added.getCell(2).alignment = { horizontal: 'right' };
        added.getCell(18).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      // Totals row
      if (rows.length > 0) {
        const t = data.totals || {};
        const totRow = sheet.addRow([
          'TOTAL',
          Number(t.invoices_count || 0),
          formatInrNumber(t.gross_invoiced_minor),
          formatInrNumber(t.discount_minor),
          formatInrNumber(t.taxable_minor),
          formatInrNumber(t.cgst_minor),
          formatInrNumber(t.sgst_minor),
          formatInrNumber(t.igst_minor),
          formatInrNumber(t.invoiced_minor),
          formatInrNumber(t.collected_minor),
          formatInrNumber(t.refunds_minor),
          formatInrNumber(t.net_collected_minor),
          formatInrNumber(t.balance_minor),
          formatInrNumber(t.influencer_sales_minor),
          formatInrNumber(t.commission_earned_minor),
          formatInrNumber(t.commission_paid_minor),
          formatInrNumber(t.commission_payable_minor),
          '—',
        ]);
        totRow.font = { bold: true };
        for (let c = 1; c <= headers.length; c += 1) {
          const cell = totRow.getCell(c);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TOTALS_FILL } };
          cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
          if (c >= 3 && c <= 17) cell.numFmt = '₹#,##0.00';
        }
      }

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'clients': {
      const sheet = workbook.addWorksheet('Client Register');
      addMetaHeader(sheet, 'Complete Client Register & Revenue Ledger', rangeLabel, generatedAt);

      const headers = [
        'Client Name', 'Company Name', 'Email', 'Phone', 'State Code', 'GSTIN',
        'Quotations', 'Invoices', 'Gross Invoiced', 'Discounts', 'Taxable Value',
        'GST Amount', 'Net Invoiced', 'Collections', 'Refunds', 'Outstanding Balance',
        'Overdue Balance', 'First Invoice', 'Last Invoice', 'Last Payment', 'Status',
      ];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          safeStr(r.client_name),
          safeStr(r.company_name),
          safeStr(r.email),
          safeStr(r.phone),
          safeStr(r.state_code),
          safeStr(r.gstin),
          Number(r.quotation_count || 0),
          Number(r.invoice_count || 0),
          formatInrNumber(r.gross_invoiced_minor || r.invoiced_minor),
          formatInrNumber(r.discount_minor || 0),
          formatInrNumber(r.taxable_minor || 0),
          formatInrNumber(r.gst_minor || 0),
          formatInrNumber(r.invoiced_minor),
          formatInrNumber(r.collected_minor),
          formatInrNumber(r.refunds_minor || 0),
          formatInrNumber(r.balance_minor),
          formatInrNumber(r.overdue_minor),
          safeStr(r.first_invoice_date),
          safeStr(r.last_invoice_date),
          safeStr(r.last_payment_date),
          safeStr(r.status || 'ACTIVE'),
        ]);
        for (let c = 9; c <= 17; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        added.getCell(7).alignment = { horizontal: 'right' };
        added.getCell(8).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'invoices': {
      const sheet = workbook.addWorksheet('Invoice Register');
      addMetaHeader(sheet, 'Complete Invoice Register', rangeLabel, generatedAt);

      const headers = [
        'Invoice Number', 'Issue Date', 'Due Date', 'Client Name', 'Client GSTIN',
        'Document Status', 'Payment Status', 'Taxable Value', 'CGST', 'SGST', 'IGST',
        'Total GST', 'Grand Total', 'Amount Paid', 'Balance Due',
      ];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const totalGst = Number(r.cgst_minor || 0) + Number(r.sgst_minor || 0) + Number(r.igst_minor || 0);
        const added = sheet.addRow([
          safeStr(r.invoice_number),
          safeStr(r.issue_date),
          safeStr(r.due_date),
          safeStr(r.client_name),
          safeStr(r.client_gstin),
          safeStr(r.status),
          safeStr(r.payment_status),
          formatInrNumber(r.taxable_minor),
          formatInrNumber(r.cgst_minor),
          formatInrNumber(r.sgst_minor),
          formatInrNumber(r.igst_minor),
          formatInrNumber(totalGst),
          formatInrNumber(r.grand_total_minor),
          formatInrNumber(r.paid_minor),
          formatInrNumber(r.balance_due_minor),
        ]);
        for (let c = 8; c <= 15; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'quotations': {
      const sheet = workbook.addWorksheet('Quotation Register');
      addMetaHeader(sheet, 'Complete Quotation Register & Pipeline', rangeLabel, generatedAt);

      const headers = [
        'Quotation Number', 'Issue Date', 'Expiry Date', 'Client Name', 'Title',
        'Document Status', 'Effective Status', 'Converted to Invoice', 'Invoice Number',
        'Taxable Value', 'Total Tax', 'Quotation Total',
      ];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          safeStr(r.quotation_number),
          safeStr(r.issue_date),
          safeStr(r.expiry_date),
          safeStr(r.client_name),
          safeStr(r.title),
          safeStr(r.status),
          safeStr(r.effective_status),
          r.converted ? 'Yes' : 'No',
          safeStr(r.converted_invoice_number || '—'),
          formatInrNumber(r.taxable_minor || 0),
          formatInrNumber(r.tax_minor || 0),
          formatInrNumber(r.grand_total_minor),
        ]);
        for (let c = 10; c <= 12; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'products': {
      const sheet = workbook.addWorksheet('Product Performance');
      addMetaHeader(sheet, 'Product & Service Sales Analytics', rangeLabel, generatedAt);

      const headers = [
        'Item Description', 'SKU', 'Category', 'Unit', 'Quantity Sold', 'Line Items',
        'Invoices', 'Clients', 'Average Price', 'Taxable Value', 'Tax Amount',
        'Total Invoiced Turnover', 'Contribution Share',
      ];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          safeStr(r.description),
          safeStr(r.sku),
          safeStr(r.category),
          safeStr(r.unit),
          Number(r.quantity_milli || 0) / 1000,
          Number(r.line_items || 0),
          Number(r.invoices || 0),
          Number(r.clients || 0),
          formatInrNumber(r.average_price_minor),
          formatInrNumber(r.taxable_minor),
          formatInrNumber(r.tax_minor),
          formatInrNumber(r.total_minor),
          safeStr(r.contribution_pct || '0.0%'),
        ]);
        added.getCell(5).numFmt = '#,##0.00';
        added.getCell(5).alignment = { horizontal: 'right' };
        for (let c = 9; c <= 12; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        added.getCell(13).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'influencers': {
      const sheet = workbook.addWorksheet('Influencer Register');
      addMetaHeader(sheet, 'Influencer Marketing Partner Register & Revenue Performance', rangeLabel, generatedAt);

      const headers = [
        'Legal Name', 'Display Name', 'Instagram Handle', 'Contract Number',
        'Agreement Status', 'Commission Rate', 'Attributed Sales Count',
        'Total Attributed Sales', 'Verified Eligible Revenue', 'Calculated Commission',
        'Commission Paid', 'Commission Payable', 'Last Sale Date',
      ];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const commRate = r.commission_basis_points ? `${(Number(r.commission_basis_points) / 100).toFixed(2)}%` : '—';
        const added = sheet.addRow([
          safeStr(r.legal_name),
          safeStr(r.display_name),
          safeStr(r.instagram_username),
          safeStr(r.contract_number),
          safeStr(r.agreement_status || r.status),
          commRate,
          Number(r.total_sales || r.attributed_sales_count || 0),
          formatInrNumber(r.gross_sales_minor || r.total_sales_minor),
          formatInrNumber(r.verified_revenue_minor || r.eligible_revenue_minor),
          formatInrNumber(r.calculated_commission_minor || r.commission_earned_minor),
          formatInrNumber(r.paid_commission_minor),
          formatInrNumber(r.pending_commission_minor || r.commission_payable_minor),
          safeStr(r.last_sale_date),
        ]);
        for (let c = 8; c <= 12; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        added.getCell(6).alignment = { horizontal: 'right' };
        added.getCell(7).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'influencer_sales': {
      const sheet = workbook.addWorksheet('Influencer Sales Detail');
      addMetaHeader(sheet, 'Individual Influencer Sales Attribution Records', rangeLabel, generatedAt);

      const headers = [
        'Record ID', 'Batch Number', 'Purchase Date', 'Customer Name', 'Business Name',
        'Product Name', 'Influencer Partner', 'Instagram Handle', 'Sale Amount',
        'Discount', 'GST Amount', 'Refund Amount', 'Eligible Revenue', 'Commission Rate',
        'Calculated Commission', 'Commission Status', 'Revenue Verified',
      ];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const commRate = r.commission_rate_bp ? `${(Number(r.commission_rate_bp) / 100).toFixed(2)}%` : '—';
        const added = sheet.addRow([
          safeStr(r.id?.slice(0, 8)),
          safeStr(r.batch_number),
          safeStr(r.purchased_date),
          safeStr(r.customer_name),
          safeStr(r.business_name),
          safeStr(r.product_name),
          safeStr(r.influencer_name),
          safeStr(r.instagram_username),
          formatInrNumber(r.sale_amount_minor),
          formatInrNumber(r.discount_amount_minor),
          formatInrNumber(r.gst_amount_minor),
          formatInrNumber(r.refund_amount_minor),
          formatInrNumber(r.eligible_revenue_minor),
          commRate,
          formatInrNumber(r.calculated_commission_minor),
          safeStr(r.commission_status),
          r.is_revenue_verified ? 'Yes' : 'No',
        ]);
        for (let c of [9, 10, 11, 12, 13, 15]) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        added.getCell(14).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'collections': {
      const sheet = workbook.addWorksheet('Collections');
      addMetaHeader(sheet, 'Collections & Payment Receipts', rangeLabel, generatedAt);

      const headers = ['Receipt Number', 'Payment Date', 'Client Name', 'Invoice Number', 'Payment Method', 'Reference', 'Amount Received'];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          safeStr(r.receipt_number),
          safeStr(r.paid_on),
          safeStr(r.client_name),
          safeStr(r.invoice_number),
          safeStr(r.method),
          safeStr(r.reference),
          formatInrNumber(r.amount_minor),
        ]);
        added.getCell(7).numFmt = '₹#,##0.00';
        added.getCell(7).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'receivables': {
      const sheet = workbook.addWorksheet('Receivables & Aging');
      addMetaHeader(sheet, 'Accounts Receivable & Aging Schedule', rangeLabel, generatedAt);

      const headers = ['Invoice Number', 'Client Name', 'Company Name', 'Issue Date', 'Due Date', 'Days Overdue', 'Aging Bracket', 'Total Invoiced', 'Amount Paid', 'Balance Due'];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.rows || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          safeStr(r.invoice_number),
          safeStr(r.client_name),
          safeStr(r.client_company),
          safeStr(r.issue_date),
          safeStr(r.due_date),
          Number(r.days_overdue || 0),
          safeStr(r.ageing === 'NOT_DUE' ? 'Not due' : `${r.ageing} days`),
          formatInrNumber(r.grand_total_minor),
          formatInrNumber(r.paid_minor),
          formatInrNumber(r.balance_due_minor),
        ]);
        added.getCell(6).alignment = { horizontal: 'right' };
        for (let c = 8; c <= 10; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'tax': {
      const sheet = workbook.addWorksheet('GST Tax Summary');
      addMetaHeader(sheet, 'GST Output Tax Summary by HSN/SAC & Slab', rangeLabel, generatedAt);

      const headers = ['HSN / SAC Code', 'GST Rate Slab', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total GST Liability'];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.output_rows || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          safeStr(r.hsn_sac),
          r.tax_rate_bp ? `${(Number(r.tax_rate_bp) / 100).toFixed(2)}%` : '0.00%',
          formatInrNumber(r.taxable_minor),
          formatInrNumber(r.cgst_minor),
          formatInrNumber(r.sgst_minor),
          formatInrNumber(r.igst_minor),
          formatInrNumber(r.tax_minor),
        ]);
        for (let c = 3; c <= 7; c += 1) {
          added.getCell(c).numFmt = '₹#,##0.00';
          added.getCell(c).alignment = { horizontal: 'right' };
        }
        added.getCell(2).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'imports': {
      const sheet = workbook.addWorksheet('Sales Import Batches');
      addMetaHeader(sheet, 'Excel Sales Import Batch History & Reconciliation', rangeLabel, generatedAt);

      const headers = ['Batch Number', 'Imported Filename', 'Period Start', 'Period End', 'Total Records', 'Total Sales Amount', 'Total Calculated Commission', 'Status', 'Imported At'];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const rows = data.batches || [];
      rows.forEach((r, idx) => {
        const added = sheet.addRow([
          safeStr(r.batch_number),
          safeStr(r.filename),
          safeStr(r.period_start),
          safeStr(r.period_end),
          Number(r.total_records || 0),
          formatInrNumber(r.total_sales_minor),
          formatInrNumber(r.total_commission_minor),
          safeStr(r.status),
          safeStr(r.created_at),
        ]);
        added.getCell(5).numFmt = '#,##0';
        added.getCell(5).alignment = { horizontal: 'right' };
        added.getCell(6).numFmt = '₹#,##0.00';
        added.getCell(6).alignment = { horizontal: 'right' };
        added.getCell(7).numFmt = '₹#,##0.00';
        added.getCell(7).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, headers.length);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
      autoFitColumns(sheet);
      break;
    }

    case 'overview':
    default: {
      const sheet = workbook.addWorksheet('Executive Overview');
      addMetaHeader(sheet, 'Business Overview & Executive Metrics', rangeLabel, generatedAt);

      const m = data.metrics || {};
      const headers = ['Metric Name', 'Category', 'Current Period', 'Prior Period', 'Variance', 'Variance %'];
      sheet.addRow(headers);
      applyHeaderStyle(sheet.getRow(5), headers.length);

      const kpis = [
        ['Total Invoiced Sales', 'Sales', formatInrNumber(m.invoiced?.current), formatInrNumber(m.invoiced?.prior), formatInrNumber(m.invoiced?.diff), `${m.invoiced?.percent || 0}%`, true],
        ['Net Invoiced Sales', 'Sales', formatInrNumber(m.net_invoiced?.current), formatInrNumber(m.net_invoiced?.prior), formatInrNumber(m.net_invoiced?.diff), `${m.net_invoiced?.percent || 0}%`, true],
        ['Invoices Issued Count', 'Operations', Number(m.invoices_count?.current || 0), Number(m.invoices_count?.prior || 0), Number(m.invoices_count?.diff || 0), `${m.invoices_count?.percent || 0}%`, false],
        ['Actual Payments Collected', 'Cash Flow', formatInrNumber(m.collected?.current), formatInrNumber(m.collected?.prior), formatInrNumber(m.collected?.diff), `${m.collected?.percent || 0}%`, true],
        ['Refunds Issued', 'Cash Flow', formatInrNumber(m.refunds?.current), formatInrNumber(m.refunds?.prior), formatInrNumber(m.refunds?.diff), `${m.refunds?.percent || 0}%`, true],
        ['Outstanding Receivables', 'Cash Flow', formatInrNumber(m.receivables?.total_minor), '—', '—', '—', true],
        ['Overdue Receivables', 'Risk', formatInrNumber(m.overdue?.total_minor), '—', '—', '—', true],
        ['Taxable Turnover', 'Taxation', formatInrNumber(m.taxable?.current), formatInrNumber(m.taxable?.prior), formatInrNumber(m.taxable?.diff), `${m.taxable?.percent || 0}%`, true],
        ['CGST Liability', 'Taxation', formatInrNumber(m.cgst?.current), formatInrNumber(m.cgst?.prior), formatInrNumber(m.cgst?.diff), `${m.cgst?.percent || 0}%`, true],
        ['SGST Liability', 'Taxation', formatInrNumber(m.sgst?.current), formatInrNumber(m.sgst?.prior), formatInrNumber(m.sgst?.diff), `${m.sgst?.percent || 0}%`, true],
        ['IGST Liability', 'Taxation', formatInrNumber(m.igst?.current), formatInrNumber(m.igst?.prior), formatInrNumber(m.igst?.diff), `${m.igst?.percent || 0}%`, true],
        ['Total Output GST', 'Taxation', formatInrNumber(m.tax?.current), formatInrNumber(m.tax?.prior), formatInrNumber(m.tax?.diff), `${m.tax?.percent || 0}%`, true],
        ['Active Clients Billed', 'Clients', Number(m.active_clients?.current ?? m.active_clients ?? 0), Number(m.active_clients?.prior ?? 0), Number(m.active_clients?.diff ?? 0), `${m.active_clients?.percent || 0}%`, false],
        ['New Clients Added', 'Clients', Number(m.new_clients?.current || 0), Number(m.new_clients?.prior || 0), Number(m.new_clients?.diff || 0), `${m.new_clients?.percent || 0}%`, false],
        ['Total Quotations Issued', 'Pipeline', Number(m.quotations_issued?.current || 0), Number(m.quotations_issued?.prior || 0), Number(m.quotations_issued?.diff || 0), `${m.quotations_issued?.percent || 0}%`, false],
        ['Quotations Converted to Invoices', 'Pipeline', Number(m.quotations_converted?.current || 0), Number(m.quotations_converted?.prior || 0), Number(m.quotations_converted?.diff || 0), `${m.quotations_converted?.percent || 0}%`, false],
        ['Product Units Sold', 'Products', Number(m.units_sold?.current || 0), Number(m.units_sold?.prior || 0), Number(m.units_sold?.diff || 0), `${m.units_sold?.percent || 0}%`, false],
        ['Influencer-Attributed Sales', 'Marketing', formatInrNumber(m.influencer_attributed_sales?.current), formatInrNumber(m.influencer_attributed_sales?.prior), formatInrNumber(m.influencer_attributed_sales?.diff), `${m.influencer_attributed_sales?.percent || 0}%`, true],
        ['Influencer Commission Earned', 'Marketing', formatInrNumber(m.influencer_commission_earned?.current), formatInrNumber(m.influencer_commission_earned?.prior), formatInrNumber(m.influencer_commission_earned?.diff), `${m.influencer_commission_earned?.percent || 0}%`, true],
        ['Influencer Commission Paid', 'Marketing', formatInrNumber(m.influencer_commission_paid?.current), formatInrNumber(m.influencer_commission_paid?.prior), formatInrNumber(m.influencer_commission_paid?.diff), `${m.influencer_commission_paid?.percent || 0}%`, true],
        ['Influencer Commission Payable', 'Marketing', formatInrNumber(m.influencer_commission_payable?.current), formatInrNumber(m.influencer_commission_payable?.prior), formatInrNumber(m.influencer_commission_payable?.diff), `${m.influencer_commission_payable?.percent || 0}%`, true],
      ];

      kpis.forEach((row, idx) => {
        const isCur = row[6];
        const added = sheet.addRow([row[0], row[1], row[2], row[3], row[4], row[5]]);
        if (isCur) {
          added.getCell(3).numFmt = '₹#,##0.00';
          if (typeof row[3] === 'number') added.getCell(4).numFmt = '₹#,##0.00';
          if (typeof row[4] === 'number') added.getCell(5).numFmt = '₹#,##0.00';
        } else {
          added.getCell(3).numFmt = '#,##0';
          if (typeof row[3] === 'number') added.getCell(4).numFmt = '#,##0';
          if (typeof row[4] === 'number') added.getCell(5).numFmt = '#,##0';
        }
        added.getCell(3).alignment = { horizontal: 'right' };
        added.getCell(4).alignment = { horizontal: 'right' };
        added.getCell(5).alignment = { horizontal: 'right' };
        added.getCell(6).alignment = { horizontal: 'right' };
        applyZebra(added, idx % 2 === 1, 6);
      });

      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      autoFitColumns(sheet);
      break;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
