import { expect, test } from '@playwright/test';
import { createAccount, EMAIL, Env, PASSWORD } from './helpers';

const env = new Env(8804);
test.beforeAll(() => env.start());
test.afterAll(() => env.stop());

test('generate an SSH key, add a host that uses it, and see both on a second profile', async () => {
  test.setTimeout(120_000);
  const { popup: a } = await env.profile('ssh-a');
  await createAccount(a, env.serverUrl);

  // --- generate a key
  await a.getByRole('button', { name: 'Add item' }).click();
  await a.getByRole('menuitem', { name: 'SSH key' }).click();
  await a.getByRole('button', { name: 'Generate ed25519 key' }).click();
  await expect(a.getByTestId('ssh-key-type')).toHaveText('ED25519');
  const fingerprint = (await a.getByTestId('ssh-key-fingerprint').textContent())!;
  expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  await a.getByLabel('Title').fill('Deploy key');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByTestId('detail-title')).toHaveText('Deploy key');
  await expect(a.getByTestId('field-fingerprint')).toHaveText(fingerprint);
  // The private key is hidden until revealed.
  await expect(a.getByTestId('field-private key')).toHaveText('••••••••••••');
  await a.getByRole('button', { name: 'Back' }).click();

  // --- a host that uses the key (alias is validated)
  await a.getByRole('button', { name: 'Add item' }).click();
  await a.getByRole('menuitem', { name: 'SSH host' }).click();
  await a.getByLabel('Alias (what you type after ssh)').fill('bad alias');
  await expect(a.getByRole('alert')).toContainText('Use only letters');
  await a.getByLabel('Alias (what you type after ssh)').fill('box');
  await a.getByLabel('Host name or address').fill('box.example.com');
  await a.getByLabel('User', { exact: true }).fill('deploy');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByRole('alert')).toHaveText('Choose which key this host uses.');
  await a.getByRole('combobox', { name: 'Key', exact: true }).click();
  await a.getByRole('option', { name: 'Deploy key' }).click();
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByTestId('detail-title')).toHaveText('box');
  await expect(a.getByTestId('field-command')).toHaveText('ssh deploy@box.example.com');
  await expect(a.getByTestId('field-key')).toHaveText('Deploy key');

  // --- a second profile receives both and shows the same fingerprint
  await a.getByRole('navigation', { name: 'Main' }).getByText('Settings').click();
  await expect(a.getByText('Everything synced')).toBeVisible({ timeout: 15_000 });
  const { popup: b } = await env.profile('ssh-b');
  await b.getByText('I already have an account').click();
  await b.getByLabel('Email').fill(EMAIL);
  await b.getByLabel('Master password', { exact: true }).fill(PASSWORD);
  await b.getByText('Server', { exact: true }).click();
  await b.getByLabel('Server URL').fill(env.serverUrl);
  await b.getByRole('button', { name: 'Sign in' }).click();
  await expect(b.getByTestId('item-row')).toHaveCount(2, { timeout: 20_000 });
  await b.getByTestId('item-row').filter({ hasText: 'Deploy key' }).click();
  await expect(b.getByTestId('field-fingerprint')).toHaveText(fingerprint);
});
