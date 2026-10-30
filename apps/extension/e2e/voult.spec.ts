import { expect, test } from '@playwright/test';
import { addLogin as addLoginUi, Env, EMAIL, PASSWORD } from './helpers';

const env = new Env(8791);
const SERVER = env.serverUrl;

test.beforeAll(() => env.start());
test.afterAll(() => env.stop());

async function profile(name: string) {
  const p = await env.profile(name);
  return { ...p, page: p.popup };
}

test('create → lock → unlock → edit → sync between two browser profiles', async () => {
  test.setTimeout(120_000);

  // --- Profile A: onboarding
  const a = await profile('profile-a');
  await a.page.getByLabel('Email').fill(EMAIL);
  await a.page.getByLabel('Master password', { exact: true }).fill(PASSWORD);
  await a.page.getByLabel('Confirm master password').fill(PASSWORD);
  await a.page.getByText('Server', { exact: true }).click();
  await a.page.getByLabel('Server URL').fill(SERVER);
  await a.page.getByRole('button', { name: 'Create account' }).click();

  // Recovery kit is mandatory before anything can be saved.
  await expect(a.page.getByTestId('recovery-secret')).toHaveText(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  const cont = a.page.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await a.page.getByRole('checkbox').check();
  await cont.click();
  await expect(a.page.getByText('Your vault is empty')).toBeVisible();

  // --- add an item, lock, unlock
  await addLoginUi(a.page, { title: 'GitHub', username: 'octocat', password: 'S3cret-pass!' });
  await expect(a.page.getByTestId('field-username')).toHaveText('octocat');
  await a.page.getByRole('button', { name: 'Back' }).click();
  await expect(a.page.getByTestId('item-row')).toHaveCount(1);

  await a.page.getByRole('button', { name: 'Lock vault' }).click();
  await expect(a.page.getByText('Vault locked')).toBeVisible();
  await a.page.getByLabel('Master password').fill('wrong password here');
  await a.page.getByRole('button', { name: 'Unlock' }).click();
  await expect(a.page.getByRole('alert')).toHaveText('Wrong password.');
  await a.page.getByLabel('Master password').fill(PASSWORD);
  await a.page.getByRole('button', { name: 'Unlock' }).click();
  await expect(a.page.getByTestId('item-row')).toHaveCount(1);

  // --- edit
  await a.page.getByTestId('item-row').click();
  await a.page.getByRole('button', { name: 'Edit' }).click();
  await a.page.getByLabel('Title').fill('GitHub (work)');
  await a.page.getByLabel('Password', { exact: true }).fill('N3w-secret-pass!');
  await a.page.getByRole('button', { name: 'Save' }).click();
  await expect(a.page.getByTestId('detail-title')).toHaveText('GitHub (work)');

  // Wait until the change is on the server.
  await a.page.getByRole('navigation', { name: 'Main' }).getByText('Settings').click();
  await expect(a.page.getByText('Everything synced')).toBeVisible({ timeout: 15_000 });

  // --- Profile B: sign in and receive the item
  const b = await profile('profile-b');
  await b.page.getByText('I already have an account').click();
  await b.page.getByLabel('Email').fill(EMAIL);
  await b.page.getByLabel('Master password', { exact: true }).fill(PASSWORD);
  await b.page.getByText('Server', { exact: true }).click();
  await b.page.getByLabel('Server URL').fill(SERVER);
  await b.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(b.page.getByTestId('item-row')).toHaveCount(1, { timeout: 20_000 });
  await expect(b.page.getByTestId('item-row')).toContainText('GitHub (work)');

  // History from the edit travelled too.
  await b.page.getByTestId('item-row').click();
  await expect(b.page.getByText('Password history (1)')).toBeVisible();

  // --- B adds an item; A receives it (push via WebSocket / alarm / manual sync)
  await b.page.getByRole('button', { name: 'Back' }).click();
  await addLoginUi(b.page, { title: 'Example', username: 'bob', password: 'pw-from-b-123' });
  await a.page.getByRole('navigation', { name: 'Main' }).getByText('Vault').click();
  await expect(a.page.getByTestId('item-row')).toHaveCount(2, { timeout: 30_000 });

  // --- trash on A disappears from B's list
  await b.page.getByRole('button', { name: 'Back' }).click();
  await expect(b.page.getByTestId('item-row')).toHaveCount(2);
  await a.page.getByTestId('item-row').filter({ hasText: 'Example' }).click();
  await a.page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(a.page.getByTestId('item-row')).toHaveCount(1);
  await expect(b.page.getByTestId('item-row')).toHaveCount(1, { timeout: 30_000 });
});
