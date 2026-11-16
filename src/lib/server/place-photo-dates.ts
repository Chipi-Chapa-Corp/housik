import type Database from 'better-sqlite3';
import type { PlacePhoto } from '../types';

export function migratePlacePhotoDates(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(place_photos)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'media_created_at'))
    db.exec('ALTER TABLE place_photos ADD COLUMN media_created_at INTEGER');
}

// Google's createTime is the media's creation time, stored as UTC milliseconds.
export function setPlacePhotoCreateTime(
  db: Database.Database,
  tripId: string,
  sourceId: string,
  createTime: unknown
) {
  if (typeof createTime !== 'string') return;
  const timestamp = Date.parse(createTime);
  if (!Number.isFinite(timestamp)) return;
  db.prepare(
    `UPDATE place_photos SET media_created_at=? WHERE trip_id=? AND id=(
      SELECT photo_id FROM place_photo_imports WHERE trip_id=? AND source_id=?
    )`
  ).run(timestamp, tripId, tripId, sourceId);
}

export function orderedPlacePhotos(db: Database.Database, tripId: string): PlacePhoto[] {
  return db
    .prepare(
      `SELECT id,width,height,mime,duration FROM place_photos WHERE trip_id=?
       ORDER BY COALESCE(media_created_at,unixepoch(created_at)*1000),rowid`
    )
    .all(tripId) as PlacePhoto[];
}
