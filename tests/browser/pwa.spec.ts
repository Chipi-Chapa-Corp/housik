import { createFixtureTrip } from './fixtures';
import { test, expect } from '@playwright/test';

test('cold first paint is styled without JavaScript or external CSS and never swaps a late font', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  let releaseFonts!: () => void;
  const fontDownload = new Promise<void>((resolve) => (releaseFonts = resolve));
  let fontRequested = false;
  await context.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    // A cold connection: CSS is unavailable and fonts arrive after first paint.
    if (path.endsWith('.css')) return route.abort();
    if (path.endsWith('.woff2')) {
      fontRequested = true;
      await fontDownload;
    }
    return route.continue();
  });
  try {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.ok()).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => performance.getEntriesByName('first-contentful-paint').length)
      )
      .toBe(1);
    expect(fontRequested).toBe(true);
    expect(await page.evaluate(() => document.fonts.status)).toBe('loading');
    await expect(page.locator('html')).not.toHaveAttribute('data-hydrated');
    await expect(page.locator('body')).toHaveCSS('margin', '0px');
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 247, 248)');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCSS('font-size', '16px');
    await expect(page.locator('link[rel="preload"][as="font"]')).toHaveAttribute(
      'href',
      '/fonts/onest-latin.woff2'
    );
    const inlineStyles = await page.locator('head style').allTextContents();
    expect(inlineStyles.join('\n')).toContain('.signin-card');
    expect(inlineStyles.join('\n')).toContain('font-display:optional');
    const layout = () =>
      page.locator('.signin-card').evaluate((card) => {
        const rect = (bounds: DOMRect) => {
          const { x, y, width, height } = bounds;
          return { x, y, width, height };
        };
        const boxes = [card, ...card.querySelectorAll('h1, label, input, button')].map((element) =>
          rect(element.getBoundingClientRect())
        );
        const text = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        while (text.nextNode()) {
          if (!text.currentNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(text.currentNode);
          boxes.push(rect(range.getBoundingClientRect()));
        }
        return boxes;
      });
    const firstPaint = await layout();
    releaseFonts();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(await page.evaluate(() => document.fonts.check('400 16px Onest', 'Sign in'))).toBe(true);
    expect(await layout()).toEqual(firstPaint);
  } finally {
    releaseFonts();
    await context.close();
  }
});

test('install metadata and home-screen icons', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest'
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    /\/icons\/apple-touch-icon\.png$/
  );
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: '/',
    name: 'Housik',
    start_url: '/',
    scope: '/',
    display: 'standalone'
  });
  for (const icon of [
    ...manifest.icons,
    { src: '/icons/apple-touch-icon.png', sizes: '180x180' }
  ]) {
    const image = await page.request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toContain('image/png');
    const png = await image.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  const cdp = await page.context().newCDPSession(page);
  const parsed = await cdp.send('Page.getAppManifest');
  expect(parsed.errors).toEqual([]);
  await cdp.detach();
});

test('offline launch recovers without caching private pages or queuing writes', async ({
  page,
  context
}) => {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByLabel('Name', { exact: true }).fill('PWA tester');
  await page.getByLabel('Password', { exact: true }).fill('pwa-test-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const fixture = await createFixtureTrip(page, { people: false });
  const tripUrl = page.url();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true
        })
      );
    }
  });

  const cachedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return paths;
  });
  expect(cachedPaths).toContain('/offline.html');
  expect(cachedPaths.some((path) => path.startsWith('/_app/immutable/'))).toBe(true);
  expect(cachedPaths).not.toContain('/');
  expect(cachedPaths.some((path) => path.startsWith('/trip/'))).toBe(false);

  await context.setOffline(true);
  const rejected = await page.evaluate(async () => {
    const paths = [
      { url: `${location.pathname}/__data.json`, method: 'GET' },
      { url: `${location.pathname}?/payment`, method: 'POST' }
    ];
    return Promise.all(
      paths.map(async ({ url, method }) => {
        try {
          await fetch(url, { method });
          return false;
        } catch {
          return true;
        }
      })
    );
  });
  expect(rejected).toEqual([true, true]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.getByText('PWA tester', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/pwa-offline-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await context.setOffline(false);
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page).toHaveURL(tripUrl);
  await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto(tripUrl);
  await expect(
    page.getByRole('heading', { name: `Sign in · ${fixture.name}`, exact: true })
  ).toBeVisible();
});
