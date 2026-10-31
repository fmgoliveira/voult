import { expect, test } from '@playwright/test';
import { addLogin, createAccount, Env, PASSWORD } from './helpers';

const old = new Env(8801);
const fresh = new Env(8802);

test.beforeAll(async () => {
  await old.start();
  await fresh.start();
});
test.afterAll(async () => {
  await old.stop();
  await fresh.stop();
});

test('export an encrypted backup, then restore it on a brand-new server with only the master password', async () => {
  test.setTimeout(120_000);
  const a = await old.profile('a');
  await createAccount(a.popup, old.serverUrl);
  await addLogin(a.popup, { title: 'GitHub', username: 'octocat', password: 'S3cret-pass!' });
  await a.popup.getByRole('navigation', { name: 'Main' }).getByText('Settings').click();

  // Drive is not set up on the e2e server, and it says so rather than failing silently.
  await expect(a.popup.getByText('This server has no Google credentials')).toBeVisible();

  const [download] = await Promise.all([
    a.popup.waitForEvent('download'),
    a.popup.getByRole('button', { name: 'Download encrypted backup file' }).click(),
  ]);
  const file = await download.path();
  expect(download.suggestedFilename()).toMatch(/^voult-.*\.voult$/);
  const text = (await import('node:fs')).readFileSync(file, 'utf8');
  expect(text).not.toContain('S3cret-pass!');
  expect(text).not.toContain('octocat');

  // A new browser profile + a different, empty server: the old one is "gone".
  const b = await fresh.profile('b');
  await b.popup.getByRole('button', { name: 'Restore from a backup file' }).click();
  await b.popup.locator('input[type=file]').setInputFiles(file);
  await expect(b.popup.getByLabel('Email')).toHaveValue('e2e@example.com');
  await b.popup.getByLabel('Server URL').fill(fresh.serverUrl);

  await b.popup.getByLabel('Master password').fill('not the password');
  await b.popup.getByRole('button', { name: 'Check backup' }).click();
  await expect(b.popup.getByText('Wrong master password')).toBeVisible();

  await b.popup.getByLabel('Master password').fill(PASSWORD);
  await b.popup.getByRole('button', { name: 'Check backup' }).click();
  await expect(b.popup.getByRole('status')).toContainText('1 items (0 with 2FA, 0 passkeys)');
  await b.popup.getByRole('button', { name: 'Restore to this server' }).click();

  await expect(b.popup.getByText('GitHub')).toBeVisible({ timeout: 30_000 });
  await b.popup.getByText('GitHub').click();
  await expect(b.popup.getByTestId('detail-title')).toHaveText('GitHub');

  // The restored data reached the new server: a third profile signs in normally.
  const c = await fresh.profile('c');
  await c.popup.getByRole('button', { name: 'I already have an account' }).click();
  await c.popup.getByLabel('Email').fill('e2e@example.com');
  await c.popup.getByLabel('Master password').fill(PASSWORD);
  await c.popup.getByText('Server', { exact: true }).click();
  await c.popup.getByLabel('Server URL').fill(fresh.serverUrl);
  await c.popup.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(c.popup.getByText('GitHub')).toBeVisible({ timeout: 30_000 });
});
