import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { googlePhotosPicker } from '../src/lib/server/google-photos-picker';
import { migrateGooglePhotos } from '../src/lib/server/google-photos-schema';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('alice'),('bob');
    CREATE TABLE trips(id TEXT PRIMARY KEY); INSERT INTO trips VALUES('trip'),('other');
    CREATE TABLE place_photos(id TEXT PRIMARY KEY);`);
  migrateGooglePhotos(db);
  let clock = Date.now();
  let selection = false;
  let membership = true;
  let badDownload = '';
  let pages = [
    [photo('one'), photo('two'), { ...photo('video'), type: 'VIDEO' }],
    [photo('three')]
  ];
  const calls: { url: string; init?: RequestInit }[] = [];
  const downloads: string[] = [];
  const saves: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/token')) {
      return Response.json({
        access_token: 'private-access',
        refresh_token: 'private-refresh',
        expires_in: 3600
      });
    }
    if (url.includes('/sessions') && init?.method === 'DELETE')
      return new Response(null, { status: 204 });
    if (url.endsWith('/sessions'))
      return Response.json({
        id: 'google-session',
        pickerUri: 'https://photos.google.com/picker/session',
        expireTime: new Date(clock + 30 * 60_000).toISOString(),
        pollingConfig: { pollInterval: '2s' }
      });
    if (url.includes('/sessions/'))
      return Response.json({
        mediaItemsSet: selection,
        pollingConfig: { pollInterval: '3s', timeoutIn: '100s' }
      });
    if (url.includes('/mediaItems')) {
      const index = new URL(url).searchParams.has('pageToken') ? 1 : 0;
      return Response.json({
        mediaItems: pages[index],
        ...(index === 0 && pages.length > 1 ? { nextPageToken: 'page2' } : {})
      });
    }
    if (url.startsWith('https://lh3.googleusercontent.com/')) {
      downloads.push(url);
      if (url.includes(badDownload) && badDownload)
        return new Response('unavailable', { status: 503 });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const service = googlePhotosPicker({
    db,
    clientId: 'client',
    clientSecret: 'secret',
    canImport: () => membership,
    now: () => clock,
    fetch: fetcher,
    save: async (trip, bytes, id) => {
      assert.deepEqual(bytes, Buffer.from([1, 2, 3]));
      const exists = db
        .prepare('SELECT 1 FROM place_photo_imports WHERE trip_id=? AND source_id=?')
        .get(trip, id);
      if (exists) return false;
      saves.push(id);
      db.prepare('INSERT INTO place_photo_imports VALUES(?,?,NULL)').run(trip, id);
      return true;
    }
  });
  async function authorize() {
    const start = await service.start(
      'alice',
      'trip',
      'http://localhost/auth/google-photos/callback'
    );
    const state = new URL(start.url).searchParams.get('state')!;
    return {
      start,
      state,
      url: await service.callback('alice', state, start.browser!, 'code', false)
    };
  }
  return {
    db,
    service,
    calls,
    downloads,
    saves,
    authorize,
    advance: (ms = 4000) => {
      clock += ms;
    },
    revokeMembership: () => {
      membership = false;
    },
    select: () => {
      selection = true;
    },
    failDownload: (id: string) => {
      badDownload = id;
    },
    pages: (value: typeof pages) => {
      pages = value;
    }
  };
}
function photo(id: string) {
  return {
    id,
    type: 'PHOTO',
    mediaFile: {
      baseUrl: `https://lh3.googleusercontent.com/${id}`,
      mimeType: 'image/jpeg',
      filename: `${id}.jpg`
    }
  };
}

