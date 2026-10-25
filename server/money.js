/**
 * Deterministic money arithmetic.
 *
 * Every monetary value in this application is an integer count of minor units
 * (paise). Percentages are integer basis points (1800 = 18%). Quantities are
 * integer thousandths (2500 = 2.5). Nothing here uses floating point, so the
 * UI preview, the API response, the PDF and the stored snapshot agree exactly.
 */

export { formatMinor } from './words.js';

export function toMinor(major) {
  const value = Number(major || 0);
  return roundDiv(Math.round(value * 1000), 10);
}

export const MINOR_PER_UNIT = 100; // paise in a rupee
export const BP_PER_UNIT = 10000; // basis points in 100%
export const QUANTITY_SCALE = 1000; // thousandths
// Doubling a numerator must stay exact, so cap operands at 2^52.
const MAX_EXACT = 4503599627370496;

function checkInteger(value, label) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_EXACT) {
    const error = new Error(`Amount is too large to calculate exactly (${label}).`);
    error.status = 500;
    error.code = 'ARITHMETIC_OVERFLOW';
    throw error;
  }
  return value;
}

/** Integer division with half-away-from-zero rounding. Exact for any safe input. */
export function roundDiv(numerator, denominator) {
  checkInteger(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    const error = new Error('Invalid divisor for money arithmetic.');
    error.status = 500;
    error.code = 'ARITHMETIC_OVERFLOW';
    throw error;
  }
  const sign = numerator < 0 ? -1 : 1;
  const magnitude = Math.abs(numerator);
  return sign * Math.floor((magnitude * 2 + denominator) / (denominator * 2));
}

/** basisPoints percent of an amount, rounded half-up. 1800 bp of 10000 paise = 1800. */
export function percentOf(amountMinor, basisPoints) {
  checkInteger(amountMinor, 'amount');
  checkInteger(basisPoints, 'rate');
  const product = amountMinor * basisPoints;
  checkInteger(product, 'amount x rate');
  return roundDiv(product, BP_PER_UNIT);
}

/** unit price x quantity where quantity is thousandths. */
export function lineAmount(unitPriceMinor, quantityMilli) {
  checkInteger(unitPriceMinor, 'unit price');
  checkInteger(quantityMilli, 'quantity');
  const product = unitPriceMinor * quantityMilli;
  checkInteger(product, 'line amount');
  return roundDiv(product, QUANTITY_SCALE);
}

/** Order-preserving sum that refuses to silently exceed exact integer range. */
export function sum(values) {
  return checkInteger(values.reduce((total, value) => total + value, 0), 'total');
}

/**
 * Splits an amount across weights using the largest-remainder method so the
 * parts always add back to the original amount - no lost or invented paise.
 */
export function allocateProportionally(amount, weights) {
  checkInteger(amount, 'allocation');
  const total = sum(weights);
  if (total === 0) {
    if (amount !== 0) {
      const error = new Error('A discount cannot be allocated across zero-value lines.');
      error.status = 400;
      error.code = 'ALLOCATION_NOT_POSSIBLE';
      throw error;
    }
    return weights.map(() => 0);
  }
  const shares = weights.map(weight => {
    checkInteger(amount * weight, 'allocation share');
    return Math.floor((amount * weight) / total);
  });
  const remainders = weights.map((weight, index) => ({ remainder: (amount * weight) % total, index }));
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const leftover = amount - sum(shares);
  for (let i = 0; i < leftover; i += 1) shares[remainders[i % weights.length].index] += 1;
  return shares;
}

/** Splits tax into CGST+SGST for intra-state supply, or IGST for inter-state. */
export function splitTax(taxMinor, supplyType) {
  if (supplyType === 'INTER') return { cgst_minor: 0, sgst_minor: 0, igst_minor: taxMinor };
  const cgst = Math.floor(taxMinor / 2);
  return { cgst_minor: cgst, sgst_minor: taxMinor - cgst, igst_minor: 0 };
}

export const TAX_MODES = Object.freeze(['EXCLUSIVE', 'INCLUSIVE']);

const exempt = treatment => treatment !== 'TAXABLE';

/** Computes one line item exactly as the server will store it. */
export function computeLine(item, { invoiceDiscountAllocation = 0, tax_mode = 'EXCLUSIVE' } = {}) {
  const mode = item.tax_mode || tax_mode || 'EXCLUSIVE';
  const gross = lineAmount(item.unit_price_minor, item.quantity_milli);
  const itemDiscount = item.discount_bp > 0
    ? percentOf(gross, item.discount_bp)
    : Math.min(item.discount_minor || 0, gross);
  const net = gross - itemDiscount;
  const payable = net - invoiceDiscountAllocation;
  if (payable < 0) {
    const error = new Error('Discounts cannot exceed the line value.');
    error.status = 400;
    error.code = 'DISCOUNT_EXCEEDS_VALUE';
    throw error;
  }
  const isExempt = exempt(item.tax_treatment) || !item.tax_rate_bp;
  let taxable = payable;
  let tax = 0;
  if (!isExempt) {
    if (mode === 'INCLUSIVE') {
      taxable = roundDiv(payable * BP_PER_UNIT, BP_PER_UNIT + item.tax_rate_bp);
      tax = payable - taxable;
    } else {
      taxable = payable;
      tax = percentOf(taxable, item.tax_rate_bp);
    }
  }
  return {
    gross_minor: gross,
    item_discount_minor: itemDiscount,
    invoice_discount_minor: invoiceDiscountAllocation,
    taxable_minor: taxable,
    tax_minor: tax,
    total_minor: taxable + tax,
    exempt: exempt(item.tax_treatment),
    tax_mode: mode,
  };
}

