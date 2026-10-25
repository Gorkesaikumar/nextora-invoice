/**
 * GST state codes (CBIC). Kept in one place so tax logic never compares free-text
 * state names, which is how place-of-supply mistakes happen.
 *
 * Declared as ordered pairs: plain object keys that look numeric are reordered by
 * the engine, which would scramble the list the operator sees in a dropdown.
 */
const ENTRIES = Object.freeze([
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
  ['96', 'Other Country'],
  ['97', 'Other Territory'],
]);

export const STATES = Object.freeze(Object.fromEntries(ENTRIES));

export const STATE_LIST = Object.freeze(ENTRIES.map(([code, name]) => ({ code, name })));

export const stateName = code => STATES[code] || '';

export function isKnownStateCode(code) {
  return typeof code === 'string' && Object.hasOwn(STATES, code);
}
