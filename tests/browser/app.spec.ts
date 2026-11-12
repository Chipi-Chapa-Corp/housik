import { createFixtureTrip } from './fixtures';
import { test, expect, type Page } from '@playwright/test';
const owner = 'Álex Novák! +'.padEnd(20, '!'),
  guest = 'Jamie O’Neil & Co.';
const pass = 'weekend-test-password';
async function login(page: Page, name: string) {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('maxlength', '20');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Password', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.trips-home')).toBeVisible();
  await expect(page.locator('.home-shell .brand')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toHaveCount(0);
}
async function close(page: Page) {
  await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
test('complete trip lifecycle, receipts, exact shares and guest authorization', async ({
  page,
  browser
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/signin-desktop.png', fullPage: true });
  const tooLong = await page.request.post('/?/login', {
    form: { name: 'a'.repeat(21), password: pass }
  });
  expect(tooLong.status()).toBe(400);
  await login(page, owner);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'housik')?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === 'housik')?.expires).toBeGreaterThan(
    Date.now() / 1000 + 300 * 86400
  );
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  let dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Trip name').fill('Mountain weekend');
  await dialog.getByLabel('House / place').fill('The Pine House · Šumava');
  await dialog.getByLabel('Location link').fill('https://maps.example.com/pine-house');
  await dialog.getByLabel('Arrival').fill('2026-11-20');
  await expect(dialog.getByLabel('Nights', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Departure').fill('2026-11-23');
  await page.screenshot({ path: 'test-results/trip-dates.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Create trip' }).click();
  await expect(page).toHaveURL(/\/trip\//);
  const tripUrl = page.url();
  const tripPath = new URL(tripUrl).pathname;
  await expect(page.getByRole('heading', { name: 'Mountain weekend' })).toBeVisible();
  await expect(
    page.locator('.trip-title-row').getByRole('button', { name: 'Trip settings' })
  ).toBeVisible();
  await expect(page.locator('.trip-meta-row .name-bubble').first()).toBeVisible();
  await expect(page.locator('.trip-meta-row .name-bubble').first()).toHaveText(owner);
  await expect(page.locator('.avatar')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'The Pine House · Šumava' })).toHaveAttribute(
    'href',
    'https://maps.example.com/pine-house'
  );
  await page.getByRole('button', { name: 'Trip settings' }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await expect(page.locator('dialog[open]').getByLabel('Departure')).toHaveValue('2026-11-23');
  await expect(page.locator('dialog[open]').getByLabel('Nights', { exact: true })).toHaveCount(0);
  await expect(page.locator('dialog[open]').getByLabel('Location link')).toHaveValue(
    'https://maps.example.com/pine-house'
  );
  await page
    .locator('dialog[open]')
    .getByLabel('Location link')
    .fill('https://maps.example.com/cabin');
  await page.locator('dialog[open]').getByRole('button', { name: 'Save trip' }).click();
  await expect(page.getByRole('link', { name: 'The Pine House · Šumava' })).toHaveAttribute(
    'href',
    'https://maps.example.com/cabin'
  );
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'People', exact: true }).first().click();
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  dialog = page.locator('dialog[open]');
  const tooLongInvite = await page.request.post(`${tripPath}?/member`, {
    form: { name: 'a'.repeat(21) }
  });
  expect(tooLongInvite.status()).toBe(400);
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveAttribute('maxlength', '20');
  await dialog.getByLabel('Name', { exact: true }).fill(guest);
  await dialog.getByRole('button', { name: 'Invite to trip' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expenses', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  const ownerMember = await dialog.locator('select[name=payer]').inputValue();
  await expect(dialog.locator('.selected-people')).toContainText('Everyone');
  await dialog.getByLabel('Name', { exact: true }).fill('House rent');
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('240');
  await dialog.getByLabel('Amount per night', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.locator('.expense-row')).toHaveCount(1);
  await expect(page.locator('.stats')).toContainText('720,00');
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Name', { exact: true }).fill('Groceries');
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('40');
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.locator('.expense-row')).toHaveCount(2);
  // Edit retains the expense identity and recalculates the ledger.
  await page.getByRole('button', { name: /Groceries.*40,00/ }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('60');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.stats')).toContainText('780,00');
  const guestContext = await browser.newContext();
  const gp = await guestContext.newPage();
  await login(gp, guest);
  await gp.getByRole('link', { name: new RegExp('Mountain weekend') }).click();
  await expect(gp).toHaveURL(tripUrl);
  await expect(gp.getByRole('button', { name: 'Add expense', exact: true })).toBeVisible();
  await expect(
    gp.locator('.expense-row').filter({ hasText: 'Groceries' }).locator('.expense-total')
  ).toHaveText(/^60,00/);
  await expect(
    gp.locator('.expense-row').filter({ hasText: 'Groceries' }).locator('.expense-total')
  ).not.toHaveClass(/positive|negative/);
  await gp.locator('.expense-row').filter({ hasText: 'Groceries' }).click();
  dialog = gp.locator('dialog[open]');
  await dialog.getByLabel('Participation').selectOption('exclude');
  await dialog.getByRole('button', { name: 'Update share' }).click();
  await expect(dialog.locator('.split-person').filter({ hasText: guest })).toContainText('0,00');
  await expect(gp.locator('.toast')).toHaveJSProperty('popover', 'manual');
  await expect
    .poll(() => gp.locator('.toast').evaluate((el) => el.matches(':popover-open')))
    .toBe(true);
  await close(gp);
  await gp.reload();
  await expect(gp.locator('html[data-hydrated=true]')).toHaveCount(1);
  await expect(gp.getByRole('heading', { name: 'Mountain weekend' })).toBeVisible();
  // Members can manage expenses, but the payer must belong to this trip.
  const forged = await guestContext.request.post(`${tripPath}?/expense`, {
    form: { title: 'forged', amount: '99', payer: 'x', kind: 'other', date: '2026-11-20' },
    headers: {
      origin: 'http://127.0.0.1:5180',
      'x-sveltekit-action': 'true',
      accept: 'application/json'
    }
  });
  expect(forged.status()).toBe(400);
  const outsider = await browser.newContext();
  const outsiderPage = await outsider.newPage();
  await login(outsiderPage, 'outsider');
  const denied = await outsider.request.get(tripPath);
  expect(denied.status()).toBe(200);
  expect(await denied.text()).toContain('Join trip');
  await outsider.close();
  await page.reload();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByRole('button', { name: /Groceries.*60,00/ }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.locator('.split-person').filter({ hasText: guest })).toContainText('0,00');
  // A forged member ID cannot change another person's participation.
  const expenseId = await dialog.locator('input[name=expense]').inputValue();
  const forgedChoice = await guestContext.request.post(`${tripPath}?/choice`, {
    form: { expense: expenseId, member: ownerMember, mode: 'exclude' },
    headers: {
      origin: 'http://127.0.0.1:5180',
      'x-sveltekit-action': 'true',
      accept: 'application/json'
    }
  });
  expect(forgedChoice.status()).toBe(200);
  await close(page);
  await page.reload();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByRole('button', { name: /Groceries.*60,00/ }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.locator('.split-person').filter({ hasText: owner })).toContainText('60,00');
  await expect(dialog.locator('.split-person').filter({ hasText: guest })).toContainText('0,00');
  await close(page);
  // Extra is the volunteer's original share plus exactly the chosen extra.
  await gp.locator('.expense-row').filter({ hasText: 'Groceries' }).click();
  let volunteer = gp.locator('dialog[open]');
  await volunteer.getByLabel('Participation').selectOption('extra');
  await volunteer.getByLabel('Extra · CZK').fill('10');
  await volunteer.getByRole('button', { name: 'Update share' }).click();
  await expect(volunteer.locator('.split-person').filter({ hasText: guest })).toContainText(
    '40,00'
  );
  await expect(volunteer.locator('.split-person').filter({ hasText: owner })).toContainText(
    '20,00'
  );
  await volunteer.getByLabel('Participation').selectOption('exclude');
  await volunteer.getByRole('button', { name: 'Update share' }).click();
  await close(gp);
  // Groups have their own default payers.
  await page.getByRole('button', { name: 'Tags' }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('New tag').fill('Drivers');
  await dialog.getByRole('checkbox', { name: guest, exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Create tag' }).click();
  await expect(dialog.getByRole('button', { name: /Drivers/ })).toBeVisible();
  await dialog.getByLabel('New tag').fill('Everyone else');
  await dialog.getByRole('checkbox', { name: guest, exact: true }).check();
  await dialog.getByRole('button', { name: 'Create tag' }).click();
  await expect(dialog.getByRole('button', { name: /Everyone else/ })).toBeVisible();
  await close(page);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Extra', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Fuel and benefit credits');
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('30');
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  const groups = dialog.locator('.people-options.open');
  await groups.getByRole('checkbox', { name: 'Drivers', exact: true }).check();
  await groups.getByRole('checkbox', { name: 'Everyone else', exact: true }).check();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await expect(dialog.locator('.selected-people .tag-pill')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.locator('.expense-row')).toHaveCount(3);
  await page.getByRole('button', { name: /Fuel and benefit credits/ }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.locator('.split-person').filter({ hasText: guest })).toContainText('15,00');
  await dialog.getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.locator('.selected-people .tag-pill')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await dialog
    .locator('.people-options.open')
    .getByRole('checkbox', { name: 'Everyone else', exact: true })
    .uncheck();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: /Fuel and benefit credits/ }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.locator('.split-person').filter({ hasText: guest })).toContainText('0,00');
  await close(page);
  // Manual receipt import exercises authenticated file storage and atomic review/import.
  await page.getByRole('button', { name: 'Receipts', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add receipt', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
      'base64'
    )
  });
  await expect(dialog.getByText('Enter items manually', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review receipt' })).toBeVisible();
  await dialog.getByLabel('Item name', { exact: true }).fill('Coffee');
  await dialog.getByLabel('Item amount', { exact: true }).fill('8.50');
  await dialog.getByRole('button', { name: 'Add item', exact: true }).click();
  await dialog.getByLabel('Item name', { exact: true }).nth(1).fill('Bread');
  await dialog.getByLabel('Item amount', { exact: true }).nth(1).fill('3.50');
  await dialog.getByRole('button', { name: 'Add 2 items' }).click();
  await expect(page.locator('.receipt-card')).toContainText('12,00');
  const receiptHref = await page.getByRole('link', { name: 'Original' }).getAttribute('href');
  const receipt = await page.request.get(receiptHref!);
  expect(receipt.status()).toBe(200);
  expect(receipt.headers()['content-type']).toBe('image/png');
  await page.getByRole('button', { name: 'Expenses', exact: false }).first().click();
  await expect(page.locator('.expense-row')).toHaveCount(5);
  await expect(page.locator('.stats')).toContainText('You receive');
  await expect(page.locator('.stats .positive')).toHaveText(/\+366,00/);
  await expect(
    page.locator('.expense-row').filter({ hasText: 'House rent' }).locator('.expense-total')
  ).toHaveText(/^720,00/);
  await expect(page.locator('.stats')).not.toContainText('Average');
  await expect(page.locator('.stats')).not.toContainText('Your share');
  await expect(page.locator('.right-rail')).toHaveCount(0);
  await expect(page.locator('.field-note,.optional,.nav-count,.balance-legend')).toHaveCount(0);
  const wrongSizes = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter(
        (el) =>
          el.getBoundingClientRect().height > 0 &&
          [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      )
      .map((el) => getComputedStyle(el).fontSize)
      .filter((size) => size !== '16px')
  );
  expect(wrongSizes).toEqual([]);
  const contrastFailures = await page.evaluate(() => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = (values: number[]) =>
      values
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(
        (el) =>
          el.getBoundingClientRect().height > 0 &&
          [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) &&
          !el.closest('button:disabled')
      )
      .flatMap((el) => {
        const color = rgb(getComputedStyle(el).color);
        let parent: HTMLElement | null = el,
          background = [255, 255, 255];
        while (parent) {
          const c = rgb(getComputedStyle(parent).backgroundColor);
          if (c.length >= 3 && (c.length === 3 || c[3] === 1)) {
            background = c;
            break;
          }
          parent = parent.parentElement;
        }
        const a = luminance(color),
          b = luminance(background),
          ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        return ratio < 4.5 ? [{ text: el.textContent?.trim().slice(0, 50), ratio }] : [];
      });
  });
  expect(contrastFailures).toEqual([]);
  const backgrounds = await page
    .locator('.trip-meta-row .name-bubble')
    .evaluateAll((elements) => elements.map((el) => getComputedStyle(el).backgroundColor));
  expect(new Set(backgrounds).size).toBe(2);

  await page.screenshot({ path: 'test-results/trip-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/trip-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.getByRole('button', { name: 'Settle up', exact: true }).last().click();
  await page.getByRole('button', { name: 'Payment', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByRole('combobox', { name: 'From', exact: true }).selectOption({ label: guest });
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('500');
  await dialog.getByRole('button', { name: 'Confirm received' }).click();
  await expect(page.locator('.payment-row')).toContainText('500,00');
  await expect(page.locator('.transfer-row .negative')).toHaveText(/−134,00/);
  await expect(page.locator('.payment-row > .positive')).toHaveText(/\+500,00/);
  await page.getByRole('button', { name: 'People', exact: true }).last().click();
  const card = page
    .locator('.person-card')
    .filter({ has: page.locator('.name-bubble', { hasText: owner }) });
  await expect(card.locator('.person-net.negative')).toHaveText(/−134,00/);
  await expect(
    card
      .locator('.person-details > span')
      .filter({ hasText: /^Share/ })
      .locator('strong.negative')
  ).toHaveText(/−456,00/);
  await expect(
    card
      .locator('.person-details > span')
      .filter({ hasText: 'Purchases paid' })
      .locator('strong.positive')
  ).toHaveText(/\+822,00/);
  await expect(
    card
      .locator('.person-details > span')
      .filter({ hasText: 'Received' })
      .locator('strong.negative')
  ).toHaveText(/−500,00/);
  await page.screenshot({ path: 'test-results/people-signed-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Settle up', exact: true }).last().click();

  // The sender, including the trip owner, cannot approve outgoing money.
  const guestMember = await page.locator('.payment-row').count();
  expect(guestMember).toBe(1);
  await expect(page.getByRole('button', { name: 'Confirm received', exact: true })).toHaveCount(0);
  await gp.reload();
  await expect(gp.locator('html[data-hydrated=true]')).toHaveCount(1);
  await gp.getByRole('button', { name: 'Settle up', exact: true }).last().click();
  await gp.getByRole('button', { name: 'Confirm received', exact: true }).click();
  let receiverDialog = gp.locator('dialog[open]');
  const receiverMember = await receiverDialog.locator('input[name=to]').inputValue();
  const forgedOutgoing = await page.request.post(`${tripPath}?/payment`, {
    form: { from: ownerMember, to: receiverMember, amount: '134', date: '2026-11-20' },
    headers: {
      origin: 'http://127.0.0.1:5180',
      'x-sveltekit-action': 'true',
      accept: 'application/json'
    }
  });
  expect(forgedOutgoing.status()).toBe(403);
  const forgedSender = await guestContext.request.post(`${tripPath}?/payment`, {
    form: { from: receiverMember, to: ownerMember, amount: '1', date: '2026-11-20' },
    headers: {
      origin: 'http://127.0.0.1:5180',
      'x-sveltekit-action': 'true',
      accept: 'application/json'
    }
  });
  expect(forgedSender.status()).toBe(403);
  await receiverDialog.getByRole('button', { name: 'Confirm received', exact: true }).click();
  await expect(gp.locator('.success-state')).toContainText('All square.');
  await gp.getByRole('button', { name: 'Undo payment', exact: true }).click();
  const confirmedIncoming = await gp.locator('dialog[open] input[name=id]').inputValue();
  await gp.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
  const forgedUndo = await page.request.post(`${tripPath}?/undoPayment`, {
    form: { id: confirmedIncoming },
    headers: {
      origin: 'http://127.0.0.1:5180',
      'x-sveltekit-action': 'true',
      accept: 'application/json'
    }
  });
  expect(forgedUndo.status()).toBe(403);
  await gp.getByRole('button', { name: 'Undo payment', exact: true }).click();
  await expect(gp.locator('.payment-row')).toHaveCount(2);
  await gp
    .locator('dialog[open]')
    .getByRole('button', { name: 'Undo payment', exact: true })
    .click();
  await expect(gp.locator('.transfer-row')).toContainText('134,00');
  await page.reload();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settle up', exact: true }).last().click();
  await page.getByRole('button', { name: 'Undo payment', exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.payment-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo payment', exact: true }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: 'Undo payment', exact: true })
    .click();
  await expect(page.locator('.payment-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm received' }).first().click();
  dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Confirm received' }).click();
  await expect(page.locator('.success-state')).toContainText('All square.');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: 'test-results/settlements-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
  await guestContext.close();
});

test('all trip members can manage settings, invitations, expenses and tags', async ({
  page,
  browser
}) => {
  await login(page, 'Shared owner');
  await createFixtureTrip(page);
  const tripPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  let dialog = page.locator('dialog[open]');
  const ownerId = await dialog.locator('select[name=payer]').inputValue();
  await dialog.getByLabel('Name', { exact: true }).fill('Owner purchase');
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const memberContext = await browser.newContext();
  try {
    const member = await memberContext.newPage();
    await login(member, 'Shared member');
    // Signing in alone does not grant access to a private trip.
    for (const action of ['member', 'expense', 'deleteExpense', 'tag', 'deleteTag', 'settings'])
      expect(
        (
          await memberContext.request.post(`${tripPath}?/${action}`, { form: { id: 'other-trip' } })
        ).status()
      ).toBe(403);
    expect(
      (await page.request.post(`${tripPath}?/member`, { form: { name: 'Shared member' } })).status()
    ).toBe(200);
    await member.goto(tripPath);
    await expect(member.locator('html[data-hydrated=true]')).toHaveCount(1);
    await member.getByRole('button', { name: 'Trip settings', exact: true }).click();
    dialog = member.locator('dialog[open]');
    await dialog.getByLabel('Trip name', { exact: true }).fill('Shared permissions trip');
    await dialog.getByLabel('House / place', { exact: true }).fill('Shared cabin');
    await dialog
      .getByLabel('Location link', { exact: true })
      .fill('https://maps.example.com/shared');
    await dialog.getByLabel('Arrival', { exact: true }).fill('2026-11-21');
    await dialog.getByLabel('Departure', { exact: true }).fill('2026-11-24');
    await dialog.getByRole('button', { name: 'Save trip', exact: true }).click();
    await expect(
      member.getByRole('heading', { name: 'Shared permissions trip', exact: true })
    ).toBeVisible();
    await expect(member.getByRole('link', { name: 'Shared cabin' })).toHaveAttribute(
      'href',
      'https://maps.example.com/shared'
    );
    await member.getByRole('button', { name: 'People', exact: true }).first().click();
    await member.getByRole('button', { name: 'Invite', exact: true }).click();
    dialog = member.locator('dialog[open]');
    await dialog.getByLabel('Name', { exact: true }).fill('Shared invite');
    await dialog.getByRole('button', { name: 'Invite to trip', exact: true }).click();
    await expect(member.locator('.person-card').filter({ hasText: 'Shared invite' })).toBeVisible();
    await member.getByRole('button', { name: 'Expenses', exact: true }).first().click();
    await member.getByRole('button', { name: 'Add expense', exact: true }).click();
    dialog = member.locator('dialog[open]');
    expect(await dialog.locator('select[name=payer]').inputValue()).not.toBe(ownerId);
    await dialog.getByLabel('Name', { exact: true }).fill('Member purchase');
    await dialog.getByLabel('Amount · CZK', { exact: true }).fill('23.50');
    await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
    await expect(
      member.locator('.expense-row').filter({ hasText: 'Member purchase' })
    ).toBeVisible();
    await member.locator('.expense-row').filter({ hasText: 'Owner purchase' }).click();
    await member
      .locator('dialog[open]')
      .getByRole('button', { name: 'Edit expense', exact: true })
      .click();
    dialog = member.locator('dialog[open]');
    await dialog.getByLabel('Name', { exact: true }).fill('Reviewed purchase');
    await dialog.getByLabel('Amount · CZK', { exact: true }).fill('12.34');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(
      member
        .locator('.expense-row')
        .filter({ hasText: 'Reviewed purchase' })
        .locator('.expense-total')
    ).toHaveText(/^12,34/);
    await member.getByRole('button', { name: 'Tags', exact: true }).click();
    dialog = member.locator('dialog[open]');
    await dialog.getByLabel('New tag', { exact: true }).fill('Shared group');
    await dialog.getByRole('button', { name: 'Create tag', exact: true }).click();
    await dialog.locator('.tag-list button').filter({ hasText: 'Shared group' }).click();
    await dialog.getByLabel('Edit tag', { exact: true }).fill('Updated shared group');
    await dialog.getByRole('checkbox', { name: 'Shared invite', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Save tag', exact: true }).click();
    const tag = dialog.locator('.tag-list button').filter({ hasText: 'Updated shared group' });
    await expect(tag).not.toContainText('Shared invite');
    await tag.click();
    await dialog.getByRole('button', { name: 'Remove tag', exact: true }).click();
    await expect(dialog.locator('.tag-list')).not.toContainText('Updated shared group');
    await close(member);
    for (const name of ['Member purchase', 'Reviewed purchase']) {
      const row = member.locator('.expense-row').filter({ hasText: name });
      await row.click();
      await member
        .locator('dialog[open]')
        .getByRole('button', { name: 'Delete', exact: true })
        .click();
      await expect(row).toHaveCount(0);
    }
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Shared permissions trip', exact: true })
    ).toBeVisible();
    await expect(page.locator('.trip-meta-row')).toContainText('Shared invite');
    await expect(page.locator('.expense-row').filter({ hasText: 'Reviewed purchase' })).toHaveCount(
      0
    );
  } finally {
    await memberContext.close();
  }
});

test('expense buyers, personal participation and clean home', async ({ page }) => {
  await login(page, 'taylor');
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Sample trip', exact: true })).toHaveCount(0);
  expect((await page.request.post('/?/demo')).status()).toBe(404);
  await createFixtureTrip(page, { purchase: true });
  const groceries = page.locator('.expense-row').filter({ hasText: 'Shared purchase' });
  await expect(groceries.locator('.paid-by')).toContainText('Jamie');
  await groceries.click();
  let dialog = page.locator('dialog[open]');
  await expect(dialog.locator('.detail-total')).toContainText('Jamie');
  await expect(dialog.getByRole('heading', { name: 'Shares', exact: true })).toBeVisible();
  await expect(dialog.getByText('Adjust share for', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('select[name=member]')).toHaveCount(0);
  await dialog.getByLabel('Participation').selectOption('exclude');
  await dialog.getByRole('button', { name: 'Update share' }).click();
  await expect(dialog.locator('.detail-total')).toContainText('Jamie');
  await expect(dialog.locator('.split-person').first()).toContainText('0,00');
  await page.screenshot({ path: 'test-results/expense-detail.png', fullPage: true });
  await close(page);
  await page.getByRole('button', { name: 'People', exact: true }).first().click();
  await expect(page.locator('.people-grid')).not.toContainText(/sample-\d-[a-f0-9]+/);
});
