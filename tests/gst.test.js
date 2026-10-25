import test from 'node:test';
import assert from 'node:assert/strict';
import { gstinChecksumValid, gstinStateCode, supplyTypeFor, rateLabel, supplyTypeLabel } from '../server/gst.js';
import { STATES, isKnownStateCode, stateName } from '../server/states.js';

test('GSTIN check digit validation accepts the published sample and rejects tampering', () => {
  assert.equal(gstinChecksumValid('27AAPFU0939F1ZV'), true);
  assert.equal(gstinChecksumValid('27AAPFU0939F1ZX'), false);
  assert.equal(gstinChecksumValid('27AAPFU0939F1Z'), false);
  assert.equal(gstinChecksumValid('not-a-gstin'), false);
  assert.equal(gstinStateCode('27AAPFU0939F1ZV'), '27');
  assert.equal(gstinStateCode('27AAPFU0939F1ZX'), '');
});

test('place of supply drives the tax split using official state codes', () => {
  assert.equal(supplyTypeFor('36', '36'), 'INTRA');
  assert.equal(supplyTypeFor('36', '27'), 'INTER');
  assert.equal(supplyTypeFor('36', '96'), 'INTER'); // other country
  assert.equal(supplyTypeLabel('INTRA'), 'Intra-state (CGST + SGST)');
});

test('an unknown or missing state is an error, never a silent intra-state default', () => {
  assert.throws(() => supplyTypeFor('36', ''), { status: 400, code: 'PLACE_OF_SUPPLY_REQUIRED' });
  assert.throws(() => supplyTypeFor('36', '99'), { status: 400, code: 'PLACE_OF_SUPPLY_REQUIRED' });
  assert.throws(() => supplyTypeFor('36', 'Karnataka'), { status: 400, code: 'PLACE_OF_SUPPLY_REQUIRED' });
  assert.throws(() => supplyTypeFor('', '36'), { status: 409, code: 'SUPPLIER_STATE_REQUIRED' });
});

test('the state table is complete enough to cover every GST jurisdiction', () => {
  assert.ok(Object.keys(STATES).length >= 36);
  assert.equal(isKnownStateCode('07'), true);
  assert.equal(isKnownStateCode('7'), false);
  assert.equal(stateName('36'), 'Telangana');
  assert.equal(stateName('99'), '');
});

test('rates render without float artefacts', () => {
  assert.equal(rateLabel(1800), '18%');
  assert.equal(rateLabel(25), '0.25%');
  assert.equal(rateLabel(0), '0%');
});
