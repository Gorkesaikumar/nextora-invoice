import test from 'node:test';
import assert from 'node:assert/strict';
import { numberToWords, amountInWords, formatMinor, financialYear } from '../server/words.js';

test('numbers use Indian grouping, not thousands grouping', () => {
  assert.equal(numberToWords(0), 'Zero');
  assert.equal(numberToWords(15), 'Fifteen');
  assert.equal(numberToWords(20), 'Twenty');
  assert.equal(numberToWords(100), 'One Hundred');
  assert.equal(numberToWords(456), 'Four Hundred and Fifty Six');
  assert.equal(numberToWords(1000), 'One Thousand');
  assert.equal(numberToWords(100000), 'One Lakh');
  assert.equal(numberToWords(10000000), 'One Crore');
  assert.equal(numberToWords(123456), 'One Lakh Twenty Three Thousand Four Hundred and Fifty Six');
  assert.equal(numberToWords(12345678), 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight');
});

test('amounts in words follow the tax-invoice convention', () => {
  assert.equal(amountInWords(12345678),
    'Rupees One Lakh Twenty Three Thousand Four Hundred and Fifty Six and Seventy Eight Paise Only');
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(100), 'Rupees One Only');
  assert.equal(amountInWords(50), 'Fifty Paise Only');
  assert.equal(amountInWords(-250), 'Minus Rupees Two and Fifty Paise Only');
  assert.throws(() => amountInWords(1.5));
});

test('display formatting groups the Indian way', () => {
  assert.equal(formatMinor(12345678), '₹1,23,456.78');
  assert.equal(formatMinor(100), '₹1.00');
  assert.equal(formatMinor(0), '₹0.00');
  assert.equal(formatMinor(99999), '₹999.99');
  assert.equal(formatMinor(-12345678), '-₹1,23,456.78');
});

test('financial year follows the Indian April-March cycle', () => {
  assert.equal(financialYear('2026-04-01'), '2026-27');
  assert.equal(financialYear('2026-03-31'), '2025-26');
  assert.equal(financialYear('2026-12-31'), '2026-27');
  assert.equal(financialYear('2027-01-01'), '2026-27');
  assert.equal(financialYear(new Date('2029-04-15T00:00:00Z')), '2029-30');
});
