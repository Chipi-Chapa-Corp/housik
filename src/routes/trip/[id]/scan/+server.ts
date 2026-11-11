import { json, isHttpError } from '@sveltejs/kit';
import { requireSession, rateLimit } from '#lib/server/auth.ts';
import { ReceiptError } from '#lib/server/receipt-scanner.ts';
import { stageReceipt } from '#lib/server/receipts.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
  const s = requireSession(event);
  if (!s.member_id) return json({ error: 'Trip membership required.' }, { status: 403 });
  if (event.request.headers.get('origin') !== event.url.origin)
    return json({ error: 'Invalid origin.' }, { status: 403 });
  rateLimit(`receipt:${s.trip_id}:${s.member_id}`);
  const size = Number(event.request.headers.get('content-length') || 0);
  if (size > 11 * 1024 * 1024) return json({ error: 'File limit is 10 MB.' }, { status: 413 });
  try {
    const form = await event.request.formData(),
      file = form.get('file');
    if (!(file instanceof File)) throw new ReceiptError('Choose a receipt.');
    return json(
      await stageReceipt(
        s.trip_id,
        s.member_id,
        file,
        form.get('manual') === 'true',
        event.request.signal
      )
    );
  } catch (e) {
    if (isHttpError(e)) throw e;
    if (!(e instanceof ReceiptError)) console.error('Receipt upload failed:', e);
    return json(
      { error: e instanceof ReceiptError ? e.message : 'Receipt upload unavailable. Try again.' },
      { status: e instanceof ReceiptError ? 400 : 500 }
    );
  }
};
