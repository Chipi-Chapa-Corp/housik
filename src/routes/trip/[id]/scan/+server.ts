import { json, isHttpError } from '@sveltejs/kit';
import { requireSession, rateLimit } from '#lib/server/auth.ts';
import { stageReceipt } from '#lib/server/receipts.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
  const s = requireSession(event, true);
  if (event.request.headers.get('origin') !== event.url.origin)
    return json({ error: 'Invalid origin.' }, { status: 403 });
  rateLimit(`receipt:${s.trip_id}`);
  const size = Number(event.request.headers.get('content-length') || 0);
  if (size > 11 * 1024 * 1024) return json({ error: 'File limit is 10 MB.' }, { status: 413 });
  try {
    const form = await event.request.formData(),
      file = form.get('file');
    if (!(file instanceof File)) throw new Error('Choose a receipt.');
    return json(
      await stageReceipt(s.trip_id, String(form.get('payer')), file, form.get('manual') === 'true')
    );
  } catch (e) {
    if (isHttpError(e)) throw e;
    return json(
      { error: e instanceof Error ? e.message : 'Could not read receipt.' },
      { status: 400 }
    );
  }
};
