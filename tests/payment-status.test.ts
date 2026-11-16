import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migratePaymentStatus } from '../src/lib/server/payment-status';

test('legacy payments remain paid and running the migration again preserves pending payments', () => {
  const db = new Database(':memory:');
  try {
    db.exec(
      "CREATE TABLE payments (id TEXT PRIMARY KEY, date TEXT); INSERT INTO payments VALUES ('old', '2026-11-16')"
    );
    migratePaymentStatus(db);
    assert.deepEqual(db.prepare('SELECT confirmed_at FROM payments WHERE id=?').get('old'), {
      confirmed_at: '2026-11-16'
    });
    db.prepare('INSERT INTO payments(id,date,confirmed_at) VALUES (?,?,NULL)').run(
      'new',
      '2026-11-16'
    );
    migratePaymentStatus(db);
    assert.deepEqual(db.prepare('SELECT confirmed_at FROM payments WHERE id=?').get('new'), {
      confirmed_at: null
    });
  } finally {
    db.close();
  }
});
