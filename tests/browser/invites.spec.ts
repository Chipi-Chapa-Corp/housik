import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { createFixtureTrip } from './fixtures';

async function login(page: Page, name: string) {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Password', { exact: true }).fill('invitation-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New trip', exact: true })).toBeVisible();
}
function membership(trip: string, username: string) {
  const db = new Database(join(process.env.HOUSIK_TEST_DIR!, 'housik.sqlite'), { readonly: true });
  try {
    return db
      .prepare('SELECT id FROM members WHERE trip_id=? AND username=? COLLATE NOCASE')
      .all(trip, username);
  } finally {
    db.close();
  }
}

test('shared links show join or trip sign-in, filter names and only expose trip data after joining', async ({
  page,
  browser
}) => {
  await login(page, 'Invite owner');
  const fixture = await createFixtureTrip(page, { purchase: true });
  const tripId = fixture.path.split('/').at(-1)!;
  const visitorContext = await browser.newContext();
  const signedOutContext = await browser.newContext();
  try {
    const visitor = await visitorContext.newPage();
    await login(visitor, 'Existing visitor');
    const invitation = await visitor.goto(fixture.path);
    expect(invitation!.status()).toBe(200);
    await expect(visitor.locator('html[data-hydrated=true]')).toHaveCount(1);
    await expect(visitor.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'Join trip', exact: true })).toBeVisible();
    await expect(visitor.locator('.invite-user')).toHaveText('Existing visitor');
    await expect(visitor.locator('.expense-row')).toHaveCount(0);
    expect(await invitation!.text()).not.toContain('Shared purchase');
    expect((await visitor.request.get(`${fixture.path}/receipt/not-a-receipt`)).status()).toBe(403);
    expect(
      (
        await visitor.request.post(`${fixture.path}?/expense`, { form: { title: 'Forbidden' } })
      ).status()
    ).toBe(403);
    for (const width of [1440, 390]) {
      await visitor.setViewportSize({ width, height: 900 });
      expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await visitor.screenshot({ path: `.test-data/invite-join-${width}.png`, fullPage: true });
    }
    await visitor.getByRole('button', { name: 'Join trip', exact: true }).click();
    await expect(visitor.getByRole('button', { name: 'Add expense', exact: true })).toBeVisible();
    await expect(
      visitor.locator('.expense-row').filter({ hasText: 'Shared purchase' })
    ).toBeVisible();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await visitor.request.post(`${fixture.path}?/join`, { form: {}, maxRedirects: 0 })
        ).status()
      ).toBe(200);
    expect(membership(tripId, 'Existing visitor')).toHaveLength(1);
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Join trip', exact: true })).toHaveCount(0);
    await expect(visitor.getByRole('button', { name: 'Add expense', exact: true })).toBeVisible();

    const signedOut = await signedOutContext.newPage();
    await signedOut.goto(fixture.path);
    await expect(signedOut.locator('html[data-hydrated=true]')).toHaveCount(1);
    await expect(
      signedOut.getByRole('heading', { name: `Sign in · ${fixture.name}`, exact: true })
    ).toBeVisible();
    const name = signedOut.getByRole('combobox', { name: 'Name', exact: true });
    await name.click();
    await expect(signedOut.getByRole('option')).toHaveCount(5);
    await expect(
      signedOut.getByRole('option', { name: 'Existing visitor', exact: true })
    ).toBeVisible();
    for (const width of [1440, 390]) {
      await signedOut.setViewportSize({ width, height: 900 });
      expect(
        await signedOut.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      ).toBe(true);
      await signedOut.screenshot({ path: `.test-data/invite-signin-${width}.png`, fullPage: true });
    }
    await name.fill('sa');
    await expect(signedOut.getByRole('option')).toHaveCount(1);
    await signedOut.getByRole('option', { name: 'Sam', exact: true }).click();
    await expect(name).toHaveValue('Sam');
    await signedOut.getByRole('button', { name: 'Choose name', exact: true }).click();
    await expect(signedOut.getByRole('option')).toHaveCount(5);
    await name.fill('New traveler');
    await signedOut.getByLabel('Password', { exact: true }).fill('invitation-password');
    await signedOut.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(signedOut.getByRole('button', { name: 'Add expense', exact: true })).toBeVisible();
    expect(membership(tripId, 'New traveler')).toHaveLength(1);
    await signedOut.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signedOut.goto(fixture.path);
    await expect(signedOut.locator('html[data-hydrated=true]')).toHaveCount(1);
    const existingName = signedOut.getByRole('combobox', { name: 'Name', exact: true });
    await existingName.fill('New traveler');
    await existingName.press('ArrowDown');
    await existingName.press('Enter');
    await signedOut.getByLabel('Password', { exact: true }).fill('incorrect-password');
    await signedOut.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(signedOut.getByRole('alert')).toHaveText('Incorrect password for this name.');
    await expect(signedOut.getByRole('button', { name: 'Add expense', exact: true })).toHaveCount(
      0
    );
    await signedOut.getByLabel('Password', { exact: true }).fill('invitation-password');
    await signedOut.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(signedOut.getByRole('button', { name: 'Add expense', exact: true })).toBeVisible();
    expect(membership(tripId, 'New traveler')).toHaveLength(1);
    const missing = await page.request.get('/trip/00000000-0000-4000-8000-000000000000');
    expect(missing.status()).toBe(404);
  } finally {
    await visitorContext.close();
    await signedOutContext.close();
  }
});
