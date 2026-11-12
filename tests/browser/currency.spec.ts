import { createFixtureTrip } from './fixtures';
import { test, expect, type Page } from '@playwright/test';

async function close(page: Page) {
  await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
}

test('EUR amounts stay editable in EUR while ledger totals use CZK', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByLabel('Name', { exact: true }).fill('Currency tester');
  await page.getByLabel('Password', { exact: true }).fill('currency-test-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await createFixtureTrip(page, { purchase: true });
  const tripPath = new URL(page.url()).pathname;

  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  let dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Euro stay');
  await dialog.getByRole('button', { name: 'EUR', exact: true }).click();
  await dialog.getByLabel('Amount · EUR', { exact: true }).fill('1.23');
  await dialog.getByLabel('Amount per night', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await dialog
    .locator('.people-options.open')
    .getByRole('checkbox', { name: 'Groceries', exact: true })
    .check();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await expect(dialog.locator('.rent-total')).toContainText('92,25');
  const amountBox = await dialog.getByLabel('Per night · EUR', { exact: true }).boundingBox();
  const payerBox = await dialog
    .getByRole('combobox', { name: 'Paid by', exact: true })
    .boundingBox();
  expect(payerBox!.y).toBeGreaterThan(amountBox!.y + amountBox!.height);
  await page.screenshot({ path: 'test-results/currency-expense-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/currency-expense-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  let row = page.locator('.expense-row').filter({ hasText: 'Euro stay' });
  await expect(row.locator('.expense-total')).toHaveText(/^92,25/);
  await expect(row.locator('.expense-meta .tag-pill')).toHaveText('Groceries');
  await expect(row.locator('.expense-meta')).toContainText('3 nights · 30,75');
  await expect(row.locator('.expense-meta')).toContainText('/ night');
  await row.screenshot({ path: 'test-results/tagged-stay.png' });
  await row.click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Per night · EUR', { exact: true })).toHaveValue('1.23');
  await expect(dialog.getByRole('button', { name: 'EUR', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(dialog.getByLabel('Amount per night', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.locator('.expense-total')).toHaveText(/^92,25/);
  await page.reload();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await row.click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Per night · EUR', { exact: true })).toHaveValue('1.23');
  await dialog.getByLabel('Per night · EUR', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.locator('.expense-total')).toHaveText(/^150,00/);

  // Legacy CZK entries still open with their saved amount.
  await page.locator('.expense-row').filter({ hasText: 'Shared purchase' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Amount · CZK', { exact: true })).toHaveValue('86.40');
  await close(page);

  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Name', { exact: true }).fill('Euro shopping');
  const payer = await dialog.locator('select[name=payer]').inputValue();
  await dialog.getByRole('button', { name: 'EUR', exact: true }).click();
  await dialog.getByLabel('Amount · EUR', { exact: true }).fill('10');
  await expect(dialog.locator('.amount-preview')).toContainText('250,00');
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  row = page.locator('.expense-row').filter({ hasText: 'Euro shopping' });
  await expect(row.locator('.expense-total')).toHaveText(/^250,00/);
  await row.click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Participation').selectOption('extra');
  await dialog.getByRole('button', { name: 'EUR', exact: true }).click();
  await dialog.getByLabel('Extra · EUR', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Update share' }).click();
  await expect(
    dialog.locator('.split-person').filter({ hasText: 'Currency tester' })
  ).toContainText('87,50');
  await close(page);
  await row.click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Extra · EUR', { exact: true })).toHaveValue('1');
  await dialog.getByLabel('Extra · EUR', { exact: true }).fill('1.50');
  await dialog.getByRole('button', { name: 'Update share' }).click();
  await expect(
    dialog.locator('.split-person').filter({ hasText: 'Currency tester' })
  ).toContainText('100,00');
  await close(page);
  await row.click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Amount · EUR', { exact: true })).toHaveValue('10.00');
  await dialog.getByLabel('Amount · EUR', { exact: true }).fill('12');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.locator('.expense-total')).toHaveText(/^300,00/);
  await row.click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Amount · EUR', { exact: true })).toHaveValue('12.00');
  await dialog.getByRole('button', { name: 'CZK', exact: true }).click();
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('300');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await row.click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Amount · CZK', { exact: true })).toHaveValue('300.00');
  await close(page);

  const unsupported = await page.request.post(`${tripPath}?/expense`, {
    form: {
      title: 'Unsupported currency',
      payer,
      kind: 'other',
      date: '2026-11-20',
      amount: '2',
      currency: 'USD'
    }
  });
  expect(unsupported.status()).toBe(400);
  const forgedRate = await page.request.post(`${tripPath}?/expense`, {
    form: {
      title: 'Server rate',
      payer,
      kind: 'other',
      date: '2026-11-20',
      amount: '2',
      currency: 'EUR',
      rate: '1'
    }
  });
  expect(forgedRate.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await expect(
    page.locator('.expense-row').filter({ hasText: 'Server rate' }).locator('.expense-total')
  ).toHaveText(/^50,00/);

  await page.getByRole('button', { name: 'Settle up', exact: true }).last().click();
  await page.getByRole('button', { name: 'Payment', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'EUR', exact: true }).click();
  await dialog.getByLabel('Amount · EUR', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Confirm received', exact: true }).click();
  await expect(page.locator('.payment-row > .positive').filter({ hasText: /^\+25,00/ })).toHaveText(
    /\+25,00/
  );

  await page.getByRole('button', { name: 'Receipts', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add receipt', exact: true }).click();
  dialog = page.locator('dialog[open]');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'euro-receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
      'base64'
    )
  });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  let item = dialog.locator('.receipt-product').first();
  await item.getByLabel('Item name', { exact: true }).fill('Euro item');
  await item.getByLabel('Item amount', { exact: true }).fill('1.25');
  await item.getByRole('button', { name: 'EUR', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add item', exact: true }).click();
  item = dialog.locator('.receipt-product').nth(1);
  await item.getByRole('button', { name: 'CZK', exact: true }).click();
  await item.getByLabel('Item name', { exact: true }).fill('Crown item');
  await item.getByLabel('Item amount', { exact: true }).fill('3.50');
  await expect(dialog.locator('.receipt-summary-total')).toContainText('34,75');
  await page.screenshot({ path: 'test-results/currency-receipt-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: /^Add 2 items for/ }).click();
  await expect(page.locator('.receipt-card')).toContainText('34,75');
  await page.getByRole('button', { name: 'Expenses', exact: true }).last().click();
  await expect(
    page.locator('.expense-row').filter({ hasText: 'Euro item' }).locator('.expense-total')
  ).toHaveText(/^31,25/);
  await expect(
    page.locator('.expense-row').filter({ hasText: 'Crown item' }).locator('.expense-total')
  ).toHaveText(/^3,50/);
  await expect(page.locator('.expense-total')).not.toContainText(['EUR']);
  await page.locator('.expense-row').filter({ hasText: 'Euro item' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Edit expense' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Amount · EUR', { exact: true })).toHaveValue('1.25');
  await dialog.getByLabel('Amount · EUR', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.locator('.expense-row').filter({ hasText: 'Euro item' }).locator('.expense-total')
  ).toHaveText(/^50,00/);
});
