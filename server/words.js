/**
 * Amount in words using the Indian numbering system (crore / lakh / thousand).
 * Pure functions so the print output can be unit tested without a database.
 */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(value) {
  if (value < 20) return ONES[value];
  const tens = TENS[Math.floor(value / 10)];
  const ones = ONES[value % 10];
  return ones ? `${tens} ${ones}` : tens;
}

function threeDigits(value) {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (!hundreds) return twoDigits(rest);
  return rest ? `${ONES[hundreds]} Hundred and ${twoDigits(rest)}` : `${ONES[hundreds]} Hundred`;
}

/** Integer to words using Indian grouping: 12,34,56,789. */
export function numberToWords(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('numberToWords expects a non-negative safe integer');
  if (value === 0) return 'Zero';
  const parts = [];
  let rest = value;
  const crore = Math.floor(rest / 10000000);
  rest %= 10000000;
  const lakh = Math.floor(rest / 100000);
  rest %= 100000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (crore) parts.push(`${numberToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(' ');
}

/**
 * "Rupees One Lakh Twenty Three Thousand Four Hundred and Fifty Six and
 *  Seventy Eight Paise Only" - the convention used on Indian tax invoices.
 */
export function amountInWords(minorUnits, {
  unitName = 'Rupees',
  subUnitName = 'Paise',
  onlySuffix = 'Only',
} = {}) {
  if (!Number.isSafeInteger(minorUnits)) throw new Error('amountInWords expects an integer number of minor units');
  const negative = minorUnits < 0;
  const absolute = Math.abs(minorUnits);
  const major = Math.floor(absolute / 100);
  const minor = absolute % 100;
  const words = [];
  if (major > 0 || minor === 0) words.push(`${unitName} ${numberToWords(major)}`);
  if (minor > 0) words.push(`${major > 0 ? 'and ' : ''}${numberToWords(minor)} ${subUnitName}`);
  return `${negative ? 'Minus ' : ''}${words.join(' ')} ${onlySuffix}`.replace(/\s+/g, ' ').trim();
}

/** Indian digit grouping for display: 1234567 minor units -> 12,345.67 */
export function formatMinor(minorUnits, { symbol = '₹', decimals = 2 } = {}) {
  const negative = minorUnits < 0;
  const absolute = Math.abs(minorUnits);
  const major = String(Math.floor(absolute / 100));
  const minor = String(absolute % 100).padStart(2, '0');
  let grouped = major;
  if (major.length > 3) {
    const head = major.slice(0, -3);
    const tail = major.slice(-3);
    grouped = `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
  }
  const fraction = decimals === 2 ? `.${minor}` : '';
  return `${negative ? '-' : ''}${symbol}${grouped}${fraction}`;
}

/** Print-safe date: 2026-10-01 -> 01 Oct 2026. Timezone independent. */
export function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Indian financial year label: 2026-04-01 -> 2026-27 */
export function financialYear(date) {
  const value = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date;
  if (!Number.isFinite(value.getTime())) throw new Error('financialYear expects a valid date');
  const year = value.getUTCFullYear();
  const start = value.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
