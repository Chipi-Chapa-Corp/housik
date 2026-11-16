import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createFixtureTrip } from './fixtures';

async function login(page: Page, name: string) {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Password', { exact: true }).fill('test-google-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New trip', exact: true })).toBeVisible();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
}

test('Settings connects Google Photos, Reload skips existing photos, cancellation and access controls work', async ({
  page,
  context,
  browser
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'Photos owner');
  const { path: tripPath } = await createFixtureTrip(page, { people: false });
  const origin = new URL(page.url()).origin;
  const directory = resolve(process.env.HOUSIK_TEST_DIR!);
  await context.route('https://accounts.google.com/**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.has('login_hint')).toBe(false);
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'
    );
    const callback = `${origin}/auth/google-photos/callback?state=${encodeURIComponent(url.searchParams.get('state')!)}&code=fixture-code`;
    await route.fulfill({
      contentType: 'text/html',
      body: `<a href="${callback.replaceAll('&', '&amp;')}">Allow Google Photos</a>`
    });
  });
  await context.route('https://photos.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<button onclick="setTimeout(() => window.close(), 100)">Done</button>'
    })
  );
  await page.getByRole('button', { name: 'Trip settings' }).click();
  const settings = page.locator('dialog[open]');
  await settings.getByLabel('Trip name', { exact: true }).fill('Unsaved photo settings');
  const blocked = await page.request.post(`${tripPath}/google-photos`, {
    headers: { origin: 'https://other.example' }
  });
  expect(blocked.status()).toBe(403);
  const popupEvent = context.waitForEvent('page');
  await settings.getByRole('button', { name: 'Connect', exact: true }).click();
  const popup = await popupEvent;
  await popup.getByRole('link', { name: 'Allow Google Photos' }).click();
  await expect(popup).toHaveURL(/photos.google.com\/picker\/fixture-session-1\/autoclose/);
  writeFileSync(join(directory, 'fixture-session-1.selected'), 'ready');
  await popup.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('2 added · 0 skipped');
  await expect(settings.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
  await expect(settings.getByLabel('Trip name', { exact: true })).toHaveValue(
    'Unsaved photo settings'
  );
  await expect(page.locator('.place-photos .photo-tile')).toHaveCount(2);
  await page.screenshot({ path: '.test-data/google-photos-settings-desktop.png' });
  const reloadPopup = context.waitForEvent('page');
  await settings.getByRole('button', { name: 'Reload', exact: true }).click();
  const reopened = await reloadPopup;
  await reopened.getByRole('link', { name: 'Allow Google Photos' }).click();
  await expect(reopened).toHaveURL(/photos.google.com\/picker\/fixture-session-2\/autoclose/);
  writeFileSync(join(directory, 'fixture-session-2.selected'), 'ready');
  await reopened.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('1 added · 2 skipped');
  await expect(page.locator('.place-photos .photo-tile')).toHaveCount(3);
  const calls = readFileSync(join(directory, 'google-calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls.filter((call) => call.host === 'lh3.googleusercontent.com')).toHaveLength(3);
  const pendingPopup = context.waitForEvent('page');
  await settings.getByRole('button', { name: 'Reload', exact: true }).click();
  const pending = await pendingPopup;
  await pending.getByRole('link', { name: 'Allow Google Photos' }).click();
  await expect(pending).toHaveURL(/fixture-session-3/);
  const job = await page.evaluate(
    () =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith('housik:google-photos:'))
        .map((key) => sessionStorage.getItem(key))[0]
  );
  const unrelated = await browser.newContext();
  const other = await unrelated.newPage();
  await login(other, 'Other photos user');
  await createFixtureTrip(other, { people: false });
  const unauthorized = await other.request.post(`${tripPath}/google-photos/${job}`, {
    headers: { origin }
  });
  expect(unauthorized.status()).toBe(403);
  await unrelated.close();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
  await expect(settings.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  const cancelled = await page.request.post(`${tripPath}/google-photos/${job}`, {
    headers: { origin }
  });
  expect((await cancelled.json()).status).toBe('cancelled');
  await pending.close();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: '.test-data/google-photos-settings-mobile.png' });
  const row = await settings.locator('.google-photos-row').boundingBox();
  expect(row!.x + row!.width).toBeLessThanOrEqual(390);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.place-photos .photo-tile').first().click();
  await page
    .locator('dialog.image-viewer[open]')
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(page.locator('.place-photos .photo-tile')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.image-viewer[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Trip settings' }).click();
  const removedPopup = context.waitForEvent('page');
  await settings.getByRole('button', { name: 'Reload', exact: true }).click();
  const removed = await removedPopup;
  await removed.getByRole('link', { name: 'Allow Google Photos' }).click();
  await expect(removed).toHaveURL(/fixture-session-4/);
  // Reloading the app resumes the same pending picker selection.
  await page.reload();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Trip settings' }).click();
  await expect(settings.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  writeFileSync(join(directory, 'fixture-session-4.selected'), 'ready');
  await removed.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText('0 added · 3 skipped');
  await expect(page.locator('.place-photos .photo-tile')).toHaveCount(2);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.locator('.place-photos .photo-tile')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('mixed imports update the gallery before completion and videos play, seek, navigate and remove', async ({
  page,
  context
}) => {
  await login(page, 'Video owner');
  const { path: tripPath } = await createFixtureTrip(page, { people: false });
  const directory = resolve(process.env.HOUSIK_TEST_DIR!);
  writeFileSync(join(directory, 'video-mode'), 'true');
  const origin = new URL(page.url()).origin;
  await context.route('https://accounts.google.com/**', async (route) => {
    const url = new URL(route.request().url());
    const callback = `${origin}/auth/google-photos/callback?state=${url.searchParams.get('state')}&code=video-code`;
    await route.fulfill({
      contentType: 'text/html',
      body: `<a href="${callback.replaceAll('&', '&amp;')}">Allow</a>`
    });
  });
  await context.route('https://photos.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<button onclick="setTimeout(() => window.close(), 100)">Done</button>'
    })
  );
  await page.getByRole('button', { name: 'Trip settings' }).click();
  const settings = page.locator('dialog[open]');
  const opening = context.waitForEvent('page');
  await settings.getByRole('button', { name: 'Connect', exact: true }).click();
  const picker = await opening;
  await picker.getByRole('link', { name: 'Allow', exact: true }).click();
  await expect(picker).toHaveURL(/photos.google.com\/picker\//);
  const session = new URL(picker.url()).pathname.split('/').at(-2)!;
  writeFileSync(join(directory, `${session}.selected`), 'ready');
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.photo-tile')).toHaveCount(3);
  await expect(settings.getByRole('status')).toHaveText('Importing (3/4)');
  await expect(settings.getByRole('status')).toHaveText('4 added · 0 skipped', { timeout: 30000 });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  let releaseThumbnails!: () => void;
  const thumbnailsReady = new Promise<void>((resolve) => {
    releaseThumbnails = resolve;
  });
  await page.route('**/photos/*?size=thumbnail', async (route) => {
    await thumbnailsReady;
    await route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  const firstTile = page.locator('.photo-tile').first();
  await expect(firstTile.locator('.skeleton')).toBeVisible();
  await expect(firstTile.locator('img')).toHaveAttribute('alt', '');
  expect((await firstTile.textContent())?.trim()).toBe('');
  const beforeLoad = await firstTile.boundingBox();
  await page.screenshot({ path: '.test-data/gallery-skeletons.png' });
  releaseThumbnails();
  await expect(firstTile.locator('img')).toHaveCSS('opacity', '1');
  expect((await firstTile.boundingBox())!.height).toBeCloseTo(beforeLoad!.height, 0);
  await page.unroute('**/photos/*?size=thumbnail');
  const tile = page.getByRole('button', { name: 'Play place video 4', exact: true });
  await expect(tile).toBeVisible();
  await tile.click();
  const viewer = page.locator('dialog.image-viewer[open]');
  const video = viewer.locator('video');
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(viewer.getByRole('heading')).toHaveCount(0);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  const source = await video.getAttribute('src');
  const full = await page.request.get(source!);
  expect(full.status()).toBe(200);
  expect(full.headers()['content-type']).toBe('video/mp4');
  const range = await page.request.get(source!, { headers: { range: 'bytes=0-63' } });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(64);
  expect(range.headers()['content-range']).toMatch(/^bytes 0-63\//);
  expect(
    (await page.request.get(source!, { headers: { range: 'bytes=999999999-' } })).status()
  ).toBe(416);
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.1);
  await video.evaluate((v: HTMLVideoElement) => {
    (window as unknown as { oldVideo: HTMLVideoElement }).oldVideo = v;
    v.currentTime = 1;
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: '.test-data/place-video-viewer.png' });
  await viewer.getByRole('button', { name: 'Previous image' }).click();
  await expect(viewer.locator('video')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { oldVideo: HTMLVideoElement }).oldVideo.paused)
  ).toBe(true);
  await viewer.getByRole('button', { name: 'Next image' }).click();
  await viewer.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.photo-tile')).toHaveCount(3);
  expect((await page.request.get(source!)).status()).toBe(404);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Trip settings' }).click();
  const chooser = page.waitForEvent('filechooser');
  await settings.getByRole('button', { name: 'Add place photos', exact: true }).click();
  const { videoFixture } = await import('./video-fixture');
  await (await chooser).setFiles(videoFixture(directory));
  await expect(page.locator('.photo-tile')).toHaveCount(4);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play place video 4', exact: true })).toBeVisible();
});
