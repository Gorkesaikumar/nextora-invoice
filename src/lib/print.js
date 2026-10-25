import { esc, money, percent, titleCase, statusLabel } from './ui.js';
import { date, words } from './ui.js';
import { formatDate } from './money.js';

const TITLES = {
  QUOTATION: 'QUOTATION', TAX_INVOICE: 'TAX INVOICE', CREDIT_NOTE: 'CREDIT NOTE',
  DEBIT_NOTE: 'DEBIT NOTE', PAYMENT_RECEIPT: 'PAYMENT RECEIPT',
};

/**
 * Prints a clean A4 sheet with no application navigation or editor controls.
 * The data comes from the same stored rows the PDF is generated from, so the
 * figures on paper always match the saved financial record.
 */
export function printDocument({ kind, document, items, milestones = [], client, business, payments = [], notes = [] }) {
  const totals = document.totals || {};
  const isQuotation = kind === 'QUOTATION';
  const isDraft = document.status === 'DRAFT';
  const paid = payments.reduce((total, payment) => total + payment.amount_minor, 0);
  const grand = totals.grand_total_minor || 0;

  const section = (title, body) => (String(body || '').trim()
    ? `<section class="mt-4"><h3>${esc(title)}</h3><p>${esc(body)}</p></section>` : '');

  const chargeSum = (document.additional_charges || []).reduce((total, charge) => total + charge.amount_minor, 0);

  const totalsRows = [
    ['Subtotal', money(totals.gross_total_minor || 0)],
    ...(totals.item_discount_total_minor || totals.invoice_discount_total_minor
      ? [['Discount', `- ${money((totals.item_discount_total_minor || 0) + (totals.invoice_discount_total_minor || 0))}`]] : []),
    ['Taxable value', money(totals.taxable_total_minor || 0)],
    ...(totals.cgst_total_minor ? [['CGST', money(totals.cgst_total_minor)]] : []),
    ...(totals.sgst_total_minor ? [['SGST', money(totals.sgst_total_minor)]] : []),
    ...(totals.igst_total_minor ? [['IGST', money(totals.igst_total_minor)]] : []),
    ...(chargeSum ? [['Additional charges', money(chargeSum)]] : []),
    ...(totals.round_off_minor ? [['Round off', money(totals.round_off_minor)]] : []),
  ];

  const sheet = `
    <div class="print-sheet mx-auto bg-white p-8 text-[11px] leading-relaxed text-black" style="width:210mm;min-height:280mm">
      <div class="flex items-start justify-between gap-6 border-b border-black pb-3">
        <div>
          <p class="text-lg font-bold">${esc(business?.business_name || 'Nextora Creations')}</p>
          <p class="whitespace-pre-line text-[10px]">${esc(business?.address || '')}</p>
          <p class="text-[10px]">${esc([business?.email, business?.phone].filter(Boolean).join('  |  '))}</p>
          <p class="text-[10px]">${esc(business?.website || '')}</p>
        </div>
        <div class="text-right text-[10px]">
          ${business?.gstin ? `<p>GSTIN: ${esc(business.gstin)}</p>` : ''}
          ${business?.pan ? `<p>PAN: ${esc(business.pan)}</p>` : ''}
          ${business?.state_code ? `<p>State code: ${esc(business.state_code)}</p>` : ''}
        </div>
      </div>

      <div class="mt-4 flex items-start justify-between gap-6">
        <div>
          <p class="text-base font-bold">${TITLES[kind] || 'DOCUMENT'}</p>
          <p class="font-mono text-[11px]">${esc(document.invoice_number || document.quotation_number || 'DRAFT')}</p>
        </div>
        <table class="text-right text-[10px]">
          <tr><td class="pr-3 text-gray-600">Issue date</td><td>${esc(formatDate(document.issue_date))}</td></tr>
          ${isQuotation
    ? `<tr><td class="pr-3 text-gray-600">Valid until</td><td>${document.expiry_date ? esc(formatDate(document.expiry_date)) : 'Not set'}</td></tr>`
    : `<tr><td class="pr-3 text-gray-600">Due date</td><td>${document.due_date ? esc(formatDate(document.due_date)) : 'On receipt'}</td></tr>`}
          <tr><td class="pr-3 text-gray-600">Supply</td><td>${document.supply_type === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</td></tr>
          <tr><td class="pr-3 text-gray-600">Place of supply</td><td>${esc(document.place_of_supply_state_code || 'Not selected')}</td></tr>
          ${document.po_reference ? `<tr><td class="pr-3 text-gray-600">PO reference</td><td>${esc(document.po_reference)}</td></tr>` : ''}
          ${document.project_reference ? `<tr><td class="pr-3 text-gray-600">Project</td><td>${esc(document.project_reference)}</td></tr>` : ''}
          <tr><td class="pr-3 text-gray-600">Status</td><td>${esc(statusLabel(document.status))}</td></tr>
        </table>
      </div>

      <div class="mt-4 border-t border-gray-300 pt-3">
        <p class="text-[9px] uppercase tracking-wider text-gray-600">${isQuotation ? 'Quotation for' : 'Bill to'}</p>
        <p class="font-semibold">${esc(client?.name || '')}</p>
        ${client?.company_name && client.company_name !== client.name ? `<p>${esc(client.company_name)}</p>` : ''}
        ${client?.contact_person ? `<p>Attn: ${esc(client.contact_person)}</p>` : ''}
        <p class="whitespace-pre-line">${esc(client?.billing_address || '')}</p>
        <p>${esc([client?.email, client?.phone].filter(Boolean).join('  |  '))}</p>
        ${client?.gstin ? `<p>GSTIN: ${esc(client.gstin)}</p>` : ''}
      </div>

      <table class="mt-4 w-full border-collapse text-[10px]">
        <thead>
          <tr class="border-y border-black text-left">
            <th class="py-1">#</th><th class="py-1">Description</th><th class="py-1 text-right">Qty</th>
            <th class="py-1 text-right">Rate</th><th class="py-1 text-right">Taxable</th>
            <th class="py-1 text-right">GST</th><th class="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, index) => `<tr class="border-b border-gray-200 align-top">
            <td class="py-1">${index + 1}</td>
            <td class="py-1">${esc(item.description)}
              ${item.hsn_sac ? `<div class="text-gray-600">HSN/SAC ${esc(item.hsn_sac)}</div>` : ''}
              ${item.tax_treatment !== 'TAXABLE' ? `<div class="text-gray-600">${esc(titleCase(item.tax_treatment))}</div>` : (item.tax_mode === 'INCLUSIVE' ? '<div class="text-gray-600">Price includes GST</div>' : '')}</td>
            <td class="py-1 text-right">${(item.quantity_milli / 1000).toString().replace(/\.?0+$/, '')} ${esc(item.unit)}</td>
            <td class="py-1 text-right">${money(item.unit_price_minor)}</td>
            <td class="py-1 text-right">${money(item.taxable_minor)}</td>
            <td class="py-1 text-right">${item.tax_minor ? `${percent(item.tax_rate_bp)} · ${money(item.tax_minor)}` : '—'}</td>
            <td class="py-1 text-right">${money(item.total_minor)}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="mt-3 flex justify-end">
        <table class="w-1/2 text-[10px]">
          ${totalsRows.map(([label, value]) => `<tr><td class="py-0.5 text-gray-600">${esc(label)}</td><td class="py-0.5 text-right">${value}</td></tr>`).join('')}
          <tr class="border-t border-black font-bold"><td class="py-1">Grand total</td><td class="py-1 text-right">${money(grand)}</td></tr>
          ${kind === 'TAX_INVOICE' ? `
            <tr><td class="py-0.5 text-gray-600">Amount paid</td><td class="py-0.5 text-right">${money(paid)}</td></tr>
            <tr class="font-semibold"><td class="py-0.5">Balance due</td><td class="py-0.5 text-right">${money(grand - paid)}</td></tr>` : ''}
        </table>
      </div>

      <p class="mt-3 border-t border-gray-300 pt-2"><span class="text-gray-600">Amount in words: </span><strong>${esc(words(grand))}</strong></p>

      ${milestones.length ? `<section class="mt-4"><h3 class="text-[9px] uppercase tracking-wider text-gray-600">Payment milestones</h3>
        <table class="w-full text-[10px]"><tbody>
        ${milestones.map(milestone => `<tr class="border-b border-gray-200">
          <td class="py-1">${esc(milestone.title)}</td>
          <td class="py-1">${percent(milestone.share_bp)}</td>
          <td class="py-1 text-right">${money(milestone.amount_minor)}</td></tr>`).join('')}
        </tbody></table></section>` : ''}

      ${section('Project description', document.description)}
      ${section('Scope of work', document.scope_of_work)}
      ${section('Inclusions', document.inclusions)}
      ${section('Exclusions', document.exclusions)}
      ${section('Assumptions', document.assumptions)}
      ${section('Delivery timeline', document.delivery_timeline)}
      ${section('Warranty and support', document.warranty_terms)}
      ${section('Payment terms', document.payment_terms)}
      ${section('Notes', document.notes)}
      ${section('Terms and conditions', document.terms)}
      ${notes.length ? `<section class="mt-4"><h3>Adjustment notes</h3><ul>${notes.map(note => `<li>${esc(note.note_number)} · ${esc(note.reason)} · ${money(note.totals.grand_total_minor)}</li>`).join('')}</ul></section>` : ''}

      <div class="mt-6 flex items-end justify-between gap-6 border-t border-gray-300 pt-3">
        <div class="text-[10px]">
          ${business?.show_bank_details !== false && (business?.bank_account_number || business?.upi_id)
    ? `<p class="text-[9px] uppercase tracking-wider text-gray-600">Payment details</p>
              ${business.bank_account_name ? `<p>Account name: ${esc(business.bank_account_name)}</p>` : ''}
              ${business.bank_name ? `<p>Bank: ${esc(business.bank_name)}</p>` : ''}
              ${business.bank_account_number ? `<p>A/C number: ${esc(business.bank_account_number)}</p>` : ''}
              ${business.bank_ifsc ? `<p>IFSC: ${esc(business.bank_ifsc)}</p>` : ''}
              ${business.upi_id ? `<p>UPI: ${esc(business.upi_id)}</p>` : ''}` : ''}
        </div>
        ${business?.show_signatory !== false && business?.signatory_name ? `<div class="text-right text-[10px]">
          <p class="mt-8 border-t border-black pt-1">For ${esc(business.business_name)}</p>
          <p class="font-semibold">${esc(business.signatory_name)}</p>
          <p class="text-gray-600">${esc(business.signatory_title || 'Authorised signatory')}</p>
        </div>` : ''}
      </div>

      <p class="mt-4 border-t border-gray-300 pt-2 text-[9px] text-gray-600">
        Computer generated document · printed ${esc(date(new Date().toISOString().slice(0, 10)))}
        ${isDraft ? ' · DRAFT — this is not an issued document' : ''}
      </p>
    </div>`;

  // `document` above is the stored record, so the DOM document must be reached
  // through globalThis. The root is a body child: the print stylesheet hides
  // every sibling, which would also hide a sheet nested inside the app shell.
  const dom = globalThis.document;
  const root = dom.getElementById('print-root');
  if (!root) throw new Error('The print container is missing from the page.');
  root.className = 'hidden print:block';
  root.innerHTML = sheet;
  if (globalThis.window?.electronAPI?.print) {
    globalThis.window.electronAPI.print();
  } else {
    globalThis.print();
  }
  // The sheet stays until the next print so repeat prints remain instant.
}
