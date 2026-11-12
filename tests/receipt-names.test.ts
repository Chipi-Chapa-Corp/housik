import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateReceiptNames, nextReceiptName } from '../src/lib/server/receipt-names';

test('receipt names migrate by uploader, continue across trips and avoid tag collisions', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE members (id TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE receipts (id TEXT PRIMARY KEY, trip_id TEXT, uploader_id TEXT, merchant TEXT);
      CREATE TABLE tags (id TEXT PRIMARY KEY, trip_id TEXT, name TEXT, UNIQUE(trip_id,name));
      CREATE TABLE expenses (id TEXT PRIMARY KEY, receipt_id TEXT, tag_id TEXT);
      CREATE TABLE expense_tags (expense_id TEXT, tag_id TEXT);
      INSERT INTO members VALUES ('a','alex'), ('b','bob'), ('a2','alex');
      INSERT INTO receipts VALUES ('r1','trip','a','photo.jpg'), ('r2','trip','b','photo.jpg'), ('r3','other','a2','another.jpg'), ('r4','trip','a','photo.jpg');
      INSERT INTO tags VALUES ('t1','trip','photo.jpg'), ('t2','trip','Custom tag'), ('t3','other','another.jpg'), ('t4','trip','photo.jpg · 2');
      INSERT INTO expenses VALUES ('e1','r1','t1'), ('e2','r2','t2'), ('e3','r3',NULL), ('e4','r4','t4');
      INSERT INTO expense_tags VALUES ('e3','t3');
    `);
    migrateReceiptNames(db);
    assert.deepEqual(db.prepare('SELECT merchant,sequence FROM receipts ORDER BY rowid').all(), [
      { merchant: 'alex 1', sequence: 1 },
      { merchant: 'bob 1', sequence: 1 },
      { merchant: 'alex 2', sequence: 2 },
      { merchant: 'alex 3', sequence: 3 }
    ]);
    assert.deepEqual(db.prepare('SELECT name FROM tags ORDER BY rowid').all(), [
      { name: 'alex 1' },
      { name: 'Custom tag' },
      { name: 'alex 2' },
      { name: 'alex 3' }
    ]);
    migrateReceiptNames(db);
    assert.equal(nextReceiptName(db, 'trip', 'a').name, 'alex 4');
    db.prepare('INSERT INTO tags VALUES (?,?,?)').run('collision', 'trip', 'alex 4');
    assert.deepEqual(nextReceiptName(db, 'trip', 'a'), { name: 'alex 5', sequence: 5 });
  } finally {
    db.close();
  }
});
