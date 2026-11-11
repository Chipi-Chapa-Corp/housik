import { test, expect, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
}

async function login(page: Page) {
  await open(page);
  await page.getByLabel('Name', { exact: true }).fill(`validation-${Date.now()}`.slice(-20));
  await page.getByLabel('Password', { exact: true }).fill('validation-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.trips-home')).toBeVisible();
}

test('password errors survive blur and clear while correcting the value', async ({ page }) => {
  await open(page);
  const name = page.locator('input[name=name]');
  const password = page.locator('input[name=password]');
  await expect(page.locator('.field-error')).toHaveCount(0);
  await name.fill('validation');
  await password.pressSequentially('short');
  await name.focus();
  const message = await password.evaluate((field: HTMLInputElement) => field.validationMessage);
  await expect(page.locator('.field-error')).toHaveText(message);
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAccessibleName('Password');
  await expect(password).toHaveAccessibleDescription(message);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(password).toBeFocused();
  await name.focus();
  await expect(page.locator('.field-error')).toBeVisible();
  await page.screenshot({ path: 'test-results/validation-password.png' });
  await password.fill('long-enough-password');
  await expect(page.locator('.field-error')).toHaveCount(0);
  await expect(password).not.toHaveAttribute('aria-invalid');
  await expect(password).not.toHaveAttribute('aria-describedby');
});

test('submit shows all required errors and reset clears them', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.field-error')).toHaveCount(2);
  await expect(page.locator('input[name=name]')).toBeFocused();
  await page.locator('input[name=password]').focus();
  await expect(page.locator('.field-error')).toHaveCount(2);
  await page.locator('form[action="?/login"]').evaluate((form: HTMLFormElement) => form.reset());
  await expect(page.locator('.field-error')).toHaveCount(0);
  await expect(page.locator('[aria-invalid=true]')).toHaveCount(0);
});

test('dynamic dialogs keep URL, date and amount errors visible', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Trip name', { exact: true }).fill(`Validation ${Date.now()}`);
  const location = dialog.locator('input[name=location_url]');
  await location.fill('invalid-url');
  await dialog.getByLabel('Arrival', { exact: true }).fill('2026-11-20');
  const departure = dialog.locator('input[name=departure]');
  await departure.fill('2026-11-19');
  await dialog.getByRole('button', { name: 'Create trip' }).focus();
  await expect(location).toHaveAttribute('aria-invalid', 'true');
  await expect(departure).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.locator('.field-error')).toHaveCount(2);
  await location.fill('https://example.com');
  await departure.fill('2026-11-23');
  await expect(dialog.locator('.field-error')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Create trip' }).click();
  await expect(page).toHaveURL(/\/trip\//);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const amount = dialog.locator('input[name=amount]');
  await amount.fill('12.345');
  await dialog.getByLabel('Name', { exact: true }).focus();
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(amount).toHaveAccessibleName('Amount · CZK');
  await expect(dialog.locator('.field-error')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(dialog.locator('.field-error')).toHaveCount(0);
  await amount.fill('12.34');
  await dialog.getByLabel('Name', { exact: true }).fill('Validation expense');
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.expense-row')).toContainText('Validation expense');
});
