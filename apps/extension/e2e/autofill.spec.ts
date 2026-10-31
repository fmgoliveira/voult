import { expect, test, type Page } from '@playwright/test';
import { base32Decode, totp } from '@voult/core';
import type { Server } from 'node:http';
import { addLogin, createAccount, Env, PASSWORD } from './helpers';
import { startFixtureServer } from './fixture-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const SITE_PORT = 8792;
const SITE = `http://localhost:${SITE_PORT}`;
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const env = new Env(8793);
let site: Server;
let popup: Page;
let ctx: Awaited<ReturnType<Env['profile']>>['ctx'];
let sw: Awaited<ReturnType<Env['profile']>>['sw'];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await env.start();
  site = await startFixtureServer(SITE_PORT);
  const p = await env.profile('autofill');
  ({ ctx, popup, sw } = p);
  await createAccount(popup, env.serverUrl);
  await addLogin(popup, {
    title: 'Fixture',
    username: 'alice@fixture.test',
    password: 'Sup3r-secret-pw',
    url: SITE,
    totp: TOTP_SECRET,
  });
});

test.afterAll(async () => {
  site?.close();
  await env.stop();
});

const icon = (p: Page) => p.locator('voult-autofill .icon');
const menu = (p: Page) => p.locator('voult-autofill .menu');
const bar = (p: Page) => p.locator('voult-autofill .bar');

async function open(path: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(SITE + path);
  await expect(page.locator('voult-autofill')).toBeAttached();
  return page;
}

test('inline icon fills the matching login', async () => {
  const page = await open('/login');
  // Focusing an empty login field opens the list by itself.
  await page.locator('input[name=email]').click();
  await expect(menu(page)).toContainText('Fixture');
  await menu(page)
    .getByRole('menuitem', { name: /Fixture/ })
    .click();
  await expect(page.locator('input[name=email]')).toHaveValue('alice@fixture.test');
  await expect(page.locator('input[name=pw]')).toHaveValue('Sup3r-secret-pw');
  await page.close();
});

test('dropdown opens on focus, arrow keys + Enter choose, typing just types', async () => {
  const page = await open('/login');
  const email = page.locator('input[name=email]');

  // Keyboard: the input keeps focus the whole time.
  await email.click();
  await expect(menu(page)).toContainText('Fixture');
  await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem').first()).toHaveClass(/active/);
  await expect(email).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(email).toHaveValue('alice@fixture.test');
  await expect(page.locator('input[name=pw]')).toHaveValue('Sup3r-secret-pw');
  await expect(menu(page)).toHaveCount(0);

  // Typing: the list steps aside and the text goes straight into the field, no extra click.
  await email.fill('');
  await page.locator('input[name=pw]').fill('');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await email.click();
  await expect(menu(page)).toContainText('Fixture');
  await page.keyboard.type('bob');
  await expect(email).toHaveValue('bob');
  await expect(menu(page)).toHaveCount(0);
  await page.close();
});

test('locked vault: the list shows an unlock box; ArrowDown moves into it; then the logins appear', async () => {
  await sw.evaluate(() => chrome.storage.session.remove('accountKey'));
  const page = await open('/login');
  const email = page.locator('input[name=email]');
  await email.click();

  // The unlock box is an extension page in an iframe (the site cannot see what is typed in it).
  await expect.poll(() => page.frames().some((f) => /unlock\.html/.test(f.url()))).toBe(true);
  const unlock = page.frames().find((f) => /unlock\.html/.test(f.url()))!;
  await expect(unlock.getByText('Voult is locked')).toBeVisible();
  await expect(email).toBeFocused(); // the page keeps the keyboard until asked

  await page.keyboard.press('ArrowDown'); // focus moves into the box...
  await page.keyboard.type(PASSWORD); // ...so this lands there, not in the page's field
  await page.keyboard.press('Enter');
  await expect(email).toHaveValue('');
  await expect(menu(page)).toContainText('Fixture');
  await expect(email).toBeFocused();
  await page.close();
});

