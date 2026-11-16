import type Database from 'better-sqlite3';

export function migratePaymentStatus(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(payments)').all() as { name: string }[];
  if (columns.some((column) => column.name === 'confirmed_at')) return;
  // All payments recorded before this migration were confirmed receipts.
  db.transaction(() => {
    db.exec('ALTER TABLE payments ADD COLUMN confirmed_at TEXT');
    db.exec('UPDATE payments SET confirmed_at=date');
  })();
}
