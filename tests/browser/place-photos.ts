import { expect, request, type Page } from '@playwright/test';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createFixtureTrip, selectTripTab } from './fixtures';

export async function placePhotoFixture(width: number, height: number, background = '#738b94') {
  return {
    name: `place-${width}-${height}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width, height, channels: 3, background } })
      .jpeg()
      .toBuffer()
  };
}

export async function exercisePlacePhotos(page: Page, tripPath: string) {
  const errors: string[] = [];
  const recordError = (error: Error) => errors.push(error.message);
  page.on('pageerror', recordError);
  await selectTripTab(page, 'Home');
  const empty = page.getByRole('button', { name: 'Add place photos', exact: true });
  await expect(empty).toBeVisible();
  const stats = await page.getByRole('region', { name: 'Trip totals' }).boundingBox();
  const card = await empty.boundingBox();
  expect(card!.y).toBeGreaterThanOrEqual(stats!.y + stats!.height);
  expect(card!.width).toBeCloseTo(stats!.width, 0);
  const chooser = page.waitForEvent('filechooser');
  await empty.click();
  const input = await chooser;
  expect(input.isMultiple()).toBe(true);
  await input.setFiles(
    await Promise.all([
      placePhotoFixture(1800, 1200, '#9abbb3'),
      placePhotoFixture(800, 1200, '#b8a3ba'),
      placePhotoFixture(1000, 1000, '#c9b393')
    ])
  );
  const gallery = page.getByRole('region', { name: 'Place photos', exact: true });
  await expect(gallery.getByRole('button')).toHaveCount(3);
  await expect(page.locator('.add-place-photos')).toHaveCount(0);
  const thumbnail = await gallery.locator('img').first().getAttribute('src');
  const fullUrl = thumbnail!.split('?')[0];
  const full = await page.request.get(fullUrl);
  expect(full.status()).toBe(200);
  expect(full.headers()['content-type']).toBe('image/webp');
  expect(full.headers()['cache-control']).toBe('private, no-store');
  const fullMetadata = await sharp(await full.body()).metadata();
  const previewMetadata = await sharp(await (await page.request.get(thumbnail!)).body()).metadata();
  expect(fullMetadata.width).toBe(1800);
  expect(previewMetadata.width).toBe(960);

  await page.getByRole('button', { name: 'Trip settings' }).click();
  const settings = page.locator('dialog[open]');
  const originalName = await settings.getByLabel('Trip name', { exact: true }).inputValue();
  await settings.getByLabel('Trip name', { exact: true }).fill('Unsaved trip draft');
  const dates = await settings.locator('.form-grid').boundingBox();
  const addMore = settings.getByRole('button', { name: 'Add place photos', exact: true });
  const moreBounds = await addMore.boundingBox();
  expect(moreBounds!.y).toBeGreaterThanOrEqual(dates!.y + dates!.height);
  const moreChooser = page.waitForEvent('filechooser');
  await addMore.click();
  await (
    await moreChooser
  ).setFiles(
    await Promise.all([
      placePhotoFixture(2100, 700, '#a0b0cf'),
      placePhotoFixture(1000, 1600, '#bcaaa0')
    ])
  );
  await expect(page.locator('.place-photos .photo-tile')).toHaveCount(5);
  await expect(addMore).toBeEnabled();
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel('Trip name', { exact: true })).toHaveValue('Unsaved trip draft');
  await page.screenshot({ path: 'test-results/place-photo-settings.png', fullPage: true });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: originalName, exact: true })).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        gallery
          .locator('img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
            )
          )
      )
      .toBe(true);
    await expect
      .poll(() =>
        gallery.locator('img').evaluateAll((images) =>
          images.every((image) => {
            const box = image.getBoundingClientRect();
            const ratio =
              Number(image.getAttribute('width')) / Number(image.getAttribute('height'));
            return box.height > 0 && Math.abs(box.width / box.height - ratio) < 0.02;
          })
        )
      )
      .toBe(true);
    const bounds = await gallery.boundingBox();
    for (const image of await gallery.locator('img').all()) {
      const box = await image.boundingBox();
      const ratio =
        Number(await image.getAttribute('width')) / Number(await image.getAttribute('height'));
      expect(Math.abs(box!.width / box!.height - ratio)).toBeLessThan(0.02);
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `test-results/place-photos-${width}.png`, fullPage: true });
    await gallery.getByRole('button', { name: 'Enlarge place photo 2', exact: true }).click();
    const viewer = page.locator('dialog.image-viewer[open]');
    await expect(viewer.getByRole('heading')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await expect(viewer.getByRole('img')).toHaveAttribute('alt', 'Place photo 2');
    await viewer.getByRole('button', { name: 'Next image' }).click();
    await expect(viewer.getByRole('img')).toHaveAttribute('alt', 'Place photo 3');
    await page.keyboard.press('ArrowLeft');
    await expect(viewer.getByRole('img')).toHaveAttribute('alt', 'Place photo 2');
    await expect
      .poll(() =>
        viewer
          .locator('img')
          .evaluate(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
          )
      )
      .toBe(true);
    const imageBounds = (await viewer.locator('img').boundingBox())!;
    const removeBounds = (await viewer
      .getByRole('button', { name: 'Remove', exact: true })
      .boundingBox())!;
    expect(removeBounds.y - imageBounds.y - imageBounds.height).toBeGreaterThanOrEqual(8);
    expect(removeBounds.y - imageBounds.y - imageBounds.height).toBeLessThanOrEqual(16);
    for (const [name, edge] of [
      ['Previous image', imageBounds.x],
      ['Next image', imageBounds.x + imageBounds.width]
    ] as const) {
      const bounds = (await viewer.getByRole('button', { name }).boundingBox())!;
      expect(Math.abs(bounds.x + bounds.width / 2 - edge)).toBeLessThanOrEqual(21);
      expect(
        Math.abs(bounds.y + bounds.height / 2 - imageBounds.y - imageBounds.height / 2)
      ).toBeLessThan(1);
    }
    await page.screenshot({
      path: `test-results/place-photo-enlarged-${width}.png`,
      fullPage: false
    });
    if (width === 390) {
      const session = await page.context().newCDPSession(page);
      try {
        await session.send('Emulation.setTouchEmulationEnabled', {
          enabled: true,
          maxTouchPoints: 2
        });
        for (const direction of [-1, 1]) {
          const box = await viewer.locator('img').boundingBox();
          const x = box!.x + box!.width / 2,
            y = box!.y + box!.height / 2;
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: x - direction * 32, y }]
          });
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x + direction * 32, y }]
          });
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await expect(viewer.getByRole('img')).toHaveAttribute(
            'alt',
            direction === -1 ? 'Place photo 3' : 'Place photo 2'
          );
        }
      } finally {
        await session.detach();
      }
    }
    await viewer.click({ position: { x: 1, y: 1 } });
    await expect(viewer).toHaveCount(0);
  }
  await page.reload();
  await selectTripTab(page, 'Home');
  await expect(gallery.getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Add place photos', exact: true })).toHaveCount(0);

  // Rejected uploads do not leave extra gallery records, and files are private.
  const origin = new URL(page.url()).origin;
  expect(
    (
      await page.request.post(`${tripPath}/photos`, {
        multipart: { file: await placePhotoFixture(20, 20) }
      })
    ).status()
  ).toBe(403);
  const invalid = await page.request.post(`${tripPath}/photos`, {
    headers: { origin },
    multipart: {
      file: { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }
    }
  });
  expect(invalid.status()).toBe(400);
  const anonymous = await request.newContext({ baseURL: origin });
  try {
    expect((await anonymous.get(fullUrl, { maxRedirects: 0 })).status()).toBe(303);
  } finally {
    await anonymous.dispose();
  }
  await selectTripTab(page, 'Expenses');
  await expect(gallery).toHaveCount(0);
  await selectTripTab(page, 'Home');
  await expect(gallery.getByRole('button')).toHaveCount(5);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  const other = await createFixtureTrip(page, { people: false });
  const photoId = fullUrl.split('/').at(-1);
  expect((await page.request.get(`${other.path}/photos/${photoId}`)).status()).toBe(404);
  expect(
    (await page.request.delete(`${other.path}/photos/${photoId}`, { headers: { origin } })).status()
  ).toBe(404);
  expect((await page.request.delete(fullUrl)).status()).toBe(403);
  expect((await page.request.get(fullUrl)).status()).toBe(200);
  expect(
    (
      await page.request.post(`${other.path}/photos`, {
        headers: { origin },
        multipart: { file: await placePhotoFixture(40, 40) }
      })
    ).status()
  ).toBe(201);
  await page.goto(tripPath);
  await selectTripTab(page, 'Home');
  await expect(gallery.getByRole('button')).toHaveCount(5);
  await gallery.getByRole('button', { name: 'Enlarge place photo 1', exact: true }).click();
  for (let remaining = 5; remaining > 0; remaining--) {
    const viewer = page.locator('dialog.image-viewer[open]');
    const source = await viewer.locator('img').getAttribute('src');
    const id = source!.split('/').at(-1)!;
    await expect(viewer.getByRole('button', { name: 'Next image' })).toHaveCount(
      remaining > 1 ? 1 : 0
    );
    await viewer.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('.place-photos .photo-tile')).toHaveCount(remaining - 1);
    expect((await page.request.get(source!)).status()).toBe(404);
    const directory = resolve(process.env.HOUSIK_TEST_DIR!);
    expect(directory).toContain('/.test-data/');
    expect(existsSync(join(directory, 'place-photos', 'full', id))).toBe(false);
    expect(existsSync(join(directory, 'place-photos', 'thumbnails', id))).toBe(false);
  }
  await expect(page.locator('dialog.image-viewer[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add place photos', exact: true })).toBeVisible();
  await page.reload();
  await selectTripTab(page, 'Home');
  await expect(page.locator('.place-photos')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add place photos', exact: true })).toBeVisible();
  page.off('pageerror', recordError);
  expect(errors).toEqual([]);
}
