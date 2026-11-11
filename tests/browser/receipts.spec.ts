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
  await expect(dialog.locator('.receipt-scan').first()).toBeVisible();
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
  await expect(first.getByRole('button', { name: 'EUR', exact: true })).toHaveText('€');
  await expect(first.getByRole('button', { name: 'CZK', exact: true })).toHaveText('Kč');
  await first.getByRole('button', { name: 'Rent', exact: true }).click();
  await failed.getByRole('button', { name: 'Extra', exact: true }).click();
  await expect(failed.getByLabel('Item name', { exact: true })).toHaveValue('');
  await expect(failed.getByAltText('fail.png', { exact: true })).toBeVisible();
  await first.getByLabel('Item amount', { exact: true }).fill('1.50');
  await first.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(first.locator('.receipt-product')).toHaveCount(2);
  await first.getByRole('button', { name: 'Remove item', exact: true }).last().click();
  await failed.getByLabel('Item name', { exact: true }).fill('Manual bread');
  await failed.getByLabel('Item amount', { exact: true }).fill('3.50');
  await expect(dialog.getByRole('button', { name: /^Add 2 items for/ })).toHaveText(
    /Add 2 items for 41,00\sKč/
  );
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
  expect(
    (
      await guestContext.request.post(`${tripPath}/scan`, {
        headers: { origin },
        multipart: { file: files[0] }
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await guestContext.request.delete(`${tripPath}/receipt/${drafts[0].id}`, {
        headers: { origin }
      })
    ).status()
  ).toBe(403);
  await page.request.post(`${tripPath}?/member`, { form: { name: 'Batch guest' } });
  expect((await guestContext.request.get(`${tripPath}/receipt/${drafts[0].id}`)).status()).toBe(
    200
  );
  expect(
    (
      await guestContext.request.post(`${tripPath}?/importReceipts`, {
        form: { receipts: JSON.stringify([{ draft: drafts[0].id }]) }
      })
    ).status()
  ).toBe(400);
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
  await dialog.getByRole('button', { name: /^Add 2 items for/ }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.receipt-card')).toHaveCount(2);
  expect(rows('SELECT * FROM receipts WHERE trip_id=?', tripId)).toHaveLength(2);
  expect(rows('SELECT * FROM receipt_drafts WHERE trip_id=?', tripId)).toHaveLength(0);
  expect(
    rows(
      'SELECT title,kind FROM expenses WHERE receipt_id IN (?,?) ORDER BY title',
      drafts[0].id,
      drafts[1].id
    )
  ).toEqual([
    { title: 'Manual bread', kind: 'other' },
    { title: 'Scanned coffee', kind: 'rent' }
  ]);
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
  await dialog.getByRole('button', { name: /^Add 1 item for/ }).click();
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
  await dialog.getByRole('button', { name: /^Add 2 items for/ }).click();
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

test('members can upload receipts and manage drafts from other members', async ({
  page,
  browser
}) => {
  const tripPath = await start(page, 'Guest upload owner');
  const tripId = tripPath.split('/').at(-1)!;
  const origin = new URL(page.url()).origin;
  const file = await receiptImage(page, 'guest-upload');
  const ownerUpload = await page.request.post(`${tripPath}/scan`, {
    headers: { origin },
    multipart: { file, manual: 'true' }
  });
  expect(ownerUpload.status()).toBe(200);
  const ownerDraft = await ownerUpload.json();
  const batchUpload = await page.request.post(`${tripPath}/scan`, {
    headers: { origin },
    multipart: { file, manual: 'true' }
  });
  const batchDraft = await batchUpload.json();
  const removeUpload = await page.request.post(`${tripPath}/scan`, {
    headers: { origin },
    multipart: { file, manual: 'true' }
  });
  const removeDraft = await removeUpload.json();
  const ownerId = rows('SELECT uploader_id FROM receipt_drafts WHERE id=?', ownerDraft.id)[0]
    .uploader_id;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await login(guest, 'Receipt guest');
    await page.request.post(`${tripPath}?/member`, { form: { name: 'Receipt guest' } });
    const guestId = rows(
      'SELECT id FROM members WHERE trip_id=? AND name=?',
      tripId,
      'Receipt guest'
    )[0].id;
    expect(
      (
        await guestContext.request.delete(`${tripPath}/receipt/${removeDraft.id}`, {
          headers: { origin }
        })
      ).status()
    ).toBe(200);
    expect(rows('SELECT * FROM receipt_drafts WHERE id=?', removeDraft.id)).toHaveLength(0);
    expect(
      (
        await guestContext.request.post(`${tripPath}?/importReceipts`, {
          form: {
            receipts: JSON.stringify([
              {
                draft: batchDraft.id,
                merchant: 'Shared batch',
                members: [guestId, ownerId],
                date: '2026-11-11',
                items: [{ title: 'Shared batch item', amount: '3', currency: 'CZK' }]
              }
            ])
          }
        })
      ).status()
    ).toBe(200);
    const forged = await guestContext.request.post(`${tripPath}/scan`, {
      headers: { origin },
      multipart: { file, manual: 'true', payer: ownerId }
    });
    expect(forged.status()).toBe(200);
    const ownDraft = await forged.json();
    expect(
      rows('SELECT uploader_id FROM receipt_drafts WHERE id=?', ownDraft.id)[0].uploader_id
    ).toBe(guestId);
    expect(
      (
        await guestContext.request.delete(`${tripPath}/receipt/${ownDraft.id}`, {
          headers: { origin }
        })
      ).status()
    ).toBe(200);
    expect(rows('SELECT * FROM receipt_drafts WHERE id=?', ownDraft.id)).toEqual([]);
    expect(
      (
        await guestContext.request.post(`${tripPath}?/importReceipt`, {
          form: {
            draft: ownerDraft.id,
            merchant: 'Shared receipt',
            members: ownerId,
            date: '2026-11-11',
            items: JSON.stringify([{ title: 'Shared receipt item', amount: '2', currency: 'CZK' }])
          }
        })
      ).status()
    ).toBe(200);
    for (const draft of [ownerDraft, batchDraft])
      expect(rows('SELECT payer_id FROM expenses WHERE receipt_id=?', draft.id)).toEqual([
        { payer_id: ownerId }
      ]);
    await guest.goto(tripPath);
    await expect(guest.locator('html[data-hydrated=true]')).toHaveCount(1);
    await guest.getByRole('button', { name: 'Receipts', exact: true }).first().click();
    await guest.getByRole('button', { name: 'Add receipt', exact: true }).click();
    const dialog = guest.locator('dialog[open]');
    await dialog.locator('input[type=file]').setInputFiles(file);
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Review receipt', exact: true })
    ).toBeVisible();
    const draft = rows(
      'SELECT id FROM receipt_drafts WHERE trip_id=? AND uploader_id=?',
      tripId,
      guestId
    )[0];
    const invalid = {
      draft: draft.id,
      merchant: 'Guest receipt',
      kind: 'invalid',
      date: '2026-11-11',
      members: [guestId],
      items: [{ title: 'Coffee', amount: '1.25', currency: 'EUR' }]
    };
    expect(
      (
        await guestContext.request.post(`${tripPath}?/importReceipts`, {
          form: { receipts: JSON.stringify([invalid]) }
        })
      ).status()
    ).toBe(400);
    await expect(dialog.getByRole('button', { name: 'Groceries', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await guest.setViewportSize({ width: 390, height: 1050 });
    await guest.screenshot({ path: '.test-data/receipt-work/guest-review.png', fullPage: true });
    await dialog.getByRole('button', { name: /^Add 1 item for 31,25\sKč/ }).click();
    await expect(guest.locator('dialog[open]')).toHaveCount(0);
    await expect(guest.locator('.receipt-card')).toHaveCount(3);
    expect(rows('SELECT payer_id,kind,amount FROM expenses WHERE receipt_id=?', draft.id)).toEqual([
      { payer_id: guestId, kind: 'product', amount: 3125 }
    ]);
    expect(rows('SELECT uploader_id FROM receipts WHERE id=?', draft.id)).toEqual([
      { uploader_id: guestId }
    ]);
    expect(rows('SELECT * FROM receipt_drafts WHERE id=?', ownerDraft.id)).toHaveLength(0);
  } finally {
    await guestContext.close();
  }
});

test('five receipt scans run in parallel and the total includes every receipt', async ({
  page
}) => {
  await start(page, 'Parallel scanner owner');
  const before = calls().length;
  const dialog = page.locator('dialog[open]');
  await dialog
    .locator('input[type=file]')
    .setInputFiles(
      await Promise.all(
        Array.from({ length: 6 }, (_, index) => receiptImage(page, `parallel-${index}`))
      )
    );
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.locator('.receipt-scan')).toHaveCount(5);
  const scan = dialog.locator('.receipt-scan').first();
  const preview = dialog.locator('.receipt-selection-card').first().locator('.receipt-preview');
  const scanBox = await scan.boundingBox(),
    previewBox = await preview.boundingBox();
  expect(scanBox!.width).toBeCloseTo(previewBox!.width, 0);
  expect(scanBox!.height).toBeCloseTo(previewBox!.height, 0);
  const band = scan.locator('.receipt-scan-band');
  expect(await band.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/receipt-sweep$/);
  await expect
    .poll(() => band.evaluate((el) => el.getBoundingClientRect().bottom))
    .toBeGreaterThan(scanBox!.y + scanBox!.height * 0.3);
  await page.screenshot({ path: '.test-data/receipt-work/full-image-scan.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await band.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await expect(dialog.getByRole('heading', { name: 'Review receipts', exact: true })).toBeVisible();
  expect(calls()).toHaveLength(before + 6);
  expect(JSON.parse(readFileSync(join(directory(), 'provider-stats.json'), 'utf8'))).toEqual({
    activeScans: 0,
    maximumScans: 5
  });
  await expect(dialog.getByRole('button', { name: /^Add 6 items for/ })).toHaveText(
    /Add 6 items for 187,50\sKč/
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
