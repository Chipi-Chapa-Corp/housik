import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

const scope = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const api = 'https://photospicker.googleapis.com/v1';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class GooglePhotosError extends Error {}
type Connection = { access_token: string; refresh_token: string; expires_at: number };
type Item = {
  id: string;
  type: string;
  mediaFile: { baseUrl: string; mimeType: string; filename: string };
};
type Job = {
  id: string;
  user_id: string;
  trip_id: string;
  status: string;
  session_id: string;
  access_token: string;
  expires_at: number;
  poll_after: number;
  items: string | null;
  cursor: number;
  added: number;
  skipped: number;
  failed: number;
  error: string;
};
type PickingSession = {
  id: string;
  pickerUri: string;
  expireTime: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
};
export type GooglePhotosProgress = {
  status: string;
  added: number;
  skipped: number;
  failed: number;
  processed: number;
  total: number;
  error: string;
  retryAfter: number;
};

// All provider requests stay server-side. The injected transport is used by unit fixtures only.
export function googlePhotosPicker(options: {
  db: Database.Database;
  clientId: string;
  clientSecret: string;
  canImport?: (userId: string, tripId: string) => boolean;
  save: (tripId: string, bytes: Buffer, sourceId: string) => Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const { db } = options;
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const locks = new Map<string, Promise<GooglePhotosProgress>>();
  const configured = !!(options.clientId && options.clientSecret);
  async function providerJson(url: string, init: RequestInit = {}) {
    const response = await request(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok)
      throw new GooglePhotosError(
        response.status === 401 || response.status === 403
          ? 'Google Photos access expired or was denied. Reconnect and try again.'
          : 'Google Photos is unavailable. Try again.'
      );
    return response.json();
  }
  async function tokens(body: Record<string, string>) {
    const result = await providerJson(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...body,
        client_id: options.clientId,
        client_secret: options.clientSecret
      })
    });
    if (typeof result.access_token !== 'string' || !Number.isFinite(result.expires_in))
      throw new GooglePhotosError(
        'Google Photos did not return valid access. Reconnect and try again.'
      );
    return result as { access_token: string; expires_in: number; refresh_token?: string };
  }
  function connection(userId: string) {
    return db
      .prepare(
        'SELECT access_token,refresh_token,expires_at FROM google_photos_connections WHERE user_id=?'
      )
      .get(userId) as Connection | undefined;
  }
  async function access(userId: string) {
    const saved = connection(userId);
    if (!saved) return null;
    if (saved.expires_at > now() + 60_000) return saved.access_token;
    if (!saved.refresh_token) return null;
    try {
      const result = await tokens({
        grant_type: 'refresh_token',
        refresh_token: saved.refresh_token
      });
      db.prepare(
        'UPDATE google_photos_connections SET access_token=?,refresh_token=?,expires_at=? WHERE user_id=?'
      ).run(
        result.access_token,
        result.refresh_token || saved.refresh_token,
        now() + result.expires_in * 1000,
        userId
      );
      return result.access_token;
    } catch {
      db.prepare('DELETE FROM google_photos_connections WHERE user_id=?').run(userId);
      return null;
    }
  }
  function jobFor(id: string, userId: string, tripId: string) {
    const job = db
      .prepare('SELECT * FROM google_photos_jobs WHERE id=? AND user_id=? AND trip_id=?')
      .get(id, userId, tripId) as Job | undefined;
    if (!job)
      throw new GooglePhotosError(
        'This photo selection is no longer available. Reload to start again.'
      );
    return job;
  }
  function progress(job: Job): GooglePhotosProgress {
    return {
      status: job.status,
      added: job.added,
      skipped: job.skipped,
      failed: job.failed,
      processed: job.cursor,
      total: job.items ? JSON.parse(job.items).length : 0,
      error: job.error,
      retryAfter: Math.max(1000, job.poll_after - now())
    };
  }
  async function session(jobId: string, accessToken: string) {
    const result: PickingSession = await providerJson(`${api}/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const uri = new URL(result.pickerUri);
    if (
      uri.protocol !== 'https:' ||
      uri.hostname !== 'photos.google.com' ||
      !result.id ||
      !Number.isFinite(Date.parse(result.expireTime))
    )
      throw new GooglePhotosError('Google Photos returned an invalid picker. Try again.');
    const expiry = Math.min(Date.parse(result.expireTime), now() + 60 * 60_000);
    const saved = db
      .prepare(
        "UPDATE google_photos_jobs SET status='picking',session_id=?,access_token=?,expires_at=?,poll_after=? WHERE id=? AND status='connecting'"
      )
      .run(result.id, accessToken, expiry, now() + interval(result), jobId);
    if (!saved.changes) {
      await request(`${api}/sessions/${encodeURIComponent(result.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
      throw new GooglePhotosError('Photo selection was cancelled.');
    }
    uri.pathname = `${uri.pathname.replace(/\/$/, '')}/autoclose`;
    return uri.href;
  }
  function interval(value: PickingSession) {
    const duration = Number.parseFloat(value.pollingConfig?.pollInterval || '5s') * 1000;
    return Number.isFinite(duration) ? Math.max(1000, duration) : 5000;
  }
  async function release(job: Job) {
    if (job.session_id && job.access_token) {
      // Deleting a picker session releases access, not the user's Google photos.
      await request(`${api}/sessions/${encodeURIComponent(job.session_id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${job.access_token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
    }
    db.prepare("UPDATE google_photos_jobs SET access_token='',items=NULL WHERE id=?").run(job.id);
  }
  async function step(jobId: string, userId: string, tripId: string) {
    let job = jobFor(jobId, userId, tripId);
    if (['done', 'error', 'cancelled'].includes(job.status)) return progress(job);
    if (job.expires_at <= now()) {
      db.prepare("UPDATE google_photos_jobs SET status='error',error=? WHERE id=?").run(
        'Photo selection expired. Reload to start again.',
        jobId
      );
      await release(job);
      return progress(jobFor(jobId, userId, tripId));
    }
    if (job.status === 'connecting' || job.poll_after > now()) return progress(job);
    try {
      if (job.status === 'picking') {
        const selected: PickingSession = await providerJson(
          `${api}/sessions/${encodeURIComponent(job.session_id)}`,
          {
            headers: { Authorization: `Bearer ${job.access_token}` }
          }
        );
        if (!selected.mediaItemsSet) {
          if (
            selected.pollingConfig?.timeoutIn &&
            Number.parseFloat(selected.pollingConfig.timeoutIn) <= 0
          )
            throw new GooglePhotosError('Photo selection expired. Reload to start again.');
          db.prepare('UPDATE google_photos_jobs SET poll_after=? WHERE id=?').run(
            now() + interval(selected),
            jobId
          );
          return progress(jobFor(jobId, userId, tripId));
        }
        const items: Item[] = [];
        const seen = new Set<string>();
        let pageToken = '';
        do {
          const url = new URL(`${api}/mediaItems`);
          url.searchParams.set('sessionId', job.session_id);
          url.searchParams.set('pageSize', '100');
          if (pageToken) url.searchParams.set('pageToken', pageToken);
          const page = await providerJson(url.href, {
            headers: { Authorization: `Bearer ${job.access_token}` }
          });
          const mediaItems = page.mediaItems ?? [];
          if (!Array.isArray(mediaItems) || items.length + mediaItems.length > 2000)
            throw new GooglePhotosError('Could not read the selected photos. Reload to try again.');
          items.push(...mediaItems);
          pageToken = page.nextPageToken || '';
          if (pageToken && seen.has(pageToken))
            throw new GooglePhotosError('Could not read all selected photos. Reload to try again.');
          seen.add(pageToken);
        } while (pageToken);
        db.prepare(
          "UPDATE google_photos_jobs SET status='importing',items=?,poll_after=0 WHERE id=?"
        ).run(JSON.stringify(items), jobId);
        job = jobFor(jobId, userId, tripId);
      }
      const items: Item[] = JSON.parse(job.items || '[]');
      // Small resumable batches keep each request bounded and show useful progress.
      for (const item of items.slice(job.cursor, job.cursor + 3)) {
        let outcome: 'added' | 'skipped' | 'failed' = 'skipped';
        if (item.type === 'PHOTO' && typeof item.id === 'string' && item.id) {
          const exists = db
            .prepare('SELECT 1 FROM place_photo_imports WHERE trip_id=? AND source_id=?')
            .get(tripId, item.id);
          if (!exists) {
            try {
              const url = new URL(item.mediaFile.baseUrl);
              if (
                url.protocol !== 'https:' ||
                !/^lh[0-9]+\.googleusercontent\.com$/.test(url.hostname) ||
                url.port ||
                url.username ||
                url.password
              )
                throw new GooglePhotosError('Invalid Google Photos image address.');
              // Request a bounded rendition rather than a potentially enormous original.
              const response = await request(`${url.href}=w2400-h2400`, {
                headers: { Authorization: `Bearer ${job.access_token}` },
                redirect: 'error',
                signal: AbortSignal.timeout(30_000)
              });
              if (
                !response.ok ||
                !response.body ||
                Number(response.headers.get('content-length')) > 10 * 1024 * 1024
              )
                throw new GooglePhotosError('Could not download this photo.');
              const reader = response.body.getReader();
              const chunks: Uint8Array[] = [];
              let size = 0;
              try {
                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  size += value.byteLength;
                  if (size > 10 * 1024 * 1024) throw new GooglePhotosError('Photo exceeds 10 MB.');
                  chunks.push(value);
                }
              } finally {
                await reader.cancel().catch(() => {});
              }
              outcome = (await options.save(tripId, Buffer.concat(chunks), item.id))
                ? 'added'
                : 'skipped';
            } catch {
              outcome = 'failed';
            }
          }
        }
        db.prepare(
          `UPDATE google_photos_jobs SET cursor=cursor+1,${outcome}=${outcome}+1 WHERE id=?`
        ).run(jobId);
      }
      job = jobFor(jobId, userId, tripId);
      if (job.cursor >= items.length) {
        db.prepare("UPDATE google_photos_jobs SET status='done' WHERE id=?").run(jobId);
        const result = progress({ ...job, status: 'done' });
        await release(job);
        return result;
      }
      return progress(job);
    } catch (cause) {
      db.prepare("UPDATE google_photos_jobs SET status='error',error=? WHERE id=?").run(
        cause instanceof GooglePhotosError
          ? cause.message
          : 'Could not import Google Photos. Reload to try again.',
        jobId
      );
      await release(job);
      return progress(jobFor(jobId, userId, tripId));
    }
  }
  return {
    configured,
    connected: (userId: string) => !!connection(userId),
    async start(userId: string, tripId: string, redirectUri: string) {
      if (!configured) throw new GooglePhotosError('Google Photos is not configured.');
      db.prepare('DELETE FROM google_photos_jobs WHERE expires_at<?').run(now() - 24 * 60 * 60_000);
      db.prepare('DELETE FROM google_photos_oauth WHERE expires_at<?').run(now());
      const jobId = randomUUID();
      db.prepare(
        "INSERT INTO google_photos_jobs(id,user_id,trip_id,status,expires_at) VALUES(?,?,?,'connecting',?)"
      ).run(jobId, userId, tripId, now() + 10 * 60_000);
      const accessToken = await access(userId);
      if (accessToken) {
        try {
          return { jobId, url: await session(jobId, accessToken), browser: null };
        } catch {
          db.prepare('DELETE FROM google_photos_connections WHERE user_id=?').run(userId);
        }
      }
      const state = randomBytes(32).toString('base64url');
      const browser = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      db.prepare('INSERT INTO google_photos_oauth VALUES(?,?,?,?,?,?)').run(
        digest(state),
        digest(browser),
        jobId,
        verifier,
        redirectUri,
        now() + 10 * 60_000
      );
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256'
      }).toString();
      return { jobId, url: url.href, browser };
    },
    async callback(userId: string, state: string, browser: string, code: string, denied: boolean) {
      const pending = db
        .prepare(
          `SELECT o.*,j.user_id,j.trip_id FROM google_photos_oauth o JOIN google_photos_jobs j ON j.id=o.job_id WHERE state_hash=?`
        )
        .get(digest(state)) as
        | {
            browser_hash: string;
            job_id: string;
            verifier: string;
            redirect_uri: string;
            expires_at: number;
            user_id: string;
            trip_id: string;
          }
        | undefined;
      if (
        !pending ||
        pending.user_id !== userId ||
        pending.browser_hash !== digest(browser) ||
        pending.expires_at < now() ||
        (options.canImport && !options.canImport(userId, pending.trip_id))
      )
        throw new GooglePhotosError(
          'Google Photos connection expired. Close this tab and try again.'
        );
      db.prepare('DELETE FROM google_photos_oauth WHERE state_hash=?').run(digest(state));
      try {
        if (denied || !code) throw new GooglePhotosError('Google Photos connection was cancelled.');
        const result = await tokens({
          code,
          grant_type: 'authorization_code',
          redirect_uri: pending.redirect_uri,
          code_verifier: pending.verifier
        });
        // Never reuse a previous account's refresh token when switching accounts.
        db.prepare(
          `INSERT INTO google_photos_connections VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at`
        ).run(
          userId,
          result.access_token,
          result.refresh_token || '',
          now() + result.expires_in * 1000
        );
        return await session(pending.job_id, result.access_token);
      } catch (cause) {
        db.prepare("UPDATE google_photos_jobs SET status='error',error=? WHERE id=?").run(
          cause instanceof GooglePhotosError
            ? cause.message
            : 'Could not connect Google Photos. Try again.',
          pending.job_id
        );
        throw cause;
      }
    },
    poll(jobId: string, userId: string, tripId: string) {
      jobFor(jobId, userId, tripId); // Authorize even when another request owns the lock.
      const existing = locks.get(jobId);
      if (existing) return existing;
      const pending = step(jobId, userId, tripId).finally(() => locks.delete(jobId));
      locks.set(jobId, pending);
      return pending;
    },
    async cancel(jobId: string, userId: string, tripId: string) {
      jobFor(jobId, userId, tripId);
      await locks.get(jobId);
      const job = jobFor(jobId, userId, tripId);
      if (!['done', 'error'].includes(job.status))
        db.prepare("UPDATE google_photos_jobs SET status='cancelled' WHERE id=?").run(jobId);
      db.prepare('DELETE FROM google_photos_oauth WHERE job_id=?').run(jobId);
      await release(job);
    }
  };
}
