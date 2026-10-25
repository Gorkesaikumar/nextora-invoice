import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundDiv, percentOf, lineAmount, allocateProportionally, splitTax,
  computeLine, computeDocument, applyPayments, paymentState,
} from '../server/money.js';

const item = (overrides = {}) => ({
  description: 'Service', unit: 'NOS', hsn_sac: '', quantity_milli: 1000,
  unit_price_minor: 100000, discount_bp: 0, discount_minor: 0,
  tax_rate_bp: 1800, tax_treatment: 'TAXABLE', ...overrides,
});

test('roundDiv rounds half away from zero using exact integers', () => {
  assert.equal(roundDiv(1, 2), 1);
  assert.equal(roundDiv(3, 2), 2);
  assert.equal(roundDiv(5, 2), 3);
  assert.equal(roundDiv(0, 3), 0);
  assert.equal(roundDiv(-3, 2), -2);
  assert.equal(roundDiv(-1, 2), -1);
  assert.throws(() => roundDiv(1, 0), { code: 'ARITHMETIC_OVERFLOW' });
  assert.throws(() => roundDiv(Number.MAX_SAFE_INTEGER, 2), { code: 'ARITHMETIC_OVERFLOW' });
});

test('percentOf and lineAmount never lose a paisa', () => {
  assert.equal(percentOf(100000, 1800), 18000);
  assert.equal(percentOf(33333, 1800), 6000); // 5999.94 rounds up
  assert.equal(percentOf(100000, 0), 0);
  assert.equal(lineAmount(10000, 2500), 25000); // 2.5 x 100.00
  assert.equal(lineAmount(99999, 3333), 333297); // 333296.667 rounds up
});

