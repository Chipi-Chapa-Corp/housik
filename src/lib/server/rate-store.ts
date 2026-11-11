import type Database from 'better-sqlite3';
import { rateScale } from '../currency';
import { validDate } from '../dates';

export const refreshInterval = 15 * 60 * 1000;
export const rateUrl = 'https://api.frankfurter.dev/v2/rate/EUR/CZK';
export type ExchangeRate = { rate: number; source_date: string; fetched_at: number };

export function createRateStore(
  db: Database.Database,
  options: { fetch?: typeof fetch; now?: () => number; url?: string } = {}
) {
  const fetchRate = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  db.exec(`CREATE TABLE IF NOT EXISTS exchange_rates (
    pair TEXT PRIMARY KEY CHECK(pair='EUR/CZK'),
    rate INTEGER, source_date TEXT, fetched_at INTEGER,
    checked_at INTEGER NOT NULL DEFAULT 0
  ); INSERT OR IGNORE INTO exchange_rates(pair) VALUES('EUR/CZK');`);
  let pending: Promise<ExchangeRate | null> | null = null;
  function latest(): ExchangeRate | null {
    const row = db
      .prepare('SELECT rate,source_date,fetched_at FROM exchange_rates WHERE pair=?')
      .get('EUR/CZK') as ExchangeRate | undefined;
    return row?.rate ? row : null;
  }
  function refresh(): Promise<ExchangeRate | null> {
    if (pending) return pending;
    const stamp = now();
    const { checked_at } = db
      .prepare('SELECT checked_at FROM exchange_rates WHERE pair=?')
      .get('EUR/CZK') as { checked_at: number };
    if (checked_at && stamp - checked_at < refreshInterval) return Promise.resolve(latest());
    // Claim the refresh in SQLite so simultaneous requests/processes cannot flood the API.
    const claim = db
      .prepare('UPDATE exchange_rates SET checked_at=? WHERE pair=? AND checked_at=?')
      .run(stamp, 'EUR/CZK', checked_at);
    if (!claim.changes) return Promise.resolve(latest());
    pending = (async () => {
      try {
        const response = await fetchRate(options.url ?? rateUrl, {
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (
          body.base !== 'EUR' ||
          body.quote !== 'CZK' ||
          typeof body.rate !== 'number' ||
          !Number.isFinite(body.rate) ||
          body.rate <= 0 ||
          typeof body.date !== 'string'
        )
          throw new Error('Invalid exchange rate');
        validDate(body.date);
        const units = Math.round(body.rate * rateScale);
        if (!Number.isSafeInteger(units) || units <= 0) throw new Error('Invalid exchange rate');
        db.prepare('UPDATE exchange_rates SET rate=?,source_date=?,fetched_at=? WHERE pair=?').run(
          units,
          body.date,
          now(),
          'EUR/CZK'
        );
      } catch (error) {
        console.warn(
          'EUR/CZK rate refresh failed:',
          error instanceof Error ? error.message : error
        );
      }
      return latest();
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  function refreshIn() {
    const row = db.prepare('SELECT checked_at FROM exchange_rates WHERE pair=?').get('EUR/CZK') as {
      checked_at: number;
    };
    return Math.max(1000, row.checked_at + refreshInterval - now());
  }
  return { latest, refresh, refreshIn };
}
