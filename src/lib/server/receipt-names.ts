import type Database from 'better-sqlite3';

export function nextReceiptName(db: Database.Database, tripId: string, uploaderId: string) {
  const { username } = db.prepare('SELECT username FROM members WHERE id=?').get(uploaderId) as {
    username: string;
  };
  const { maximum } = db
    .prepare(
      `
    SELECT COALESCE(MAX(r.sequence),0) AS maximum FROM receipts r
    JOIN members m ON m.id=r.uploader_id WHERE m.username=? COLLATE NOCASE
  `
    )
    .get(username) as { maximum: number };
  let sequence = maximum + 1;
  while (
    db
      .prepare('SELECT 1 FROM tags WHERE trip_id=? AND name=?')
      .get(tripId, `${username} ${sequence}`)
  )
    sequence++;
  return { name: `${username} ${sequence}`, sequence };
}

export function migrateReceiptNames(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(receipts)').all() as { name: string }[];
  if (!columns.some(({ name }) => name === 'sequence'))
    db.exec('ALTER TABLE receipts ADD COLUMN sequence INTEGER');
  db.transaction(() => {
    const receipts = db
      .prepare(
        'SELECT id,trip_id,uploader_id,merchant FROM receipts WHERE sequence IS NULL ORDER BY rowid'
      )
      .all() as {
      id: string;
      trip_id: string;
      uploader_id: string;
      merchant: string;
    }[];
    for (const receipt of receipts) {
      const { name, sequence } = nextReceiptName(db, receipt.trip_id, receipt.uploader_id);
      // Rename only the generated receipt tag, preserving independently renamed tags.
      const tags = db
        .prepare(
          `SELECT id,name FROM tags WHERE trip_id=? AND (
        id IN (SELECT tag_id FROM expenses WHERE receipt_id=?) OR
        id IN (SELECT et.tag_id FROM expense_tags et JOIN expenses e ON e.id=et.expense_id WHERE e.receipt_id=?)
      )`
        )
        .all(receipt.trip_id, receipt.id, receipt.id) as { id: string; name: string }[];
      for (const tag of tags) {
        const prefix = `${receipt.merchant} · `;
        if (
          tag.name === receipt.merchant ||
          (tag.name.startsWith(prefix) && /^\d+$/.test(tag.name.slice(prefix.length)))
        ) {
          db.prepare('UPDATE tags SET name=? WHERE id=?').run(name, tag.id);
          break;
        }
      }
      db.prepare('UPDATE receipts SET merchant=?,sequence=? WHERE id=?').run(
        name,
        sequence,
        receipt.id
      );
    }
  })();
}
