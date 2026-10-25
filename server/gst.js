import { HttpError } from './domain.js';
import { isKnownStateCode, stateName } from './states.js';

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Official GSTIN check digit algorithm. Format validation alone is not proof of registration. */
export function gstinChecksumValid(value) {
  if (typeof value !== 'string' || value.length !== 15) return false;
  const body = value.slice(0, 14).toUpperCase();
  let total = 0;
  for (let index = 0; index < body.length; index += 1) {
    const position = GSTIN_ALPHABET.indexOf(body[index]);
    if (position < 0) return false;
    const factor = index % 2 === 0 ? 1 : 2;
    const product = position * factor;
    total += Math.floor(product / 36) + (product % 36);
  }
  const expected = GSTIN_ALPHABET[(36 - (total % 36)) % 36];
  return expected === value[14].toUpperCase();
}

export function gstinStateCode(value) {
  return gstinChecksumValid(value) ? value.slice(0, 2) : '';
}

/**
 * Place of supply decides the tax split. It is compared on official state codes,
 * never on free-text state names, and an unknown code is an error rather than a
 * silent fallback to intra-state.
 */
export function supplyTypeFor(supplierStateCode, placeOfSupplyStateCode) {
  if (!isKnownStateCode(supplierStateCode)) {
    throw new HttpError(409, 'Configure the business state code in Settings before issuing documents.', 'SUPPLIER_STATE_REQUIRED');
  }
  if (!isKnownStateCode(placeOfSupplyStateCode)) {
    throw new HttpError(400, 'Select the place of supply for this transaction.', 'PLACE_OF_SUPPLY_REQUIRED');
  }
  if (placeOfSupplyStateCode === '96') return 'INTER'; // export / other country: IGST treatment
  return placeOfSupplyStateCode === supplierStateCode ? 'INTRA' : 'INTER';
}

export function supplyTypeLabel(supplyType) {
  return supplyType === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)';
}

export function placeOfSupplyLabel(supplierStateCode, placeOfSupplyStateCode) {
  const place = stateName(placeOfSupplyStateCode) || 'Not selected';
  const supplier = stateName(supplierStateCode) || 'Not configured';
  return { place, supplier, supply_type: isKnownStateCode(supplierStateCode) && isKnownStateCode(placeOfSupplyStateCode)
    ? supplyTypeFor(supplierStateCode, placeOfSupplyStateCode) : null };
}

/**
 * Common GST rate slabs. Rates are data, not law: the owner selects what applies
 * to a given supply, and an exempt/nil-rated classification simply carries 0%.
 */
export const GST_RATE_SLABS = Object.freeze([
  { bp: 0, label: '0% (exempt / nil rated)' },
  { bp: 25, label: '0.25%' },
  { bp: 300, label: '3%' },
  { bp: 500, label: '5%' },
  { bp: 1200, label: '12%' },
  { bp: 1800, label: '18%' },
  { bp: 2800, label: '28%' },
]);

export function rateLabel(bp) {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
}

export const NON_TAXABLE_TREATMENTS = Object.freeze(['EXEMPT', 'NIL_RATED', 'NON_GST', 'OUT_OF_SCOPE']);

export function treatmentLabel(treatment) {
  return {
    TAXABLE: 'Taxable',
    EXEMPT: 'Exempt',
    NIL_RATED: 'Nil rated',
    NON_GST: 'Outside GST',
    OUT_OF_SCOPE: 'Out of scope',
  }[treatment] || treatment;
}
