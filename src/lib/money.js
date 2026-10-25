/**
 * The browser preview imports the very same modules the server uses to store
 * and print totals. The preview therefore cannot drift from the saved figures:
 * rounding, allocation and tax splitting are literally one implementation.
 *
 * The server remains the only trusted source: every save re-computes totals and
 * the stored values are what the PDF and reports are built from.
 */
export {
  computeDocument, computeLine, percentOf, splitTax, allocateProportionally,
  applyPayments, paymentState, lineAmount, roundDiv,
  MINOR_PER_UNIT, BP_PER_UNIT, QUANTITY_SCALE, TAX_MODES,
} from '../../server/money.js';

export {
  amountInWords, numberToWords, formatMinor, formatDate, financialYear,
} from '../../server/words.js';
