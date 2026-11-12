import { error, fail, isHttpError, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db, id, tripData } from '#lib/server/db.ts';
import { tripNights } from '#lib/dates.ts';
import {
  getSession,
  joinTrip,
  signIn,
  requireSession,
  logout,
  text,
  validDate,
  locationUrl
} from '#lib/server/auth.ts';
import { allocate, balances, settle } from '#lib/money.ts';
import * as env from '$app/env/private';
import { commitReceipt, commitReceipts, deleteReceipt } from '#lib/server/receipts.ts';
import { amountInput, convertInput, exchangeRates } from '#lib/server/exchange-rates.ts';

export const load: PageServerLoad = async (event) => {
  const trip = db.prepare('SELECT id,name,owner_id FROM trips WHERE id=?').get(event.params.id) as
    { id: string; name: string; owner_id: string } | undefined;
  if (!trip) error(404, 'Trip not found.');
  const user = getSession(event);
  const member =
    user &&
    db
      .prepare('SELECT 1 FROM members WHERE trip_id=? AND username=? COLLATE NOCASE')
      .get(trip.id, user.username);
  if (!user || (trip.owner_id !== user.id && !member)) {
    const invite = { id: trip.id, name: trip.name };
    if (user) return { access: 'join' as const, invite, user };
    const names = db
      .prepare('SELECT name,color FROM members WHERE trip_id=? ORDER BY rowid')
      .all(trip.id) as { name: string; color: number }[];
    return { access: 'signin' as const, invite, names };
  }
  const session = requireSession(event);
  const data = tripData(session.trip_id);
  const ledger = balances(data.members, data.expenses, data.tags, data.payments);
  return {
    access: 'member' as const,
    ...data,
    session,
    ledger,
    settlement: settle(ledger),
    scanning: !!env.OPENAI_API_KEY,
    exchangeRate: await exchangeRates.refresh()
  };
};
function wrap(
  fn: (event: Parameters<Actions[string]>[0], f: FormData) => unknown | Promise<unknown>
): Actions[string] {
  return async (event) => {
    try {
      return (await fn(event, await event.request.formData())) || { success: true };
    } catch (e) {
      if (isHttpError(e) || (e && typeof e === 'object' && 'status' in e && 'location' in e))
        throw e;
      return fail(400, { error: e instanceof Error ? e.message : 'Could not save. Try again.' });
    }
  };
}
function memberExists(tripId: string, memberId: string) {
  if (!db.prepare('SELECT 1 FROM members WHERE trip_id=? AND id=?').get(tripId, memberId))
    throw new Error('Choose someone on this trip.');
}
function assertAllocations(tripId: string) {
  const d = tripData(tripId);
  for (const e of d.expenses) allocate(e, d.members, d.tags);
}
export const actions: Actions = {
  join: wrap((event) => {
    const user = getSession(event);
    if (!user) redirect(303, `/trip/${event.params.id}`);
    joinTrip(event.params.id, user);
    redirect(303, `/trip/${event.params.id}`);
  }),
  login: wrap((event, form) => {
    if (!db.prepare('SELECT 1 FROM trips WHERE id=?').get(event.params.id))
      error(404, 'Trip not found.');
    joinTrip(event.params.id, signIn(event, form));
    redirect(303, `/trip/${event.params.id}`);
  }),
  logout: (event) => {
    logout(event);
    redirect(303, '/');
  },
  member: wrap((event, f) => {
    const s = requireSession(event),
      name = text(f, 'name', 20),
      username = name.toLowerCase();
    if (
      db
        .prepare('SELECT 1 FROM members WHERE trip_id=? AND username=? COLLATE NOCASE')
        .get(s.trip_id, username)
    )
      throw new Error('Name is already invited.');
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM members WHERE trip_id=?').get(s.trip_id) as {
        n: number;
      }
    ).n;
    db.prepare('INSERT INTO members VALUES(?,?,?,?,?)').run(
      id(),
      s.trip_id,
      name,
      username,
      count % 6
    );
  }),
  expense: wrap(async (event, f) => {
    const s = requireSession(event),
      expenseId = String(f.get('id') || '') || id();
    const title = text(f, 'title'),
      payer = text(f, 'payer'),
      kind = text(f, 'kind'),
      date = validDate(text(f, 'date'));
    const nightly = kind === 'rent' && f.get('nightly') === 'true';
    const nights = nightly ? tripData(s.trip_id).trip.nights : 1;
    const { amount, input_amount, input_currency } = await amountInput(
      f.get('amount'),
      f.get('currency') ?? 'CZK',
      nights
    );
    if (!amount) throw new Error('Amount must be greater than zero.');
    if (!['rent', 'product', 'other'].includes(kind)) throw new Error('Choose an expense type.');
    memberExists(s.trip_id, payer);
    const selected = [...new Set(f.getAll('tag_ids').map(String))];
    for (const tagId of selected) {
      if (!db.prepare('SELECT 1 FROM tags WHERE id=? AND trip_id=?').get(tagId, s.trip_id))
        throw new Error('Choose tags from this trip.');
    }
    const explicit = f.get('share_explicit') === 'true';
    let memberIds: string[] | undefined;
    if (f.has('member_ids')) {
      const raw = JSON.parse(String(f.get('member_ids')));
      if (
        !Array.isArray(raw) ||
        (!raw.length && !explicit) ||
        raw.some((member) => typeof member !== 'string')
      )
        throw new Error('Choose who shares this expense.');
      memberIds = [...new Set(raw as string[])];
      for (const member of memberIds) memberExists(s.trip_id, member);
    }
    const existing = db
      .prepare('SELECT 1 FROM expenses WHERE id=? AND trip_id=?')
      .get(expenseId, s.trip_id);
    const tag = selected[0] || null;
    if (f.get('id') && !existing) throw new Error('Expense not found.');
    db.transaction(() => {
      if (existing)
        db.prepare(
          'UPDATE expenses SET title=?,amount=?,payer_id=?,kind=?,tag_id=?,note=?,date=?,input_amount=?,input_currency=?,input_nightly=? WHERE id=? AND trip_id=?'
        ).run(
          title,
          amount,
          payer,
          kind,
          tag,
          String(f.get('note') || '').slice(0, 300),
          date,
          input_amount,
          input_currency,
          Number(nightly),
          expenseId,
          s.trip_id
        );
      else
        db.prepare(
          'INSERT INTO expenses(id,trip_id,title,amount,payer_id,kind,tag_id,receipt_id,note,date,input_amount,input_currency,input_nightly) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(
          expenseId,
          s.trip_id,
          title,
          amount,
          payer,
          kind,
          tag,
          null,
          String(f.get('note') || '').slice(0, 300),
          date,
          input_amount,
          input_currency,
          Number(nightly)
        );
      db.prepare('DELETE FROM expense_tags WHERE expense_id=?').run(expenseId);
      for (const member of selected)
        db.prepare('INSERT INTO expense_tags VALUES(?,?)').run(expenseId, member);
      db.prepare('UPDATE expenses SET share_explicit=? WHERE id=?').run(
        Number(explicit),
        expenseId
      );
      if (memberIds) {
        db.prepare('DELETE FROM expense_members WHERE expense_id=?').run(expenseId);
        for (const member of memberIds)
          db.prepare('INSERT INTO expense_members VALUES(?,?)').run(expenseId, member);
      }
      assertAllocations(s.trip_id);
    })();
  }),
  deleteExpense: wrap((event, f) => {
    const s = requireSession(event);
    db.prepare('DELETE FROM expenses WHERE id=? AND trip_id=?').run(text(f, 'id'), s.trip_id);
  }),
  deleteReceipt: wrap(async (event, f) => {
    const s = requireSession(event);
    await deleteReceipt(s.trip_id, text(f, 'id'));
  }),
  choice: wrap(async (event, f) => {
    const s = requireSession(event),
      expenseId = text(f, 'expense'),
      member = s.member_id!;
    memberExists(s.trip_id, member);
    const mode = text(f, 'mode');
    if (!['default', 'share', 'exclude', 'full', 'extra'].includes(mode))
      throw new Error('Choose how to split.');
    if (!db.prepare('SELECT 1 FROM expenses WHERE id=? AND trip_id=?').get(expenseId, s.trip_id))
      throw new Error('Expense not found.');
    const input =
      mode === 'extra'
        ? await amountInput(f.get('extra'), f.get('currency') ?? 'CZK')
        : { amount: 0, input_amount: 0, input_currency: 'CZK' };
    const extra = input.amount;
    if (mode === 'extra' && extra <= 0) throw new Error('Enter a positive extra contribution.');
    db.transaction(() => {
      db.prepare('DELETE FROM choices WHERE expense_id=? AND member_id=?').run(expenseId, member);
      if (mode !== 'default')
        db.prepare(
          'INSERT INTO choices(expense_id,member_id,mode,extra,input_extra,input_currency) VALUES(?,?,?,?,?,?)'
        ).run(expenseId, member, mode, extra, input.input_amount, input.input_currency);
      assertAllocations(s.trip_id);
    })();
  }),
  tag: wrap((event, f) => {
    const s = requireSession(event),
      name = text(f, 'name', 40),
      tagId = String(f.get('id') || '') || id();
    const people = [...new Set(f.getAll('members').map(String))];
    if (!people.length) throw new Error('Select at least one person.');
    people.forEach((m) => memberExists(s.trip_id, m));
    if (
      f.get('id') &&
      !db.prepare('SELECT 1 FROM tags WHERE id=? AND trip_id=?').get(tagId, s.trip_id)
    )
      throw new Error('Tag not found.');
    const duplicate = db
      .prepare('SELECT id FROM tags WHERE name=? AND trip_id=? AND id!=?')
      .get(name, s.trip_id, tagId);
    if (duplicate) throw new Error('Tag name is already used.');
    db.transaction(() => {
      db.prepare(
        'INSERT INTO tags VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name'
      ).run(tagId, s.trip_id, name);
      db.prepare('DELETE FROM tag_members WHERE tag_id=?').run(tagId);
      for (const m of people) db.prepare('INSERT INTO tag_members VALUES(?,?)').run(tagId, m);
      assertAllocations(s.trip_id);
    })();
  }),
  deleteTag: wrap((event, f) => {
    const s = requireSession(event);
    db.transaction(() => {
      db.prepare('DELETE FROM tags WHERE id=? AND trip_id=?').run(text(f, 'id'), s.trip_id);
      assertAllocations(s.trip_id);
    })();
  }),
  payment: wrap(async (event, f) => {
    const s = requireSession(event),
      from = text(f, 'from'),
      to = text(f, 'to');
    if (!s.member_id || to !== s.member_id) error(403, 'Only the receiver can confirm a payment.');
    memberExists(s.trip_id, from);
    memberExists(s.trip_id, to);
    const amount = await convertInput(f.get('amount'), f.get('currency') ?? 'CZK');
    if (from === to || amount <= 0) throw new Error('Choose a sender and a positive amount.');
    db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?)').run(
      id(),
      s.trip_id,
      from,
      to,
      amount,
      validDate(text(f, 'date')),
      String(f.get('note') || '').slice(0, 200)
    );
  }),
  undoPayment: wrap((event, f) => {
    const s = requireSession(event);
    const paymentId = text(f, 'id');
    const payment = db
      .prepare('SELECT to_id FROM payments WHERE id=? AND trip_id=?')
      .get(paymentId, s.trip_id) as { to_id: string } | undefined;
    if (!payment) error(404, 'Payment not found.');
    if (!s.member_id || payment.to_id !== s.member_id)
      error(403, 'Only the receiver can undo a payment.');
    db.prepare('DELETE FROM payments WHERE id=? AND trip_id=?').run(paymentId, s.trip_id);
  }),
  settings: wrap((event, f) => {
    const s = requireSession(event),
      name = text(f, 'name', 60),
      start = validDate(text(f, 'start')),
      nights = tripNights(start, text(f, 'departure'));
    if (
      db.prepare('SELECT 1 FROM trips WHERE name=? COLLATE NOCASE AND id!=?').get(name, s.trip_id)
    )
      throw new Error('That trip name is taken.');
    const location = locationUrl(f);
    db.prepare('UPDATE trips SET name=?,house=?,start=?,nights=?,location_url=? WHERE id=?').run(
      name,
      String(f.get('house') || '').slice(0, 100),
      start,
      nights,
      location,
      s.trip_id
    );
  }),
  importReceipts: wrap(async (event, f) => {
    const session = requireSession(event);
    await commitReceipts(session.trip_id, JSON.parse(String(f.get('receipts') || '[]')));
  }),
  importReceipt: wrap(async (event, f) => {
    const s = requireSession(event);
    await commitReceipt(s.trip_id, f);
  })
};
