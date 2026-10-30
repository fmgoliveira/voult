import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = 8791;
const SERVER = `http://127.0.0.1:${PORT}`;
const EXT = path.resolve(here, '../.output/chrome-mv3');
const SERVER_ENTRY = path.resolve(here, '../../server/dist/main.js');

const EMAIL = 'e2e@example.com';
const PASSWORD = 'correct horse battery staple';

let server: ChildProcess;
let tmp: string;
const contexts: BrowserContext[] = [];

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'voult-e2e-'));
  server = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(tmp, 'e2e.db'),
      JWT_SECRET: 'e'.repeat(40),
    },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${SERVER}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  server?.kill();
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* Windows may still hold the profile briefly; the OS temp cleaner will get it */
  }
});

/** A separate browser profile with the extension loaded. */
async function profile(name: string) {
  const ctx = await chromium.launchPersistentContext(path.join(tmp, name), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  contexts.push(ctx);
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  return { ctx, page, id };
}

async function addLogin(page: Page, title: string, username: string, password: string) {
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('menuitem', { name: 'Login' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('detail-title')).toHaveText(title);
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
  await addLogin(a.page, 'GitHub', 'octocat', 'S3cret-pass!');
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
  await addLogin(b.page, 'Example', 'bob', 'pw-from-b-123');
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
