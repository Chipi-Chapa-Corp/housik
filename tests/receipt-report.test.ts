import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReceipt, renderReceiptText, renderReceiptHtml } from './llm/receipt-report';

test('name differences are informational and rendered with expected/actual colors', () => {
  const expected = { products: [{ name: 'Milk <whole>', amount: 125, currency: 'CZK' }] };
  const actual = { products: [{ name: 'Mléko <whole>', amount: 125, currency: 'CZK' }] };
  const report = compareReceipt(1, expected, actual);
  assert.equal(report.numbersMatch, true);
  assert.match(renderReceiptText(report), /NUMBERS MATCH/);
  const colored = renderReceiptText(report, true);
  assert.match(colored, /\x1b\[31m/);
  assert.match(colored, /\x1b\[32m/);
  const html = renderReceiptHtml(report);
  assert.match(html, /class="removed"/);
  assert.match(html, /class="added"/);
  assert.match(html, /&lt;whole&gt;/);
  assert.doesNotMatch(html, /<whole>/);
});

test('numeric differences remain visible even when totals match', () => {
  const expected = {
    products: [
      { name: 'First', amount: 100, currency: 'CZK' },
      { name: 'Second', amount: 200, currency: 'CZK' }
    ]
  };
  const actual = {
    products: [
      { name: 'One', amount: 150, currency: 'CZK' },
      { name: 'Two', amount: 150, currency: 'CZK' }
    ]
  };
  const report = compareReceipt(2, expected, actual);
  assert.equal(report.numbersMatch, false);
  assert.equal(report.expectedTotal, report.actualTotal);
  assert.equal(report.rows.filter((row) => !row.numbersMatch).length, 2);
  assert.match(renderReceiptText(report), /NUMBERS DIFFER/);
  assert.match(renderReceiptText(report), /1\.50 CZK/);
});

test('missing lines and incorrect currencies affect numeric status', () => {
  const expected = { products: [{ name: 'One', amount: 100, currency: 'CZK' }] };
  assert.equal(compareReceipt(1, expected, { products: [] }).numbersMatch, false);
  assert.equal(
    compareReceipt(1, expected, { products: [{ name: 'Different', amount: 100, currency: 'EUR' }] })
      .numbersMatch,
    false
  );
  assert.equal(
    compareReceipt(1, expected, { products: [{ name: 'Different', amount: 100, currency: null }] })
      .numbersMatch,
    true
  );
  assert.equal(compareReceipt(1, expected, null).numbersMatch, false);
});