test('locked vault with a PIN: the unlock box takes the PIN', async () => {
  // Set a PIN from the popup's Settings (the vault is unlocked again after the previous test).
  await popup.reload();
  await popup.getByRole('navigation', { name: 'Main' }).getByText('Settings').click();
  await popup.getByRole('switch', { name: 'Quick-unlock PIN' }).click();
  await popup.getByLabel('New PIN').pressSequentially('123456');
  await expect(popup.getByText('PIN saved')).toBeVisible();
  await sw.evaluate(() => chrome.storage.session.remove('accountKey'));

  const page = await open('/login');
  const email = page.locator('input[name=email]');
  await email.click();
  await expect.poll(() => page.frames().some((f) => /unlock\.html/.test(f.url()))).toBe(true);
  const unlock = page.frames().find((f) => /unlock\.html/.test(f.url()))!;
  await expect(unlock.getByText('Enter your PIN')).toBeVisible();

  await unlock.getByLabel('PIN').pressSequentially('123456');
  await expect(menu(page)).toContainText('Fixture');
  await page.close();
});

test('OTP field on the next page is filled with the current code', async () => {
  const login = await open('/login');
  await login.locator('input[name=email]').click();
  await menu(login)
    .getByRole('menuitem', { name: /Fixture/ })
    .click();
  await expect(login.locator('input[name=pw]')).toHaveValue('Sup3r-secret-pw');

  await login.goto(`${SITE}/otp`); // same tab = next step of the flow
  const secret = base32Decode(TOTP_SECRET);
  await expect(async () => {
    const now = Date.now();
    const accepted = [totp(secret, now), totp(secret, now - 30_000)];
    expect(accepted).toContain(await login.locator('input[name=otp]').inputValue());
  }).toPass({ timeout: 10_000 });
  await login.close();

  // A fresh tab never received a pending code, so nothing is filled.
  const other = await open('/otp');
  await other.waitForTimeout(800);
  await expect(other.locator('input[name=otp]')).toHaveValue('');
  await other.close();
});

test('works inside an iframe and via the keyboard-shortcut path', async () => {
  const page = await open('/frame');
  const frame = page.frameLocator('iframe');
  await frame.locator('input[name=email]').click();
  await frame
    .locator('voult-autofill .menu')
    .getByRole('menuitem', { name: /Fixture/ })
    .click();
  await expect(frame.locator('input[name=pw]')).toHaveValue('Sup3r-secret-pw');
  await page.close();

  // The command handler sends `autofill:trigger` to the active tab; a single match fills directly.
  const direct = await open('/login');
  await direct.bringToFront();
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab!.id!, { type: 'autofill:trigger' });
  });
  await expect(direct.locator('input[name=pw]')).toHaveValue('Sup3r-secret-pw');
  await direct.close();
});

test('multi-step login: username page fills the username only', async () => {
  const page = await open('/multistep');
  await page.locator('input[name=identifier]').click();
  await menu(page)
    .getByRole('menuitem', { name: /Fixture/ })
    .click();
  await expect(page.locator('input[name=identifier]')).toHaveValue('alice@fixture.test');
  await page.close();
});

