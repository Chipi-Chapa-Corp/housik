import { expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';

// Browser fixtures live only in the runner's separate database, never in the app.
export async function createFixtureTrip(
  page: Page,
  options: { people?: boolean; purchase?: boolean } = {}
) {
  const name = `Test trip ${randomUUID().slice(0, 8)}`;
  await expect(page.getByRole('button', { name: 'New trip', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Trip name', { exact: true }).fill(name);
  await dialog.getByLabel('Arrival', { exact: true }).fill('2026-11-20');
  await dialog.getByLabel('Departure', { exact: true }).fill('2026-11-23');
  await dialog.getByRole('button', { name: 'Create trip', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const path = new URL(page.url()).pathname;
  if (options.people === false) return { path, name };
  const tripId = path.split('/').at(-1)!;
  const directory = process.env.HOUSIK_RECEIPT_TEST_DIR || process.env.HOUSIK_TEST_DIR;
  if (!directory || !resolve(directory).includes('/.test-data/'))
    throw new Error('Fixture database must be inside .test-data.');
  const db = new Database(join(directory, 'housik.sqlite'));
  db.pragma('foreign_keys = ON');
  try {
    db.transaction(() => {
      const owner = db.prepare('SELECT id FROM members WHERE trip_id=?').get(tripId) as {
        id: string;
      };
      const people = [owner.id];
      for (const [index, name] of ['Jamie', 'Sam', 'Robin'].entries()) {
        const id = randomUUID();
        db.prepare('INSERT INTO members VALUES(?,?,?,?,?)').run(
          id,
          tripId,
          name,
          `fixture-${id}`,
          index + 1
        );
        people.push(id);
      }
      const tag = randomUUID();
      db.prepare('INSERT INTO tags VALUES(?,?,?)').run(tag, tripId, 'Groceries');
      for (const person of people)
        db.prepare('INSERT INTO tag_members VALUES(?,?)').run(tag, person);
      if (options.purchase) {
        // A legacy amount keeps coverage of expenses saved before input currencies existed.
        db.prepare(
          'INSERT INTO expenses(id,trip_id,title,amount,payer_id,kind,tag_id,note,date) VALUES(?,?,?,?,?,?,?,?,?)'
        ).run(
          randomUUID(),
          tripId,
          'Shared purchase',
          8640,
          people[1],
          'product',
          tag,
          '',
          '2026-11-20'
        );
      }
    })();
  } finally {
    db.close();
  }
  await page.reload();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  return { path, name };
}
