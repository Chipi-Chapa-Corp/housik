import { createFixtureTrip } from './fixtures';
import { test, expect } from '@playwright/test';

test('Share with lists tags above people and preserves combined, person-only and Everyone shares', async ({
  page
}) => {
  await page.goto('/');
  await expect(page.locator('html[data-hydrated=true]')).toHaveCount(1);
  await page.getByLabel('Name', { exact: true }).fill('Shares owner');
  await page.getByLabel('Password', { exact: true }).fill('shares-test-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await createFixtureTrip(page);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Name', { exact: true }).fill('Mixed people and tags');
  await dialog.getByLabel('Amount · CZK', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  const options = dialog.locator('.people-options.open');
  const labels = await options.locator('label').allTextContents();
  expect(labels.findIndex((label) => label.includes('Groceries'))).toBeLessThan(
    labels.findIndex((label) => label.includes('Robin'))
  );
  await page.screenshot({ path: '.test-data/share-options-tags-first.png', fullPage: true });
  await options.getByRole('checkbox', { name: 'Jamie', exact: true }).check();
  await options.getByRole('checkbox', { name: 'Groceries', exact: true }).check();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await expect(dialog.locator('.selected-people .name-bubble')).toHaveText('Jamie');
  await expect(dialog.locator('.selected-people .tag-pill')).toHaveText('Groceries');
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  const row = page.locator('.expense-row').filter({ hasText: 'Mixed people and tags' });
  await row.click();
  for (const person of ['Shares owner', 'Jamie', 'Sam', 'Robin'])
    await expect(
      dialog.locator('.split-person').filter({ hasText: person }).locator('strong')
    ).toHaveText(/^2,50/);
  await dialog.getByRole('button', { name: 'Edit expense', exact: true }).click();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await expect(options.getByRole('checkbox', { name: 'Jamie', exact: true })).toBeChecked();
  await expect(options.getByRole('checkbox', { name: 'Groceries', exact: true })).toBeChecked();
  await options.getByRole('checkbox', { name: 'Groceries', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await row.click();
  await expect(
    dialog.locator('.split-person').filter({ hasText: 'Jamie' }).locator('strong')
  ).toHaveText(/^10,00/);
  await expect(
    dialog.locator('.split-person').filter({ hasText: 'Sam' }).locator('strong')
  ).toHaveText(/^0,00/);
  await dialog.getByRole('button', { name: 'Edit expense', exact: true }).click();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await options.getByRole('checkbox', { name: 'Everyone', exact: true }).check();
  await dialog.getByRole('button', { name: 'Share with', exact: true }).click();
  await expect(dialog.locator('.selected-people')).toHaveText('Everyone');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await row.click();
  for (const person of ['Shares owner', 'Jamie', 'Sam', 'Robin'])
    await expect(
      dialog.locator('.split-person').filter({ hasText: person }).locator('strong')
    ).toHaveText(/^2,50/);
});
