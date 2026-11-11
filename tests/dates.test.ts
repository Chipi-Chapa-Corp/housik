import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departureDate, tripNights } from '../src/lib/dates';

test('nights count calendar days across years, leap days and clock changes', () => {
  for (const [arrival, departure, nights] of [
    ['2026-12-29', '2027-01-01', 3],
    ['2028-02-28', '2028-03-01', 2],
    ['2026-03-28', '2026-03-30', 2],
    ['2026-10-24', '2026-10-26', 2],
    ['2026-01-01', '2027-01-01', 365]
  ] as const) {
    assert.equal(tripNights(arrival, departure), nights);
    assert.equal(departureDate(arrival, nights), departure);
  }
});

test('departure must follow arrival and stay within the trip duration limit', () => {
  assert.throws(() => tripNights('2026-11-20', '2026-11-20'), /after arrival/);
  assert.throws(() => tripNights('2026-11-20', '2026-11-19'), /after arrival/);
  assert.throws(() => tripNights('2026-01-01', '2027-01-02'), /365 nights/);
});

test('invalid arrival and departure dates are rejected', () => {
  for (const invalid of ['', '2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01']) {
    assert.throws(() => tripNights(invalid, '2026-11-23'), /valid date/);
    assert.throws(() => tripNights('2026-11-20', invalid), /valid date/);
  }
});