test('OAuth uses least-privilege scope, state, browser binding and PKCE; callbacks cannot be replayed', async () => {
  const f = fixture();
  try {
    const start = await f.service.start('alice', 'trip', 'http://localhost/callback');
    const url = new URL(start.url),
      state = url.searchParams.get('state')!;
    assert.equal(
      url.searchParams.get('scope'),
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
    );
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    for (const [user, nonce, browser] of [
      ['bob', state, start.browser!],
      ['alice', 'wrong', start.browser!],
      ['alice', state, 'wrong']
    ])
      await assert.rejects(f.service.callback(user, nonce, browser, 'code', false));
    assert.equal(f.calls.length, 0);
    assert.match(
      await f.service.callback('alice', state, start.browser!, 'code', false),
      /\/autoclose$/
    );
    await assert.rejects(f.service.callback('alice', state, start.browser!, 'code', false));
    const body = new URLSearchParams(String(f.calls[0].init?.body));
    assert(body.get('code_verifier'));
    assert.equal(body.get('redirect_uri'), 'http://localhost/callback');
    assert.equal(f.service.connected('alice'), true);
    assert.equal(f.service.connected('bob'), false);
  } finally {
    f.db.close();
  }
});

test('picker imports all pages in resumable batches, honors poll intervals and skips repeated IDs on Reload', async () => {
  const f = fixture();
  try {
    const { start } = await f.authorize();
    let p = await f.service.poll(start.jobId, 'alice', 'trip');
    assert.equal(p.status, 'picking');
    assert.equal(f.calls.filter((c) => c.url.includes('/sessions/')).length, 0);
    f.advance();
    p = await f.service.poll(start.jobId, 'alice', 'trip');
    assert.equal(p.retryAfter, 3000);
    f.select();
    f.advance();
    const concurrent = await Promise.all([
      f.service.poll(start.jobId, 'alice', 'trip'),
      f.service.poll(start.jobId, 'alice', 'trip')
    ]);
    assert.deepEqual(concurrent[0], concurrent[1]);
    assert.equal(concurrent[0].status, 'importing');
    p = await f.service.poll(start.jobId, 'alice', 'trip');
    assert.equal(p.status, 'done');
    assert.equal(p.added, 4);
    assert.equal(p.skipped, 0);
    assert.deepEqual(f.saves, ['one', 'two', 'video', 'three']);
    assert(
      f.downloads
        .filter((url) => !url.includes('/video'))
        .every((url) => url.endsWith('=w2400-h2400'))
    );
    assert(f.downloads.some((url) => url.endsWith('/video=dv')));
    assert(
      f.calls
        .filter((c) => c.url.includes('googleusercontent'))
        .every(
          (c) =>
            (c.init?.headers as Record<string, string>).Authorization === 'Bearer private-access'
        )
    );
    assert(!JSON.stringify(p).includes('private-access'));
    const reload = await f.service.start('alice', 'trip', 'http://localhost/callback');
    assert(reload.browser);
    assert.equal(new URL(reload.url).searchParams.get('prompt'), 'select_account');
    await f.service.callback(
      'alice',
      new URL(reload.url).searchParams.get('state')!,
      reload.browser,
      'code',
      false
    );
    f.advance();
    await f.service.poll(reload.jobId, 'alice', 'trip');
    p = await f.service.poll(reload.jobId, 'alice', 'trip');
    assert.equal(p.added, 0);
    assert.equal(p.skipped, 4);
    assert.equal(f.downloads.length, 4);
    assert.equal(
      (
        f.db
          .prepare('SELECT access_token FROM google_photos_jobs WHERE id=?')
          .get(reload.jobId) as { access_token: string }
      ).access_token,
      ''
    );
  } finally {
    f.db.close();
  }
});

test('job access is isolated to its user and trip; cancellation, denied OAuth and expired sessions are recoverable', async () => {
  const f = fixture();
  try {
    const { start } = await f.authorize();
    assert.throws(() => f.service.poll(start.jobId, 'bob', 'trip'));
    assert.throws(() => f.service.poll(start.jobId, 'alice', 'other'));
    await assert.rejects(f.service.cancel(start.jobId, 'bob', 'trip'));
    await f.service.cancel(start.jobId, 'alice', 'trip');
    assert.equal((await f.service.poll(start.jobId, 'alice', 'trip')).status, 'cancelled');
    const next = await f.service.start('alice', 'trip', 'http://localhost/callback');
    f.advance(31 * 60_000);
    const expired = await f.service.poll(next.jobId, 'alice', 'trip');
    assert.equal(expired.status, 'error');
    assert.match(expired.error, /expired/);
    const denied = await f.service.start('bob', 'trip', 'http://localhost/callback');
    await assert.rejects(
      f.service.callback(
        'bob',
        new URL(denied.url).searchParams.get('state')!,
        denied.browser!,
        '',
        true
      )
    );
    assert.equal((await f.service.poll(denied.jobId, 'bob', 'trip')).status, 'error');
  } finally {
    f.db.close();
  }
});

