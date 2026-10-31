import { expect, test } from '@playwright/test';
import { Env, EMAIL, PASSWORD } from './helpers';

const env = new Env(8797);

test.beforeAll(() => env.start());
test.afterAll(() => env.stop());

test('PIN: set in settings, unlock by typing six digits, wrong PIN, password fallback', async () => {
  test.setTimeout(90_000);
  const { popup: page } = await env.profile('pin');

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Master password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm master password').fill(PASSWORD);
  await page.getByText('Server', { exact: true }).click();
  await page.getByLabel('Server URL').fill(env.serverUrl);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Your vault is empty')).toBeVisible();

  // Turn the PIN on in Settings and type six digits: it saves by itself.
  await page.getByRole('navigation', { name: 'Main' }).getByText('Settings').click();
  await page.getByRole('switch', { name: 'Quick-unlock PIN' }).click();
  await page.getByLabel('New PIN').pressSequentially('123456');
  await expect(page.getByText('PIN saved')).toBeVisible();

  // Locked: only the PIN is offered, with a button to use the master password instead.
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByText('Enter your 6-digit PIN')).toBeVisible();
  await expect(page.getByLabel('Master password')).toHaveCount(0);

  // A wrong PIN is reported and clears the slots.
  await page.getByLabel('PIN').pressSequentially('000000');
  await expect(page.getByRole('alert')).toHaveText('Wrong PIN. 4 attempts left.');

  // The right PIN unlocks without any button.
  await page.getByLabel('PIN').pressSequentially('123456');
  await expect(page.getByRole('button', { name: 'Lock vault' })).toBeVisible();

  // Unlocking with the master password keeps the PIN for next time.
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await page.getByRole('button', { name: 'Use master password' }).click();
  await expect(page.getByLabel('Master password')).toBeVisible();
  await page.getByLabel('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Lock vault' })).toBeVisible();
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await expect(page.getByText('Enter your 6-digit PIN')).toBeVisible();
});
