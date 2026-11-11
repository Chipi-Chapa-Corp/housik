import * as env from '$app/env/private';
import { db, id, today, tripData } from './db';
import { amountInput } from './exchange-rates';
import { validDate } from '../dates';
import { maxReceipts, maxReceiptBytes, type ReceiptProduct, type ReceiptReview } from '../receipts';
import { fileMime, ReceiptError, scanProducts } from './receipt-scanner';
import { receiptStorage } from './receipt-storage';

db.exec(`CREATE TABLE IF NOT EXISTS receipt_drafts (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 uploader_id TEXT NOT NULL REFERENCES members(id), filename TEXT NOT NULL, mime TEXT NOT NULL,
 merchant TEXT NOT NULL, currency TEXT NOT NULL, items TEXT NOT NULL,
 created INTEGER NOT NULL
)`);
const originals = receiptStorage(env.UPLOAD_DIR || './data/receipts');
export const checkReceiptStorage = () => originals.check();

export async function stageReceipt(
  tripId: string,
  payer: string,
  file: File,
  manual = false,
  signal?: AbortSignal
) {
  if (!file.size || file.size > maxReceiptBytes) throw new ReceiptError('File limit is 10 MB.');
  if (!db.prepare('SELECT 1 FROM members WHERE id=? AND trip_id=?').get(payer, tripId))
    throw new ReceiptError('Choose who paid.');
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = fileMime(buffer);
  const draftId = id();
  const merchant =
    file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim()
      .slice(0, 80) || 'Receipt';
  const expired = db
    .prepare('SELECT id,trip_id FROM receipt_drafts WHERE created<?')
    .all(Date.now() - 86_400_000) as { id: string; trip_id: string }[];
  for (const draft of expired) {
    db.prepare('DELETE FROM receipt_drafts WHERE id=?').run(draft.id);
    await originals.remove(draft.id);
  }
  await originals.put(draftId, buffer);
  try {
    db.prepare('INSERT INTO receipt_drafts VALUES(?,?,?,?,?,?,?,?,?)').run(
      draftId,
      tripId,
      payer,
      file.name.slice(0, 150),
      mime,
      merchant,
      'CZK',
      '[]',
      Date.now()
    );
  } catch (cause) {
    await originals.remove(draftId).catch(() => {});
    throw cause;
  }
  let items: ReceiptProduct[] = [];
  let error = '';
  if (manual || !env.OPENAI_API_KEY) error = 'Enter items manually.';
  else {
    try {
      items = await scanProducts(buffer, mime, {
        key: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL || 'gpt-4.1-mini',
        url: env.OPENAI_RESPONSES_URL,
        signal
      });
    } catch (cause) {
      error =
        cause instanceof ReceiptError
          ? cause.message
          : 'Could not scan this receipt. Enter items manually.';
    }
  }
  const currency = items[0]?.currency || 'CZK';
  db.prepare('UPDATE receipt_drafts SET items=?,currency=? WHERE id=? AND trip_id=?').run(
    JSON.stringify(items),
    currency,
    draftId,
    tripId
  );
  return {
    id: draftId,
    merchant,
    mime,
    currency,
    items,
    status: error ? 'failed' : 'succeeded',
    error
  };
}

