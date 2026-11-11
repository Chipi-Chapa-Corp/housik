import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/db.ts';
import { requireSession } from '#lib/server/auth.ts';
import { receiptFile, discardReceipt } from '#lib/server/receipts.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => {
  const s = requireSession(event);
  const r = db
    .prepare(
      'SELECT mime FROM receipts WHERE id=? AND trip_id=? UNION ALL SELECT mime FROM receipt_drafts WHERE id=? AND trip_id=?'
    )
    .get(event.params.receipt, s.trip_id, event.params.receipt, s.trip_id) as
    { mime: string } | undefined;
  if (!r) error(404, 'Receipt not found.');
  try {
    return new Response(new Uint8Array(await receiptFile(s.trip_id, event.params.receipt)), {
      headers: {
        'Content-Type': r.mime,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin'
      }
    });
  } catch {
    error(404, 'Receipt file not found.');
  }
};

export const DELETE: RequestHandler = async (event) => {
  const session = requireSession(event, true);
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Invalid origin.');
  await discardReceipt(session.trip_id, event.params.receipt);
  return json({ success: true });
};
