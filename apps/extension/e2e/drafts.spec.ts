import { expect, test } from '@playwright/test';
import { Env, EMAIL, PASSWORD, createAccount } from './helpers';

const env = new Env(8798);

test.beforeAll(() => env.start());
test.afterAll(() => env.stop());

test('closing the popup keeps half-typed forms and the current screen', async () => {
  test.setTimeout(90_000);
  const { popup: page, ctx, id } = await env.profile('drafts');
  const reopen = async () => {
    await page.close();
    const next = await ctx.newPage();
    await next.goto(`chrome-extension://${id}/popup.html`);
    return next;
  };

  // Sign-up form: switch app to copy a password, come back, nothing is lost.
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Master password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm master password').fill(PASSWORD);
  await page.waitForTimeout(300);
  let p = await reopen();
  await expect(p.getByLabel('Email')).toHaveValue(EMAIL);
  await expect(p.getByLabel('Master password', { exact: true })).toHaveValue(PASSWORD);
  await expect(p.getByLabel('Confirm master password')).toHaveValue(PASSWORD);

  await p.getByLabel('Email').fill('');
  await createAccount(p, env.serverUrl);

  // New-login editor: typed fields survive, Cancel discards them.
  await p.getByRole('button', { name: 'Add item' }).click();
  await p.getByRole('menuitem', { name: 'Login' }).click();
  await p.getByLabel('Title').fill('Half typed');
  await p.getByLabel('Email or username').fill('me@example.com');
  await p.waitForTimeout(300);
  await p.close();
  p = await ctx.newPage();
  await p.goto(`chrome-extension://${id}/popup.html`);
  await expect(p.getByLabel('Title')).toHaveValue('Half typed');
  await expect(p.getByLabel('Email or username')).toHaveValue('me@example.com');

  await p.getByRole('button', { name: 'Cancel' }).click();
  await p.getByRole('button', { name: 'Add item' }).click();
  await p.getByRole('menuitem', { name: 'Login' }).click();
  await expect(p.getByLabel('Title')).toHaveValue('');
});
