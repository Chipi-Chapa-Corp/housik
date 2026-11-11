import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { receiptPrompt } from '../../src/lib/server/receipt-scanner';
const directory = () => resolve(process.env.HOUSIK_RECEIPT_TEST_DIR!);
function rows(sql: string, ...params: string[]) {
  const db = new Database(join(directory(), 'housik.sqlite'), { readonly: true });
  try {
    return db.prepare(sql).all(...params) as Record<string, any>[];
  } finally {
    db.close();
  }
}
const calls = () => JSON.parse(readFileSync(join(directory(), 'provider-calls.json'), 'utf8'));
async function login(page: Page, name: string) {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Password', { exact: true }).fill('receipt-test-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sample trip', exact: true })).toBeVisible();
}
async function start(page: Page, name: string) {
  await login(page, name);
  await page.getByRole('button', { name: 'Sample trip', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Sample trip/ })).toBeVisible();
  const path = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Receipts', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add receipt', exact: true }).click();
  return path;
}
async function receiptImage(page: Page, marker: string) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 340;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 240, 340);
    ctx.fillStyle = '#343434';
    ctx.font = '20px sans-serif';
    ctx.fillText('MARKET', 25, 40);
    ctx.font = '14px sans-serif';
    for (const [i, text] of [
      '11.11.2026',
      'Coffee             1.25 EUR',
      'Bread              3.50 CZK',
      '-------------------------',
      'Thank you'
    ].entries())
      ctx.fillText(text, 20, 90 + i * 35);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return {
    name: `${marker}.png`,
    mimeType: 'image/png',
    buffer: Buffer.concat([Buffer.from(base64, 'base64'), Buffer.from(marker)])
  };
}

