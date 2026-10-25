import { rateLabel } from './gst.js';
import { formatDate } from './words.js';

/**
 * A quotation, a tax invoice, a receipt and a credit note are different legal
 * artefacts, so their titles, totals rows and notes are declared per type rather
 * than branched inline in the renderer.
 */
export function formulaLabel(kind) {
  const isQuotation = kind === 'QUOTATION';
  const isReceipt = kind === 'PAYMENT_RECEIPT';
  const isCredit = kind === 'CREDIT_NOTE';
  const isDebit = kind === 'DEBIT_NOTE';
  return {
    title: isQuotation ? 'QUOTATION'
      : isReceipt ? 'PAYMENT RECEIPT'
        : isCredit ? 'CREDIT NOTE'
          : isDebit ? 'DEBIT NOTE' : 'TAX INVOICE',
    subtitle: isQuotation ? 'A commercial offer - acceptance does not mean payment has been made'        : isReceipt ? 'Acknowledges money actually received against the invoice named here'
        : isCredit ? 'Reduces the value of the invoice below'
          : isDebit ? 'Increases the value of the invoice below'
            : 'Issued for the supply described below',
    footer: isQuotation ? 'Quotation' : isReceipt ? 'Payment receipt' : isCredit ? 'Credit note' : isDebit ? 'Debit note' : 'Tax invoice',
    partyLabel: isReceipt ? 'Received from' : isQuotation ? 'Quotation for' : 'Bill to',
    supplyLabel: isReceipt ? 'Invoice settled' : isQuotation ? 'Offer details' : 'Supply details',
    meta(details, snapshot = {}) {
      // A receipt is dated by when the money arrived, not by an issue date it
      // does not have, so it never prints an empty date row.
      const rows = [];
      if (isReceipt) rows.push(['Receipt date', formatDate(snapshot.receipt?.paid_on || details.issue_date)]);
      else rows.push(['Issue date', formatDate(details.issue_date)]);
      if (isQuotation) rows.push(['Valid until', details.expiry_date ? formatDate(details.expiry_date) : 'Not set']);
      if (!isQuotation && !isReceipt) rows.push(['Due date', details.due_date ? formatDate(details.due_date) : 'On receipt']);
      if (isReceipt) rows.push(['Currency', 'INR']);
      return rows;
    },
    totals(totals, money) {
      const rows = [];
      const chargesPre = Number(totals.charges_pre_tax_minor || 0);
      const discount = (totals.item_discount_total_minor || 0) + (totals.invoice_discount_total_minor || 0);
      rows.push(['Subtotal', money(totals.gross_total_minor || 0)]);
      if (discount) rows.push(['Discount', `- ${money(discount)}`]);
      rows.push(['Taxable value', money(totals.taxable_total_minor || 0)]);
      if (totals.cgst_total_minor) rows.push(['CGST', money(totals.cgst_total_minor)]);
      if (totals.sgst_total_minor) rows.push(['SGST', money(totals.sgst_total_minor)]);
      if (totals.igst_total_minor) rows.push(['IGST', money(totals.igst_total_minor)]);
      if (chargesPre) rows.push(['Additional charges', money(chargesPre)]);
      if (totals.round_off_minor) rows.push(['Round off', money(totals.round_off_minor)]);
      rows.push(['Grand total', money(totals.grand_total_minor || 0), true]);
      if (totals.payment_summary) {
        rows.push(['Amount paid', money(totals.payment_summary.amount_paid_minor)]);
        rows.push(['Balance due', money(totals.payment_summary.balance_due_minor), true]);
      }
      return rows;
    },
    sections(details, snapshot) {
      void snapshot;
      return [
        ['Project description', details.description],
        ['Scope of work', details.scope_of_work],
        ['Inclusions', details.inclusions],
        ['Exclusions', details.exclusions],
        ['Assumptions', details.assumptions],
        ['Delivery timeline', details.delivery_timeline],
        ['Warranty and support', details.warranty_terms],
        ['Payment terms', details.payment_terms],
        ['Notes', details.notes],
        ['Terms and conditions', details.terms],
      ].filter(([, body]) => String(body || '').trim());
    },
  };
}

export { rateLabel };