export async function commitReceipts(tripId: string, raw: unknown) {
  if (!Array.isArray(raw) || !raw.length || raw.length > maxReceipts)
    throw new ReceiptError(`Choose 1–${maxReceipts} receipts.`);
  if (new Set(raw.map((entry) => entry?.draft)).size !== raw.length)
    throw new ReceiptError('A receipt can only be imported once.');
  const data = tripData(tripId);
  const prepared = await Promise.all(
    raw.map(async (entry: ReceiptReview) => {
      if (!entry || typeof entry.draft !== 'string')
        throw new ReceiptError('Upload the receipt again.');
      const draft = db
        .prepare('SELECT uploader_id,filename,mime FROM receipt_drafts WHERE id=? AND trip_id=?')
        .get(entry.draft, tripId) as
        { uploader_id: string; filename: string; mime: string } | undefined;
      if (!draft) throw new ReceiptError('Upload the receipt again.');
      const kind = entry.kind ?? 'product';
      if (!['product', 'other', 'rent'].includes(kind))
        throw new ReceiptError('Choose a receipt type.');
      const merchant = String(entry.merchant || '')
        .trim()
        .slice(0, 80);
      if (!merchant) throw new ReceiptError('Add a receipt name.');
      const payer = draft.uploader_id;
      if (!data.members.some((member) => member.id === payer))
        throw new ReceiptError('Choose who paid.');
      const memberIds = new Set(data.members.map((member) => member.id));
      function selectedMembers(value: unknown): string[] {
        if (
          !Array.isArray(value) ||
          !value.length ||
          value.some((member) => typeof member !== 'string' || !memberIds.has(member))
        )
          throw new ReceiptError('Choose at least one person from this trip.');
        return [...new Set(value)];
      }
      const members = selectedMembers(entry.members);
      const date = validDate(String(entry.date || today()));
      if (!Array.isArray(entry.items) || !entry.items.length || entry.items.length > 200)
        throw new ReceiptError('Add 1–200 items per receipt.');
      const items = await Promise.all(
        entry.items.map(async (item) => {
          const title = String(item?.title || '')
            .trim()
            .slice(0, 100);
          if (!title) throw new ReceiptError('Each item needs a name.');
          const input = await amountInput(item.amount, item.currency ?? 'CZK');
          if (input.amount <= 0) throw new ReceiptError('Each item needs a positive amount.');
          return {
            title,
            ...input,
            date: item.date === undefined ? date : validDate(String(item.date)),
            members: item.members === undefined ? undefined : selectedMembers(item.members)
          };
        })
      );
      return { ...draft, id: entry.draft, merchant, kind, payer, members, items, date };
    })
  );
  db.transaction(() => {
    for (const receipt of prepared) {
      // Recheck inside the transaction after async conversion to prevent duplicate concurrent imports.
      if (
        !db.prepare('SELECT 1 FROM receipt_drafts WHERE id=? AND trip_id=?').get(receipt.id, tripId)
      )
        throw new ReceiptError('Receipt already imported or removed.');
      let tagName = receipt.merchant,
        suffix = 1;
      while (db.prepare('SELECT 1 FROM tags WHERE trip_id=? AND name=?').get(tripId, tagName))
        tagName = `${receipt.merchant} · ${++suffix}`;
      const tagId = id();
      db.prepare('INSERT INTO tags VALUES(?,?,?)').run(tagId, tripId, tagName);
      for (const member of receipt.members)
        db.prepare('INSERT INTO tag_members VALUES(?,?)').run(tagId, member);
      db.prepare(
        'INSERT INTO receipts(id,trip_id,uploader_id,filename,mime,merchant) VALUES(?,?,?,?,?,?)'
      ).run(receipt.id, tripId, receipt.payer, receipt.filename, receipt.mime, receipt.merchant);
      for (const item of receipt.items) {
        const expenseId = id();
        db.prepare(
          'INSERT INTO expenses(id,trip_id,title,amount,payer_id,kind,tag_id,receipt_id,note,date,input_amount,input_currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(
          expenseId,
          tripId,
          item.title,
          item.amount,
          receipt.payer,
          receipt.kind,
          tagId,
          receipt.id,
          '',
          item.date,
          item.input_amount,
          item.input_currency
        );
        db.prepare('INSERT INTO expense_tags VALUES(?,?)').run(expenseId, tagId);
        for (const member of item.members ?? [])
          db.prepare('INSERT INTO expense_members VALUES(?,?)').run(expenseId, member);
      }
      db.prepare('DELETE FROM receipt_drafts WHERE id=? AND trip_id=?').run(receipt.id, tripId);
    }
  })();
}

export async function commitReceipt(tripId: string, form: FormData) {
  const items = JSON.parse(String(form.get('items') || '[]'));
  return commitReceipts(tripId, [
    {
      draft: String(form.get('draft')),
      merchant: form.get('merchant'),
      kind: form.get('kind') || 'product',
      date: form.get('date') || today(),
      members: form.getAll('members').map(String),
      items: Array.isArray(items)
        ? items.map((item) => ({
            ...item,
            currency: item.currency || form.get('currency') || 'CZK'
          }))
        : items
    }
  ]);
}

export async function receiptFile(tripId: string, receiptId: string) {
  // The route authorizes both trip membership and the receipt's trip before reading.
  return originals.read(receiptId);
}

export async function discardReceipt(tripId: string, receiptId: string) {
  const result = db
    .prepare('DELETE FROM receipt_drafts WHERE id=? AND trip_id=?')
    .run(receiptId, tripId);
  if (result.changes) await originals.remove(receiptId);
}
