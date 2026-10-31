import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { addLogin, createAccount, Env } from './helpers';

/**
 * Not a test: renders the popup in each state to `shots/` so the design can be reviewed.
 * Run with `SHOTS=1 pnpm e2e -- shots`.
 */
test.skip(!process.env.SHOTS, 'screenshot run only');

const env = new Env(8795);
test.beforeAll(() => env.start());
test.afterAll(() => env.stop());

test('capture screens', async () => {
  test.setTimeout(120_000);
  mkdirSync('shots', { recursive: true });
  const { popup, ctx } = await env.profile('shots');
  const shot = async (name: string) => {
    await popup.waitForTimeout(450);
    await popup.locator('.popup-frame').screenshot({ path: `shots/${name}.png` });
  };

  await shot('01-welcome');
  await popup.getByText('I already have an account').click();
  await shot('02-signin');
  await popup.getByText('Create a new account').click();

  await createAccount(popup, env.serverUrl);
  await shot('03-empty');

  await addLogin(popup, {
    title: 'GitHub',
    username: 'octocat',
    password: 'S3cret-pass!',
    url: 'https://github.com',
    totp: 'JBSWY3DPEHPK3PXP',
  });
  await shot('04-detail');
  await popup.getByRole('button', { name: 'Back' }).click();
  await addLogin(popup, { title: 'Netflix', username: 'me@mail.com', password: 'x' });
  await popup.getByRole('button', { name: 'Back' }).click();
  await addLogin(popup, { title: 'Bank of Oslo', username: 'f.oliveira', password: 'x' });
  await popup.getByRole('button', { name: 'Back' }).click();
  await addLogin(popup, { title: 'Spotify', username: 'f.oliveira', password: 'x' });
  await popup.getByRole('button', { name: 'Back' }).click();
  await addLogin(popup, { title: 'Cloudflare', username: 'f@example.com', password: 'x' });
  await popup.getByRole('button', { name: 'Back' }).click();
  await expect(popup.getByTestId('item-row')).toHaveCount(5);
  await shot('05-list');

  await popup.getByRole('button', { name: 'Add item' }).click();
  await shot('06-add-menu');
  await popup.keyboard.press('Escape');
  await popup.getByRole('menuitem', { name: 'Login' }).click();
  await shot('07-editor');
  await popup.getByRole('button', { name: 'Cancel' }).click();

  const nav = popup.getByRole('navigation', { name: 'Main' });
  await nav.getByText('Codes').click();
  await shot('08-codes');
  await nav.getByText('Generate').click();
  await shot('09-generator');
  await nav.getByText('Settings').click();
  await shot('10-settings');

  await popup.getByLabel('Theme').click();
  await popup.getByRole('option', { name: 'Dark' }).click();
  await nav.getByText('Vault').click();
  await shot('11-list-dark');
  await nav.getByText('Codes').click();
  await shot('12-codes-dark');

  await popup.getByRole('button', { name: 'Lock vault' }).click();
  await shot('13-locked-dark');

  // In-page autofill UI (against the fixture login page)
  const page = await ctx.newPage();
  await page.setContent(
    '<h1 style="font-family:sans-serif">Example login</h1><input type="email" placeholder="Email" style="width:260px;height:32px"><br><input type="password" placeholder="Password" style="width:260px;height:32px;margin-top:8px">',
  );
  expect(page).toBeTruthy();
});