/**
 * The single source of truth for document totals. The browser may show a live
 * preview, but these are the numbers written to the database and the PDF.
 */
export function computeDocument({
  items = [],
  additional_charges = [],
  invoice_discount_bp = 0,
  invoice_discount_minor = 0,
  supply_type = 'INTRA',
  round_off_enabled = true,
  tax_mode = 'EXCLUSIVE',
} = {}) {
  const mode = tax_mode || 'EXCLUSIVE';
  const nets = items.map(item => {
    const gross = lineAmount(item.unit_price_minor, item.quantity_milli);
    const itemDiscount = item.discount_bp > 0
      ? percentOf(gross, item.discount_bp)
      : Math.min(item.discount_minor || 0, gross);
    return gross - itemDiscount;
  });
  const netTotal = sum(nets);
  const invoiceDiscount = invoice_discount_bp > 0
    ? percentOf(netTotal, invoice_discount_bp)
    : invoice_discount_minor;
  if (invoiceDiscount > netTotal) {
    const error = new Error('The invoice discount cannot exceed the net amount.');
    error.status = 400;
    error.code = 'DISCOUNT_EXCEEDS_VALUE';
    throw error;
  }
  const allocations = allocateProportionally(invoiceDiscount, nets);

  const lines = items.map((item, index) => {
    const share = allocations[index];
    const line = computeLine(item, { invoiceDiscountAllocation: share, tax_mode: mode });
    const split = splitTax(line.tax_minor, supply_type);
    return {
      ...item,
      tax_mode: line.tax_mode,
      gross_minor: line.gross_minor,
      item_discount_minor: line.item_discount_minor,
      invoice_discount_minor: share,
      taxable_minor: line.taxable_minor,
      tax_minor: line.tax_minor,
      exempt: line.exempt,
      ...split,
      total_minor: line.taxable_minor + line.tax_minor,
    };
  });

  const charges = additional_charges.map(charge => {
    const tax = exempt(charge.tax_treatment) ? 0 : percentOf(charge.amount_minor, charge.tax_rate_bp);
    const split = splitTax(tax, supply_type);
    return {
      ...charge,
      tax_minor: tax,
      ...split,
      total_minor: charge.amount_minor + tax,
    };
  });

  const lineTaxableTotal = sum(lines.map(line => line.taxable_minor));
  const lineTaxTotal = sum(lines.map(line => line.tax_minor));
  const chargeTaxableTotal = sum(charges.filter(c => !exempt(c.tax_treatment)).map(c => c.amount_minor));
  const chargeTaxTotal = sum(charges.map(charge => charge.tax_minor));
  const taxableTotal = lineTaxableTotal + chargeTaxableTotal;
  const cgstTotal = sum(lines.map(l => l.cgst_minor)) + sum(charges.map(c => c.cgst_minor));
  const sgstTotal = sum(lines.map(l => l.sgst_minor)) + sum(charges.map(c => c.sgst_minor));
  const igstTotal = sum(lines.map(l => l.igst_minor)) + sum(charges.map(c => c.igst_minor));
  const taxTotal = lineTaxTotal + chargeTaxTotal;

  // The grand total always carries the full value of every charge, including
  // charges that sit outside GST and therefore never appear in the tax value.
  const totalBeforeRound = lineTaxableTotal + lineTaxTotal + sum(charges.map(charge => charge.total_minor));
  const roundOff = round_off_enabled
    ? roundDiv(totalBeforeRound, MINOR_PER_UNIT) * MINOR_PER_UNIT - totalBeforeRound
    : 0;

  return {
    lines,
    charges,
    totals: {
      gross_total_minor: sum(lines.map(line => line.gross_minor)),
      item_discount_total_minor: sum(lines.map(line => line.item_discount_minor)),
      invoice_discount_total_minor: sum(lines.map(line => line.invoice_discount_minor)),
      net_subtotal_minor: netTotal,
      taxable_total_minor: taxableTotal,
      exempt_total_minor: sum(lines.filter(line => line.exempt).map(line => line.taxable_minor)),
      cgst_total_minor: cgstTotal,
      sgst_total_minor: sgstTotal,
      igst_total_minor: igstTotal,
      tax_total_minor: taxTotal,
      charges_total_minor: sum(charges.map(charge => charge.total_minor)),
      total_before_round_minor: totalBeforeRound,
      round_off_minor: roundOff,
      grand_total_minor: totalBeforeRound + roundOff,
      supply_type,
      round_off_enabled: Boolean(round_off_enabled),
      tax_mode: mode,
    },
  };
}

/** Applies recorded payments to a grand total. Payments are never trusted from the client. */
export function applyPayments(grandTotalMinor, payments = []) {
  const paid = sum(payments.map(payment => payment.amount_minor));
  return { amount_paid_minor: paid, balance_due_minor: grandTotalMinor - paid };
}

/**
 * Payment state is derived from money received, never from document status and
 * never from a button click.
 */
export function paymentState(grandTotalMinor, paidMinor, dueDate, today) {
  if (paidMinor >= grandTotalMinor && grandTotalMinor >= 0) {
    if (paidMinor > grandTotalMinor) return 'OVERPAID';
    return 'PAID';
  }
  if (paidMinor > 0) return 'PARTIALLY_PAID';
  return dueDate && today > dueDate ? 'OVERDUE' : 'UNPAID';
}