test('proportional allocation always sums back to the original amount', () => {
  assert.deepEqual(allocateProportionally(15000, [100000, 50000]), [10000, 5000]);
  assert.deepEqual(allocateProportionally(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocateProportionally(7, [1, 1]).reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(allocateProportionally(0, [5, 5]), [0, 0]);
  assert.throws(() => allocateProportionally(500, [0, 0]), { code: 'ALLOCATION_NOT_POSSIBLE' });
  // A large uneven split must still balance exactly.
  const weights = [333333, 111111, 7, 999999];
  assert.equal(allocateProportionally(999999, weights).reduce((a, b) => a + b, 0), 999999);
});

test('tax split keeps CGST + SGST exactly equal to the computed tax', () => {
  assert.deepEqual(splitTax(1799, 'INTRA'), { cgst_minor: 899, sgst_minor: 900, igst_minor: 0 });
  assert.deepEqual(splitTax(1800, 'INTRA'), { cgst_minor: 900, sgst_minor: 900, igst_minor: 0 });
  assert.deepEqual(splitTax(1799, 'INTER'), { cgst_minor: 0, sgst_minor: 0, igst_minor: 1799 });
  for (const tax of [1, 2, 3, 99999]) {
    const split = splitTax(tax, 'INTRA');
    assert.equal(split.cgst_minor + split.sgst_minor, tax);
  }
});

test('a line applies an item discount before tax', () => {
  const withPercent = computeLine(item({ unit_price_minor: 100000, discount_bp: 1000 }));
  assert.equal(withPercent.gross_minor, 100000);
  assert.equal(withPercent.item_discount_minor, 10000);
  assert.equal(withPercent.taxable_minor, 90000);

  const withFixed = computeLine(item({ discount_minor: 25000 }));
  assert.equal(withFixed.item_discount_minor, 25000);
  assert.equal(withFixed.taxable_minor, 75000);

  // A fixed discount larger than the line is clamped, never negative.
  assert.equal(computeLine(item({ discount_minor: 999999 })).taxable_minor, 0);
});

test('non-taxable treatments carry no tax but stay in the taxable-value report', () => {
  const exemptLine = computeLine(item({ tax_treatment: 'EXEMPT', tax_rate_bp: 0 }));
  assert.equal(exemptLine.tax_minor, 0);
  assert.equal(exemptLine.exempt, true);
  const document = computeDocument({ items: [item({ tax_treatment: 'EXEMPT', tax_rate_bp: 0 })], supply_type: 'INTRA' });
  assert.equal(document.totals.tax_total_minor, 0);
  assert.equal(document.totals.exempt_total_minor, 100000);
  assert.equal(document.totals.grand_total_minor, 100000);
});

test('intra-state supply produces CGST and SGST, inter-state produces only IGST', () => {
  const intra = computeDocument({ items: [item()], supply_type: 'INTRA' });
  assert.deepEqual(
    [intra.totals.cgst_total_minor, intra.totals.sgst_total_minor, intra.totals.igst_total_minor],
    [9000, 9000, 0],
  );
  const inter = computeDocument({ items: [item()], supply_type: 'INTER' });
  assert.deepEqual(
    [inter.totals.cgst_total_minor, inter.totals.sgst_total_minor, inter.totals.igst_total_minor],
    [0, 0, 18000],
  );
  assert.equal(intra.totals.grand_total_minor, inter.totals.grand_total_minor);
});

test('grades work across multiple lines, rates and an invoice-level discount', () => {
  const document = computeDocument({
    items: [item({ unit_price_minor: 100000 }), item({ unit_price_minor: 50000, tax_rate_bp: 1200 })],
    invoice_discount_bp: 1000,
    supply_type: 'INTRA',
  });
  // 1500.00 net, 10% invoice discount allocated 100.00 / 50.00 pro-rata.
  assert.deepEqual(document.lines.map(l => l.invoice_discount_minor), [10000, 5000]);
  assert.deepEqual(document.lines.map(l => l.taxable_minor), [90000, 45000]);
  assert.deepEqual(document.lines.map(l => l.tax_minor), [16200, 5400]);
  assert.equal(document.totals.invoice_discount_total_minor, 15000);
  assert.equal(document.totals.taxable_total_minor, 135000);
  assert.equal(document.totals.tax_total_minor, 21600);
  assert.equal(document.totals.grand_total_minor, 156600);
  assert.equal(document.totals.cgst_total_minor + document.totals.sgst_total_minor, 21600);
});

test('invoice discount allocation balances even when it does not divide evenly', () => {
  const document = computeDocument({
    items: [item({ unit_price_minor: 33333 }), item({ unit_price_minor: 33333 }), item({ unit_price_minor: 33333 })],
    invoice_discount_bp: 1000,
    supply_type: 'INTRA',
  });
  const allocated = document.lines.reduce((total, line) => total + line.invoice_discount_minor, 0);
  assert.equal(allocated, document.totals.invoice_discount_total_minor);
  assert.equal(document.totals.grand_total_minor,
    document.totals.taxable_total_minor + document.totals.tax_total_minor + document.totals.round_off_minor);
});

test('round-off is explicit, repeatable and switched off by request', () => {
  const rounded = computeDocument({ items: [item({ unit_price_minor: 100001 })], supply_type: 'INTRA' });
  assert.equal(rounded.totals.tax_total_minor, 18000);
  assert.equal(rounded.totals.total_before_round_minor, 118001);
  assert.equal(rounded.totals.round_off_minor, -1);
  assert.equal(rounded.totals.grand_total_minor, 118000);

  const exact = computeDocument({ items: [item({ unit_price_minor: 100001 })], round_off_enabled: false });
  assert.equal(exact.totals.round_off_minor, 0);
  assert.equal(exact.totals.grand_total_minor, 118001);
});

test('additional charges are taxed on their own classification', () => {
  const document = computeDocument({
    items: [item()],
    additional_charges: [
      { label: 'Delivery', amount_minor: 50000, tax_rate_bp: 1800, tax_treatment: 'TAXABLE' },
      { label: 'Reimbursement', amount_minor: 20000, tax_rate_bp: 0, tax_treatment: 'NON_GST' },
    ],
    supply_type: 'INTRA',
  });
  assert.equal(document.totals.charges_total_minor, 50000 + 9000 + 20000);
  assert.equal(document.totals.taxable_total_minor, 100000 + 50000);
  assert.equal(document.totals.tax_total_minor, 18000 + 9000);
  assert.equal(document.totals.grand_total_minor, 100000 + 18000 + 50000 + 9000 + 20000);
});

test('over-sized discounts are rejected instead of producing negative totals', () => {
  assert.throws(() => computeDocument({ items: [item()], invoice_discount_minor: 999999 }), { code: 'DISCOUNT_EXCEEDS_VALUE' });
  // Values that cannot be represented exactly must fail loudly, never silently round.
  assert.throws(() => computeLine(item({ unit_price_minor: 1e13, quantity_milli: 1e6 })), { code: 'ARITHMETIC_OVERFLOW' });
  assert.throws(() => percentOf(1e13, 10000), { code: 'ARITHMETIC_OVERFLOW' });
});

test('payment state is derived from money received and the due date', () => {
  assert.deepEqual(applyPayments(118000, [{ amount_minor: 18000 }]), { amount_paid_minor: 18000, balance_due_minor: 100000 });
  assert.equal(paymentState(118000, 0, '2026-10-01', '2026-10-12'), 'OVERDUE');
  assert.equal(paymentState(118000, 0, '2026-11-01', '2026-10-12'), 'UNPAID');
  assert.equal(paymentState(118000, 18000, '2026-10-01', '2026-10-12'), 'PARTIALLY_PAID');
  assert.equal(paymentState(118000, 118000, '2026-10-01', '2026-10-12'), 'PAID');
  assert.equal(paymentState(118000, 120000, '2026-10-01', '2026-10-12'), 'OVERPAID');
});