test('batch previews, per-file scanning, manual failure review and atomic import', async ({
  page,
  browser
}) => {
  const tripPath = await start(page, 'Batch owner');
  const tripId = tripPath.split('/').at(-1)!;
  const origin = new URL(page.url()).origin;
  let dialog = page.locator('dialog[open]');
  const files = await Promise.all(
    ['first', 'fail', 'remove-a', 'remove-b', 'remove-c'].map((name) => receiptImage(page, name))
  );
  await dialog.locator('input[type=file]').setInputFiles(files);
  await expect(dialog.locator('.receipt-selection-card')).toHaveCount(5);
  expect(calls()).toHaveLength(0);
  expect(
    await dialog
      .locator('.receipt-selection')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  ).toBe(2);
  expect(
    await dialog.locator('.receipt-selection').evaluate((el) => el.scrollHeight > el.clientHeight)
  ).toBe(true);
  await page.screenshot({
    path: '.test-data/receipt-work/batch-select-desktop.png',
    fullPage: true
  });
  for (const name of ['remove-a', 'remove-b', 'remove-c'])
    await dialog.getByRole('button', { name: `Remove receipt ${name}.png`, exact: true }).click();
  await expect(dialog.locator('.receipt-selection-card')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.locator('.neural-overlay').first()).toBeVisible();
  await expect(dialog.locator('.receipt-selection-card[data-status=succeeded]')).toHaveCount(1);
  await page.screenshot({ path: '.test-data/receipt-work/batch-processing.png', fullPage: true });
  await expect(dialog.getByRole('heading', { name: 'Review receipts', exact: true })).toBeVisible();
  await expect(dialog.locator('.receipt-review-card')).toHaveCount(2);
  const sections = await dialog.locator('.receipt-review-card').all();
  const top = await sections[0].boundingBox(),
    bottom = await sections[1].boundingBox();
  expect(bottom!.y).toBeGreaterThanOrEqual(top!.y + top!.height);
  expect(
    await dialog.locator('.receipt-review-list').evaluate((el) => getComputedStyle(el).overflowY)
  ).toBe('visible');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(dialog.getByRole('img', { name: 'Scan succeeded', exact: true })).toHaveCount(1);
  await expect(dialog.getByRole('img', { name: 'Scan failed', exact: true })).toHaveCount(1);
  expect(calls()).toHaveLength(2);
  for (const call of calls()) {
    expect(call.instructions).toBe(receiptPrompt);
    expect(call.text.format.strict).toBe(true);
    expect(call.text.format.schema.properties.products.type).toBe('array');
    expect(call.input[0].content).toHaveLength(1);
    expect(call.input[0].content[0].type).toBe('input_image');
  }
  const first = dialog.locator('.receipt-review-card[data-status=succeeded]');
  const failed = dialog.locator('.receipt-review-card[data-status=failed]');
  await expect(dialog.getByText('Paid by', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(first.getByLabel('Item name', { exact: true })).toHaveValue('Scanned coffee');
  await expect(first.getByLabel('Item amount', { exact: true })).toHaveValue('1.25');
  await expect(first.getByRole('button', { name: 'EUR', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(first.getByRole('button', { name: 'EUR', exact: true })).toHaveText('E');
  await expect(first.getByRole('button', { name: 'CZK', exact: true })).toHaveText('Kc');
  await expect(failed.getByLabel('Item name', { exact: true })).toHaveValue('');
  await expect(failed.getByAltText('fail.png', { exact: true })).toBeVisible();
  await first.getByLabel('Item amount', { exact: true }).fill('1.50');
  await first.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(first.locator('.receipt-product')).toHaveCount(2);
  await first.getByRole('button', { name: 'Remove item', exact: true }).last().click();
  await failed.getByLabel('Item name', { exact: true }).fill('Manual bread');
  await failed.getByLabel('Item amount', { exact: true }).fill('3.50');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    const layout = await dialog.evaluate((el) => {
      const list = el.querySelector('.receipt-review-list')!;
      const cards = [...el.querySelectorAll('.receipt-review-card')].map((card) =>
        card.getBoundingClientRect()
      );
      const overflowing = [
        ...el.querySelectorAll(
          '.receipt-review-list,.receipt-review-card,.receipt-products,.receipt-product'
        )
      ]
        .filter((element) => element.scrollWidth > element.clientWidth)
        .map((element) => element.className);
      return {
        columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
        sameWidth: cards.every(
          (card) => Math.abs(card.width - list.getBoundingClientRect().width) < 1
        ),
        vertical: cards[1].top >= cards[0].bottom,
        horizontalScroll: el.scrollWidth > el.clientWidth,
        overflowing
      };
    });
    expect(layout).toEqual({
      columns: 1,
      sameWidth: true,
      vertical: true,
      horizontalScroll: false,
      overflowing: []
    });
  }
  await page.screenshot({
    path: '.test-data/receipt-work/batch-review-desktop.png',
    fullPage: true
  });
  await failed.getByRole('button', { name: 'Enlarge receipt fail.png', exact: true }).click();
  const viewer = page.locator('dialog[open]').last();
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(viewer.getByAltText('fail.png', { exact: true })).toHaveAttribute('style', /200%/);
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  const drafts = rows('SELECT * FROM receipt_drafts WHERE trip_id=? ORDER BY filename', tripId);
  expect(drafts).toHaveLength(2);
  for (const draft of drafts) {
    expect(statSync(join(directory(), 'receipts', draft.id)).mode & 0o777).toBe(0o600);
    const original = await page.request.get(`${tripPath}/receipt/${draft.id}`);
    expect(original.status()).toBe(200);
    expect(original.headers()['cache-control']).toBe('private, no-store');
  }
  expect(statSync(join(directory(), 'receipts')).mode & 0o777).toBe(0o700);
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await login(guest, 'Batch guest');
  expect((await guestContext.request.get(`${tripPath}/receipt/${drafts[0].id}`)).status()).toBe(
    403
  );
  await page.request.post(`${tripPath}?/member`, { form: { name: 'Batch guest' } });
  expect((await guestContext.request.get(`${tripPath}/receipt/${drafts[0].id}`)).status()).toBe(
    200
  );
  expect(
    (
      await guestContext.request.delete(`${tripPath}/receipt/${drafts[0].id}`, {
        headers: { origin }
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await guestContext.request.post(`${tripPath}/scan`, {
        headers: { origin },
        multipart: { payer: drafts[0].uploader_id, file: files[0] }
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await guestContext.request.post(`${tripPath}?/importReceipts`, { form: { receipts: '[]' } })
    ).status()
  ).toBe(403);
  expect(
    (
      await page.request.delete(`${tripPath}/receipt/${drafts[0].id}`, {
        headers: { origin: 'https://foreign.invalid' }
      })
    ).status()
  ).toBe(403);
  const prepared = drafts.map((draft) => ({
    draft: draft.id,
    merchant: draft.merchant,
    payer: draft.uploader_id,
    date: '2026-11-11',
    members: [draft.uploader_id],
    items: [{ title: 'Fixture item', amount: '1', currency: 'CZK' }]
  }));
  const invalid = await page.request.post(`${tripPath}?/importReceipts`, {
    form: { receipts: JSON.stringify([prepared[0], { ...prepared[1], items: [] }]) }
  });
  expect(invalid.status()).toBe(400);
  expect(rows('SELECT * FROM receipts WHERE trip_id=?', tripId)).toHaveLength(0);
  expect(rows('SELECT * FROM receipt_drafts WHERE trip_id=?', tripId)).toHaveLength(2);
  expect(
    (
      await page.request.post(`${tripPath}?/importReceipts`, {
        form: { receipts: JSON.stringify([prepared[0], prepared[0]]) }
      })
    ).status()
  ).toBe(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.test-data/receipt-work/batch-review-mobile.png',
    fullPage: true
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Add 2 items', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.receipt-card')).toHaveCount(2);
  expect(rows('SELECT * FROM receipts WHERE trip_id=?', tripId)).toHaveLength(2);
  expect(rows('SELECT * FROM receipt_drafts WHERE trip_id=?', tripId)).toHaveLength(0);
  expect(
    (
      await page.request.post(`${tripPath}?/importReceipts`, {
        form: { receipts: JSON.stringify(prepared) }
      })
    ).status()
  ).toBe(400);
  await page.request.delete(`${tripPath}/receipt/${drafts[0].id}`, { headers: { origin } });
  expect((await page.request.get(`${tripPath}/receipt/${drafts[0].id}`)).status()).toBe(200);
  await page.getByRole('button', { name: 'Expenses', exact: true }).last().click();
  await expect(
    page.locator('.expense-row').filter({ hasText: 'Scanned coffee' }).locator('.expense-total')
  ).toHaveText(/^37,50/);
  await expect(
    page.locator('.expense-row').filter({ hasText: 'Manual bread' }).locator('.expense-total')
  ).toHaveText(/^3,50/);
  await guestContext.close();
});

test('empty scans remain attached, receipt removal deletes only its draft, and trip scope is enforced', async ({
  page
}) => {
  const tripPath = await start(page, 'Draft owner');
  const tripId = tripPath.split('/').at(-1)!;
  const dialog = page.locator('dialog[open]');
  const before = calls().length;
  await dialog
    .locator('input[type=file]')
    .setInputFiles(await Promise.all(['second', 'empty'].map((name) => receiptImage(page, name))));
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review receipts', exact: true })).toBeVisible();
  expect(calls()).toHaveLength(before + 2);
  const failed = dialog.locator('.receipt-review-card[data-status=failed]');
  await expect(failed.getByAltText('empty.png', { exact: true })).toBeVisible();
  await expect(failed.getByLabel('Item name', { exact: true })).toHaveValue('');
  const empty = rows(
    'SELECT * FROM receipt_drafts WHERE trip_id=? AND filename=?',
    tripId,
    'empty.png'
  )[0];
  const success = rows(
    'SELECT * FROM receipt_drafts WHERE trip_id=? AND filename=?',
    tripId,
    'second.png'
  )[0];
  await page.request.post('/?/create', {
    form: { trip: 'Other receipt trip', start: '2026-11-20', departure: '2026-11-23' }
  });
  const otherId = rows('SELECT id FROM trips WHERE name=?', 'Other receipt trip')[0].id;
  expect((await page.request.get(`/trip/${otherId}/receipt/${success.id}`)).status()).toBe(404);
  expect(
    (
      await page.request.post(`/trip/${otherId}?/importReceipts`, {
        form: { receipts: JSON.stringify([{ draft: success.id }]) }
      })
    ).status()
  ).toBe(400);
  await failed.getByRole('button', { name: 'Remove receipt empty.png', exact: true }).click();
  await expect(dialog.locator('.receipt-review-card')).toHaveCount(1);
  await expect.poll(() => rows('SELECT * FROM receipt_drafts WHERE id=?', empty.id).length).toBe(0);
  expect(existsSync(join(directory(), 'receipts', empty.id))).toBe(false);
  expect((await page.request.get(`${tripPath}/receipt/${empty.id}`)).status()).toBe(404);
  await dialog.getByRole('button', { name: 'Add 1 items', exact: true }).click();
  await expect(page.locator('.receipt-card')).toHaveCount(1);
  expect((await page.request.get(`${tripPath}/receipt/${success.id}`)).status()).toBe(200);
});

test('receipt defaults, item overrides and undetected currency survive import', async ({
  page
}) => {
  const tripPath = await start(page, 'Receipt settings owner');
  const tripId = tripPath.split('/').at(-1)!;
  const dialog = page.locator('dialog[open]');
  await dialog.locator('input[type=file]').setInputFiles(await receiptImage(page, 'unknown'));
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review receipt', exact: true })).toBeVisible();
  const card = dialog.locator('.receipt-review-card');
  const common = card.locator(':scope > .receipt-defaults');
  const people = rows('SELECT id,name FROM members WHERE trip_id=? ORDER BY rowid', tripId);
  expect(people.length).toBeGreaterThan(1);
  const draft = rows('SELECT * FROM receipt_drafts WHERE trip_id=?', tripId)[0];
  await expect(card.getByLabel('Item amount', { exact: true })).toHaveValue('1.25');
  await expect(card.getByRole('button', { name: 'CZK', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await common.getByLabel('Date', { exact: true }).fill('2026-11-10');
  const first = card.locator('.receipt-product').first();
  await first.getByLabel('Item name', { exact: true }).fill('Individual item');
  await first.getByRole('button', { name: 'Item settings', exact: true }).click();
  const settings = first.locator('.receipt-item-settings');
  await expect(settings.getByLabel('Date', { exact: true })).toHaveValue('2026-11-10');
  // Untouched item fields follow subsequent edits to the receipt.
  await common.getByLabel('Date', { exact: true }).fill('2026-11-09');
  await expect(settings.getByLabel('Date', { exact: true })).toHaveValue('2026-11-09');
  await settings.getByLabel('Date', { exact: true }).fill('2026-11-08');
  for (const member of people.slice(1))
    await settings.getByRole('button', { name: `Remove ${member.name}`, exact: true }).click();
  await first.getByRole('button', { name: 'Use receipt defaults', exact: true }).click();
  await expect(settings.getByLabel('Date', { exact: true })).toHaveValue('2026-11-09');
  await expect(settings.locator('.member-chip')).toHaveCount(people.length);
  await settings.getByLabel('Date', { exact: true }).fill('2026-11-08');
  for (const member of people.slice(1))
    await settings.getByRole('button', { name: `Remove ${member.name}`, exact: true }).click();
  await first.getByRole('button', { name: 'Item settings', exact: true }).click();
  await card.getByRole('button', { name: 'Add item', exact: true }).click();
  const second = card.locator('.receipt-product').nth(1);
  await second.getByLabel('Item name', { exact: true }).fill('Shared item');
  await second.getByLabel('Item amount', { exact: true }).fill('2');
  await second.getByRole('button', { name: 'EUR', exact: true }).click();
  // Exercise search, keyboard selection and the colored full-name chips.
  const sharedPeople = common.getByRole('combobox', { name: 'Share with', exact: true });
  await common.getByRole('button', { name: `Remove ${people[0].name}`, exact: true }).click();
  await sharedPeople.fill(people[0].name);
  await sharedPeople.press('ArrowDown');
  await sharedPeople.press('Enter');
  await expect(common.locator('.member-chip')).toHaveCount(people.length);
  await sharedPeople.press('Escape');
  await common.getByRole('button', { name: `Remove ${people[0].name}`, exact: true }).click();
  await common.getByLabel('Date', { exact: true }).fill('2026-11-07');
  await second.getByRole('button', { name: 'Item settings', exact: true }).click();
  await expect(second.getByLabel('Date', { exact: true })).toHaveValue('2026-11-07');
  await expect(second.locator('.member-chip')).toHaveCount(people.length - 1);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const dateBox = await common.getByLabel('Date', { exact: true }).boundingBox();
    const peopleBox = await common.locator('.member-input').boundingBox();
    expect(Math.abs(dateBox!.y - peopleBox!.y)).toBeLessThan(2);
    if (width === 320)
      await page.screenshot({ path: '.test-data/receipt-work/settings-320.png', fullPage: true });
  }
  await page.screenshot({ path: '.test-data/receipt-work/settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 1050 });
  await page.screenshot({ path: '.test-data/receipt-work/settings-mobile.png', fullPage: true });
  const imported = page.waitForRequest((request) => request.url().includes('?/importReceipts'));
  await dialog.getByRole('button', { name: 'Add 2 items', exact: true }).click();
  const submitted = JSON.parse(
    new URLSearchParams((await imported).postData()!).get('receipts')!
  )[0];
  expect(submitted).not.toHaveProperty('payer');
  expect(submitted.items[0]).not.toHaveProperty('expanded');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const expenses = rows('SELECT * FROM expenses WHERE receipt_id=? ORDER BY rowid', draft.id);
  expect(
    expenses.map(({ title, amount, input_amount, input_currency, date, payer_id }) => ({
      title,
      amount,
      input_amount,
      input_currency,
      date,
      payer_id
    }))
  ).toEqual([
    {
      title: 'Individual item',
      amount: 125,
      input_amount: 125,
      input_currency: 'CZK',
      date: '2026-11-08',
      payer_id: draft.uploader_id
    },
    {
      title: 'Shared item',
      amount: 5000,
      input_amount: 200,
      input_currency: 'EUR',
      date: '2026-11-07',
      payer_id: draft.uploader_id
    }
  ]);
  expect(rows('SELECT member_id FROM expense_members WHERE expense_id=?', expenses[0].id)).toEqual([
    { member_id: people[0].id }
  ]);
  expect(rows('SELECT member_id FROM expense_members WHERE expense_id=?', expenses[1].id)).toEqual(
    []
  );
  expect(
    rows('SELECT member_id FROM tag_members WHERE tag_id=?', expenses[1].tag_id)
      .map(({ member_id }) => member_id)
      .sort()
  ).toEqual(
    people
      .slice(1)
      .map(({ id }) => id)
      .sort()
  );
});
