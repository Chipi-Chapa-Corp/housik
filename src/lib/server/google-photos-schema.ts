import type Database from 'better-sqlite3';

export function migrateGooglePhotos(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_photos_connections (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL, refresh_token TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS google_photos_jobs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      status TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT '', access_token TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL, poll_after INTEGER NOT NULL DEFAULT 0,
      items TEXT, cursor INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS google_photos_oauth (
      state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
      job_id TEXT NOT NULL REFERENCES google_photos_jobs(id) ON DELETE CASCADE,
      verifier TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS place_photo_imports (
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, source_id TEXT NOT NULL,
      photo_id TEXT REFERENCES place_photos(id) ON DELETE SET NULL,
      PRIMARY KEY(trip_id, source_id)
    );
    UPDATE google_photos_connections SET access_token='',refresh_token='',expires_at=0
      WHERE access_token!='' OR refresh_token!='' OR expires_at!=0;
  `);
}
