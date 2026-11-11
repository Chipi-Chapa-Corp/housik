import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { db } from './db';
export type User = { id: string; username: string; name: string };
export type Session = {
  trip_id: string;
  member_id: string | null;
  role: 'owner' | 'guest';
  user: User;
};
export function hash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verify(password: string, saved: string) {
  const [salt, value] = saved.split(':');
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(value, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function getSession(event: RequestEvent): User | undefined {
  const token = event.cookies.get('housik');
  if (!token) return;
  const session = db
    .prepare(
      'SELECT u.id,u.username,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?'
    )
    .get(digest(token)) as User | undefined;
  if (session) setCookie(event, token);
  return session;
}
function setCookie(event: RequestEvent, token: string) {
  event.cookies.set('housik', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 400
  });
}
export function createSession(event: RequestEvent, userId: string) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(digest(token), userId);
  setCookie(event, token);
}
export function logout(event: RequestEvent) {
  const token = event.cookies.get('housik');
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
  event.cookies.delete('housik', { path: '/' });
}
export function requireSession(event: RequestEvent): Session {
  const user = getSession(event);
  if (!user) redirect(303, '/');
  const tripId = event.params.id || '';
  const trip = db.prepare('SELECT owner_id FROM trips WHERE id=?').get(tripId) as
    { owner_id: string } | undefined;
  if (!trip) error(404, 'Trip not found.');
  const member = db
    .prepare('SELECT id FROM members WHERE trip_id=? AND username=? COLLATE NOCASE')
    .get(tripId, user.username) as { id: string } | undefined;
  const role = trip.owner_id === user.id ? 'owner' : 'guest';
  if (role === 'guest' && !member) error(403, 'This trip is private.');
  return { trip_id: tripId, member_id: member?.id || null, role, user };
}
export function rateLimit(key: string) {
  const now = Date.now();
  db.prepare('DELETE FROM login_limits WHERE reset<?').run(now);
  const row = db.prepare('SELECT attempts FROM login_limits WHERE key=?').get(key) as
    { attempts: number } | undefined;
  if (row && row.attempts >= 15) error(429, 'Too many attempts. Try again in 15 minutes.');
  db.prepare(
    'INSERT INTO login_limits(key,attempts,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1'
  ).run(key, now + 15 * 60_000);
}
export function text(form: FormData, name: string, max = 100) {
  const value = String(form.get(name) ?? '').trim();
  if (!value || value.length > max) throw new Error(`Check ${name}.`);
  return value;
}
export function locationUrl(form: FormData) {
  const location = String(form.get('location_url') || '').trim();
  if (location.length > 2048) throw new Error('Location link is too long.');
  if (location) {
    try {
      const url = new URL(location);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error('Enter an http or https location link.');
    }
  }
  return location;
}
export function password(form: FormData) {
  const value = String(form.get('password') ?? '');
  if (value.length < 8 || value.length > 128)
    throw new Error('Use a password with 8–128 characters.');
  return value;
}
export { validDate } from '#lib/dates.ts';
