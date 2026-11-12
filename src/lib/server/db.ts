import Database from 'better-sqlite3';
import * as env from '$app/env/private';
import { chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkWritableDirectory } from './storage';
import { migrateReceiptNames } from './receipt-names';
import type { Expense, Member, Tag, Payment } from '#lib/types.ts';

const path = resolve(env.DATABASE_PATH || './data/housik.sqlite');
checkWritableDirectory(dirname(path));
export const db = new Database(path);
chmodSync(path, 0o600);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trips (
 id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, owner_id TEXT NOT NULL REFERENCES users(id),
 house TEXT NOT NULL DEFAULT '', start TEXT NOT NULL, nights INTEGER NOT NULL, currency TEXT NOT NULL,
 created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS members (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 name TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE,
 color INTEGER NOT NULL DEFAULT 0, UNIQUE(trip_id, username)
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tags (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 name TEXT NOT NULL, UNIQUE(trip_id, name)
);
CREATE TABLE IF NOT EXISTS tag_members (
 tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, PRIMARY KEY(tag_id, member_id)
);
CREATE TABLE IF NOT EXISTS receipts (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 uploader_id TEXT NOT NULL REFERENCES members(id), filename TEXT NOT NULL,
 mime TEXT NOT NULL, merchant TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS expenses (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 title TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0),
 payer_id TEXT NOT NULL REFERENCES members(id), kind TEXT NOT NULL,
 tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL, receipt_id TEXT REFERENCES receipts(id),
 note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_tags (
 expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
 tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
 PRIMARY KEY(expense_id,tag_id)
);
CREATE TABLE IF NOT EXISTS expense_members (
 expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 PRIMARY KEY(expense_id, member_id)
);
CREATE TABLE IF NOT EXISTS choices (
 expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 mode TEXT NOT NULL, extra INTEGER NOT NULL DEFAULT 0 CHECK(extra >= 0), PRIMARY KEY(expense_id, member_id)
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 from_id TEXT NOT NULL REFERENCES members(id), to_id TEXT NOT NULL REFERENCES members(id),
 amount INTEGER NOT NULL CHECK(amount > 0), date TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset INTEGER NOT NULL);
`);
if (
  !(db.prepare('PRAGMA table_info(trips)').all() as { name: string }[]).some(
    (column) => column.name === 'location_url'
  )
) {
  db.exec("ALTER TABLE trips ADD COLUMN location_url TEXT NOT NULL DEFAULT ''");
}
// Normalize currencies from older databases.
if ((db.pragma('user_version', { simple: true }) as number) < 2) {
  db.transaction(() => {
    db.prepare("UPDATE trips SET currency='CZK'").run();
    db.pragma('user_version = 2');
  })();
}
// Older entries only have their CZK ledger amount; keep it as the editing fallback.
db.transaction(() => {
  for (const [table, columns] of Object.entries({
    expenses: {
      input_amount: 'INTEGER',
      input_currency: "TEXT NOT NULL DEFAULT 'CZK'",
      input_nightly: 'INTEGER NOT NULL DEFAULT 0',
      share_explicit: 'INTEGER NOT NULL DEFAULT 0'
    },
    choices: { input_extra: 'INTEGER', input_currency: "TEXT NOT NULL DEFAULT 'CZK'" }
  })) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.some((column) => column.name === name))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
})();
migrateReceiptNames(db);
export const id = () => randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);
export type Trip = {
  id: string;
  name: string;
  house: string;
  start: string;
  nights: number;
  currency: string;
  location_url: string;
};
export function tripData(tripId: string) {
  const trip = db
    .prepare('SELECT id,name,house,start,nights,currency,location_url FROM trips WHERE id=?')
    .get(tripId) as Trip;
  const members = db
    .prepare('SELECT id,trip_id,name,username,color FROM members WHERE trip_id=? ORDER BY rowid')
    .all(tripId) as Member[];
  const tags = (
    db.prepare('SELECT * FROM tags WHERE trip_id=? ORDER BY rowid').all(tripId) as Omit<
      Tag,
      'members'
    >[]
  ).map((t) => ({
    ...t,
    members: (
      db.prepare('SELECT member_id FROM tag_members WHERE tag_id=?').all(t.id) as {
        member_id: string;
      }[]
    ).map((x) => x.member_id)
  }));
  const expenses = (
    db
      .prepare('SELECT * FROM expenses WHERE trip_id=? ORDER BY date DESC, rowid DESC')
      .all(tripId) as Expense[]
  ).map((e) => ({
    ...e,
    tag_ids: (() => {
      const rows = db
        .prepare('SELECT tag_id FROM expense_tags WHERE expense_id=? ORDER BY rowid')
        .all(e.id) as { tag_id: string }[];
      return rows.length
        ? rows.map((row) => row.tag_id)
        : !e.share_explicit && e.tag_id
          ? [e.tag_id]
          : [];
    })(),
    member_ids: (() => {
      const rows = db
        .prepare('SELECT member_id FROM expense_members WHERE expense_id=? ORDER BY rowid')
        .all(e.id) as { member_id: string }[];
      return rows.length ? rows.map((row) => row.member_id) : undefined;
    })(),
    choices: db
      .prepare(
        'SELECT member_id,mode,extra,input_extra,input_currency FROM choices WHERE expense_id=?'
      )
      .all(e.id) as Expense['choices']
  }));
  const payments = db
    .prepare('SELECT * FROM payments WHERE trip_id=? ORDER BY date DESC,rowid DESC')
    .all(tripId) as Payment[];
  const receipts = db
    .prepare('SELECT * FROM receipts WHERE trip_id=? ORDER BY rowid DESC')
    .all(tripId) as {
    id: string;
    uploader_id: string;
    filename: string;
    mime: string;
    merchant: string;
    created: string;
  }[];
  return { trip, members, tags, expenses, payments, receipts };
}
