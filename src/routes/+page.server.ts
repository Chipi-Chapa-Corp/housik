import { fail, isHttpError, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db, id } from '#lib/server/db.ts';
import { tripNights } from '#lib/dates.ts';
import {
  createSession,
  getSession,
  hash,
  locationUrl,
  password,
  rateLimit,
  text,
  validDate,
  verify,
  logout
} from '#lib/server/auth.ts';

export const load: PageServerLoad = (event) => {
  const user = getSession(event);
  const trips = user
    ? (db
        .prepare(
          `SELECT DISTINCT t.id,t.name,t.house,t.start,t.nights,t.currency,
    (SELECT COUNT(*) FROM members WHERE trip_id=t.id) AS people,
    (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE trip_id=t.id) AS total,
    CASE WHEN t.owner_id=? THEN 'owner' ELSE 'guest' END AS role
    FROM trips t LEFT JOIN members m ON m.trip_id=t.id WHERE t.owner_id=? OR m.username=? COLLATE NOCASE ORDER BY t.created DESC,t.rowid DESC`
        )
        .all(user.id, user.id, user.username) as {
        id: string;
        name: string;
        house: string;
        start: string;
        nights: number;
        currency: string;
        people: number;
        total: number;
        role: string;
      }[])
    : [];
  return { user: user || null, trips };
};
export const actions: Actions = {
  login: async (event) => {
    const f = await event.request.formData();
    try {
      rateLimit(`login:${event.getClientAddress()}`);
      const name = text(f, 'name', 20),
        username = name.toLowerCase(),
        pass = password(f);
      let user = db
        .prepare('SELECT id,password FROM users WHERE username=? COLLATE NOCASE')
        .get(username) as { id: string; password: string } | undefined;
      if (user && !verify(pass, user.password))
        throw new Error('Incorrect password for this name.');
      if (!user) {
        const userId = id();
        db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(userId, username, hash(pass), name);
        user = { id: userId, password: '' };
      }
      createSession(event, user.id);
      return { success: true };
    } catch (e) {
      if (isHttpError(e)) throw e;
      return fail(400, { error: e instanceof Error ? e.message : 'Could not sign in.' });
    }
  },
  logout: (event) => {
    logout(event);
    redirect(303, '/');
  },
  create: async (event) => {
    const user = getSession(event);
    if (!user) redirect(303, '/');
    const f = await event.request.formData();
    try {
      rateLimit(`create:${user.id}`);
      const name = text(f, 'trip', 60),
        start = validDate(text(f, 'start')),
        nights = tripNights(start, text(f, 'departure'));
      const currency = 'CZK';
      const location = locationUrl(f);
      if (db.prepare('SELECT 1 FROM trips WHERE name=? COLLATE NOCASE').get(name))
        throw new Error('That trip name is taken.');
      const tripId = id();
      db.transaction(() => {
        db.prepare(
          'INSERT INTO trips(id,name,owner_id,house,start,nights,currency,location_url) VALUES(?,?,?,?,?,?,?,?)'
        ).run(
          tripId,
          name,
          user.id,
          String(f.get('house') || '')
            .trim()
            .slice(0, 100),
          start,
          nights,
          currency,
          location
        );
        db.prepare('INSERT INTO members VALUES(?,?,?,?,0)').run(
          id(),
          tripId,
          user.name,
          user.username
        );
      })();
      return { tripId };
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : 'Could not create trip.' });
    }
  },
  demo: async (event) => {
    const user = getSession(event);
    if (!user) redirect(303, '/');
    rateLimit(`create:${user.id}`);
    const tripId = id();
    let sampleName = 'Sample trip',
      sampleNumber = 1;
    while (db.prepare('SELECT 1 FROM trips WHERE name=?').get(sampleName))
      sampleName = `Sample trip ${++sampleNumber}`;
    db.transaction(() => {
      db.prepare(
        'INSERT INTO trips(id,name,owner_id,house,start,nights,currency) VALUES(?,?,?,?,?,?,?)'
      ).run(tripId, sampleName, user.id, 'The Pine House · Šumava', '2026-11-20', 3, 'CZK');
      const names = [user.name, 'Jamie', 'Sam', 'Robin'];
      const people = names.map((name, i) => {
        const memberId = id();
        db.prepare('INSERT INTO members VALUES(?,?,?,?,?)').run(
          memberId,
          tripId,
          name,
          i === 0 ? user.username : `sample-${i}-${tripId.slice(0, 8)}`,
          i
        );
        return memberId;
      });
      const tagId = id();
      db.prepare('INSERT INTO tags VALUES(?,?,?)').run(tagId, tripId, 'Groceries');
      for (const member of people)
        db.prepare('INSERT INTO tag_members VALUES(?,?)').run(tagId, member);
      const entries = [
        ['The Pine House', 72000, 0, 'rent', null, '3 nights × 240 Kč'],
        ['Weekend groceries', 8640, 1, 'product', tagId, ''],
        ['Coffee & breakfast', 2850, 2, 'product', tagId, ''],
        ['Fuel to the mountains', 4200, 0, 'other', null, 'Car · fuel'],
        ['Sauna credits', 3600, 3, 'other', null, 'Benefit credits']
      ];
      for (const [title, amount, payer, kind, tag, note] of entries)
        db.prepare('INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          id(),
          tripId,
          title,
          amount,
          people[Number(payer)],
          kind,
          tag,
          null,
          note,
          '2026-11-20'
        );
      db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?)').run(
        id(),
        tripId,
        people[1],
        people[0],
        10000,
        '2026-11-19',
        'Deposit'
      );
    })();
    return { tripId };
  }
};