test('does not offer fills on a different site', async () => {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${SITE_PORT}/login`);
  await expect(page.locator('voult-autofill')).toBeAttached();
  await page.locator('input[name=email]').click();
  await icon(page).click();
  await expect(menu(page)).toContainText('No saved logins');
  await expect(menu(page).getByRole('menuitem')).toHaveCount(0);
  await page.close();
});

test('register form offers a generated password for both fields', async () => {
  const page = await open('/register');
  await page.locator('input[name=pw]').click();
  await icon(page).click();
  await menu(page)
    .getByRole('menuitem', { name: /Generate password/ })
    .click();
  // The fill is asynchronous (background round trip): wait for it instead of reading at once.
  await expect(page.locator('input[name=pw]')).toHaveValue(/^.{20}$/);
  const pw = await page.locator('input[name=pw]').inputValue();
  await expect(page.locator('input[name=pw2]')).toHaveValue(pw);
  await page.close();
});

test('save prompt for a new login and update prompt for a changed password', async () => {
  // New username -> offer to save.
  const a = await open('/login');
  await a.locator('input[name=email]').fill('bob@fixture.test');
  await a.locator('input[name=pw]').fill('Bobs-first-pw');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await expect(bar(a)).toContainText('Save password for localhost?');
  await bar(a).getByRole('button', { name: 'Save' }).click();
  await a.close();

  // Same username, different password -> offer to update.
  const b = await open('/login');
  await b.locator('input[name=email]').fill('alice@fixture.test');
  await b.locator('input[name=pw]').fill('Alices-NEW-pw');
  await b.getByRole('button', { name: 'Sign in' }).click();
  await expect(bar(b)).toContainText('Update password for localhost?');
  await bar(b).getByRole('button', { name: 'Update' }).click();
  await b.close();

  // Same credentials again -> nothing to do.
  const c = await open('/login');
  await c.locator('input[name=email]').fill('alice@fixture.test');
  await c.locator('input[name=pw]').fill('Alices-NEW-pw');
  await c.getByRole('button', { name: 'Sign in' }).click();
  await c.waitForTimeout(1800);
  await expect(bar(c)).toHaveCount(0);
  await c.close();

  // Both landed in the vault, and the old password is in history.
  await popup.reload();
  await expect(popup.getByTestId('item-row')).toHaveCount(2);
  await popup
    .getByTestId('item-row')
    .filter({ hasText: /alice@fixture\.test/ })
    .click();
  await expect(popup.getByText('Password history (1)')).toBeVisible();
  await popup.getByRole('button', { name: 'Back' }).click();
});

test('"Never for this site" suppresses further save prompts', async () => {
  const a = await open('/login');
  await a.locator('input[name=email]').fill('carol@fixture.test');
  await a.locator('input[name=pw]').fill('Carols-pw-1');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await bar(a).getByRole('button', { name: 'Never for this site' }).click();
  await a.close();

  const b = await open('/login');
  await b.locator('input[name=email]').fill('dave@fixture.test');
  await b.locator('input[name=pw]').fill('Daves-pw-1');
  await b.getByRole('button', { name: 'Sign in' }).click();
  await b.waitForTimeout(1800);
  await expect(bar(b)).toHaveCount(0);
  await b.close();
});

test('passkeys: register and sign in, verified by a real WebAuthn relying party', async () => {
  const page = await open('/passkey');

  // The prompt is shown over the page (an iframe), not in a separate window.
  const promptFrame = async () => {
    await expect.poll(() => page.frames().some((f) => /prompt\.html/.test(f.url()))).toBe(true);
    return page.frames().find((f) => /prompt\.html/.test(f.url()))!;
  };

  // Register: choose to save as a new login.
  await page.click('#register');
  let picker = await promptFrame();
  await expect(picker.getByText('Create a passkey')).toBeVisible();
  await picker.getByRole('button', { name: 'Create passkey' }).click();
  await expect(page.locator('#out')).toHaveText('registered');

  // Sign in twice: the sign counter advances and the signature verifies each time.
  for (const counter of [1, 2]) {
    await page.click('#signin');
    picker = await promptFrame();
    await picker.getByTestId('passkey-option').first().click();
    await expect(page.locator('#out')).toHaveText(`signed-in:counter=${counter}`);
  }

  // Escape without choosing is a refusal, not a hang.
  await page.click('#signin');
  picker = await promptFrame();
  await picker.getByTestId('passkey-option').first().waitFor();
  await page.keyboard.press('Escape');
  await expect(page.locator('#out')).toHaveText('error:NotAllowedError');
  await page.close();

  // The passkey is stored on a login item and visible in the vault.
  await popup.reload();
  await popup
    .getByTestId('item-row')
    .filter({ hasText: /alice@fixture(?!\.test)/ })
    .click();
  await expect(popup.getByRole('region', { name: 'Passkeys' })).toContainText('Fixture');

  // ...and can be removed again (with a confirmation step).
  await popup.getByRole('button', { name: /Remove passkey for/ }).click();
  await popup.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(popup.getByRole('region', { name: 'Passkeys' })).toHaveCount(0);
});

test('toolbar badge shows how many logins match the active tab', async () => {
  const page = await open('/login');
  await page.bringToFront();
  const badge = () =>
    sw.evaluate(async (pattern) => {
      const [tab] = await chrome.tabs.query({ url: pattern });
      return chrome.action.getBadgeText({ tabId: tab.id });
    }, `${SITE}/*`);
  // Earlier tests saved extra logins for this site, so only check that the count shows up.
  await expect.poll(badge, { timeout: 10_000 }).toMatch(/^[1-9]\d*$/);
  await page.close();
});