test('failed images can be retried, and untrusted media addresses never receive access tokens', async () => {
  const f = fixture();
  try {
    const unsafe = photo('unsafe');
    unsafe.mediaFile.baseUrl = 'https://example.com/steal';
    f.pages([[photo('one'), photo('broken'), unsafe]]);
    f.failDownload('broken');
    const { start } = await f.authorize();
    f.select();
    f.advance();
    let p = await f.service.poll(start.jobId, 'alice', 'trip');
    assert.equal(p.added, 1);
    assert.equal(p.failed, 2);
    assert(!f.calls.some((c) => c.url.includes('example.com')));
    f.failDownload('');
    const { start: next } = await f.authorize();
    f.advance();
    p = await f.service.poll(next.jobId, 'alice', 'trip');
    assert.equal(p.added, 1);
    assert.equal(p.skipped, 1);
    assert.equal(p.failed, 1);
    assert.deepEqual(f.saves, ['one', 'broken']);
  } finally {
    f.db.close();
  }
});

test('Reload always asks for an account, including with a previously connected account', async () => {
  const f = fixture();
  try {
    await f.authorize();
    const before = f.calls.length;
    for (let count = 0; count < 2; count++) {
      const start = await f.service.start('alice', 'trip', 'http://localhost/callback');
      const url = new URL(start.url);
      assert.equal(url.origin, 'https://accounts.google.com');
      assert.equal(url.searchParams.get('prompt'), 'select_account');
      assert.equal(url.searchParams.get('access_type'), 'online');
      assert.equal(url.searchParams.has('login_hint'), false);
      assert(start.browser);
      assert.equal(f.calls.length, before);
      f.advance(61 * 60_000);
    }
    assert.deepEqual(
      f.db.prepare('SELECT access_token,refresh_token FROM google_photos_connections').get(),
      { access_token: '', refresh_token: '' }
    );
  } finally {
    f.db.close();
  }
});

test('empty selections finish without downloading or saving any images', async () => {
  const f = fixture();
  try {
    f.pages([[]]);
    const { start } = await f.authorize();
    f.select();
    f.advance();
    const result = await f.service.poll(start.jobId, 'alice', 'trip');
    assert.equal(result.status, 'done');
    assert.equal(result.added, 0);
    assert.equal(f.downloads.length, 0);
  } finally {
    f.db.close();
  }
});

test('OAuth callbacks require current trip membership and expire after ten minutes', async () => {
  const f = fixture();
  try {
    const first = await f.service.start('alice', 'trip', 'http://localhost/callback');
    f.revokeMembership();
    await assert.rejects(
      f.service.callback(
        'alice',
        new URL(first.url).searchParams.get('state')!,
        first.browser!,
        'code',
        false
      )
    );
    assert.equal(f.calls.length, 0);
    const second = await f.service.start('bob', 'trip', 'http://localhost/callback');
    f.advance(11 * 60_000);
    await assert.rejects(
      f.service.callback(
        'bob',
        new URL(second.url).searchParams.get('state')!,
        second.browser!,
        'code',
        false
      )
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.close();
  }
});

test('each processed video is published without waiting for the next video in the selection', async () => {
  const f = fixture();
  try {
    f.pages([
      [
        { ...photo('clip-a'), type: 'VIDEO' },
        { ...photo('clip-b'), type: 'VIDEO' }
      ]
    ]);
    const { start } = await f.authorize();
    f.select();
    f.advance();
    const first = await f.service.poll(start.jobId, 'alice', 'trip');
    assert.equal(first.status, 'importing');
    assert.equal(first.processed, 1);
    assert.equal(first.added, 1);
    assert.deepEqual(f.saves, ['clip-a']);
    const second = await f.service.poll(start.jobId, 'alice', 'trip');
    assert.equal(second.status, 'done');
    assert.equal(second.added, 2);
    assert.deepEqual(f.saves, ['clip-a', 'clip-b']);
  } finally {
    f.db.close();
  }
});
