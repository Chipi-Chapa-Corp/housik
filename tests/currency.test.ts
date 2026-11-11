import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { cents } from '../src/lib/money';
import { inputCurrency, rateScale, toCzk } from '../src/lib/currency';
import { createRateStore, refreshInterval } from '../src/lib/server/rate-store';

const response = (rate = 24.349) =>
  Response.json({ base: 'EUR', quote: 'CZK', date: '2026-11-11', rate });

test('EUR conversion rounds only once after nights; CZK never needs a rate', () => {
  assert.equal(toCzk(cents('7.99'), 'EUR', 24.349 * rateScale), 19455);
  assert.equal(toCzk(1, 'EUR', 24.349 * rateScale, 3), 73);
  assert.equal(toCzk(125, 'EUR', 25 * rateScale), 3125);
  assert.equal(toCzk(cents('240'), 'CZK', null, 3), 72000);
  assert.equal(toCzk(cents('8,50'), 'CZK', null), 850);
  assert.throws(() => toCzk(1, 'EUR', null), /Exchange rate unavailable/);
  assert.throws(() => toCzk(1_000_000_000, 'EUR', 25 * rateScale), /too large/);
  assert.throws(() => inputCurrency('USD'), /EUR or CZK/);
});

test('rate is fetched once for concurrent requests and persists across database reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'housik-rates-'));
  const filename = join(directory, 'rates.sqlite');
  let clock = Date.now(),
    requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return response();
  };
  let db = new Database(filename);
  try {
    let store = createRateStore(db, { fetch: fetcher, now: () => clock });
    await Promise.all(Array.from({ length: 10 }, () => store.refresh()));
    assert.equal(requests, 1);
    assert.deepEqual(store.latest(), {
      rate: 24_349_000,
      source_date: '2026-11-11',
      fetched_at: clock
    });
    db.close();
    db = new Database(filename);
    store = createRateStore(db, { fetch: fetcher, now: () => clock });
    await store.refresh();
    assert.equal(requests, 1);
    clock += refreshInterval - 1;
    await store.refresh();
    assert.equal(requests, 1);
    clock++;
    await store.refresh();
    assert.equal(requests, 2);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('provider failure and malformed rates retain the last successful rate and throttle retries', async () => {
  const db = new Database(':memory:');
  let clock = Date.now(),
    requests = 0;
  let result: () => Response = () => response();
  const store = createRateStore(db, {
    now: () => clock,
    fetch: async () => {
      requests++;
      return result();
    }
  });
  try {
    const saved = await store.refresh();
    for (const invalid of [
      () => new Response('', { status: 503 }),
      () => Response.json({ base: 'EUR', quote: 'CZK', date: '2026-11-11', rate: -1 }),
      () => Response.json({ base: 'USD', quote: 'CZK', date: '2026-11-11', rate: 25 }),
      () => Response.json({ base: 'EUR', quote: 'CZK', date: 'bad', rate: 25 })
    ]) {
      clock += refreshInterval;
      result = invalid;
      assert.deepEqual(await store.refresh(), saved);
      const previous = requests;
      assert.deepEqual(await store.refresh(), saved);
      assert.equal(requests, previous);
    }
  } finally {
    db.close();
  }
});

test('a cold provider outage has no invented exchange rate', async () => {
  const db = new Database(':memory:');
  try {
    const store = createRateStore(db, {
      fetch: async () => {
        throw new Error('Offline');
      }
    });
    assert.equal(await store.refresh(), null);
    assert.equal(store.latest(), null);
    assert.equal(toCzk(100, 'CZK', null), 100);
  } finally {
    db.close();
  }
});
