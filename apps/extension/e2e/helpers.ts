import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT = path.resolve(here, '../.output/chrome-mv3');
const SERVER_ENTRY = path.resolve(here, '../../server/dist/main.js');

export const EMAIL = 'e2e@example.com';
export const PASSWORD = 'correct horse battery staple';

export class Env {
  tmp = mkdtempSync(path.join(tmpdir(), 'voult-e2e-'));
  server?: ChildProcess;
  contexts: BrowserContext[] = [];
  constructor(readonly port: number) {}
  get serverUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    this.server = spawn(process.execPath, [SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(this.port),
        DB_PATH: path.join(this.tmp, 'e2e.db'),
        JWT_SECRET: 'e'.repeat(40),
      },
      stdio: 'inherit',
    });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${this.serverUrl}/health`)).ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('server did not start');
  }

  async stop() {
    for (const c of this.contexts) await c.close();
    this.server?.kill();
    try {
      rmSync(this.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* Windows may still hold the profile briefly */
    }
  }

  /** A separate browser profile with the extension loaded; returns its popup page. */
  async profile(name: string) {
    const ctx = await chromium.launchPersistentContext(path.join(this.tmp, name), {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    this.contexts.push(ctx);
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    return { ctx, popup, id, sw };
  }
}

export async function createAccount(popup: Page, serverUrl: string) {
  await popup.getByLabel('Email').fill(EMAIL);
  await popup.getByLabel('Master password', { exact: true }).fill(PASSWORD);
  await popup.getByLabel('Confirm master password').fill(PASSWORD);
  await popup.getByText('Server', { exact: true }).click();
  await popup.getByLabel('Server URL').fill(serverUrl);
  await popup.getByRole('button', { name: 'Create account' }).click();
  await expect(popup.getByTestId('recovery-secret')).toBeVisible();
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: 'Continue' }).click();
  await expect(popup.getByText('Your vault is empty')).toBeVisible();
}

export async function addLogin(
  popup: Page,
  f: { title: string; username?: string; password?: string; url?: string; totp?: string },
) {
  await popup.getByRole('button', { name: 'Add item' }).click();
  await popup.getByRole('menuitem', { name: 'Login' }).click();
  await popup.getByLabel('Title').fill(f.title);
  if (f.username) await popup.getByLabel('Username').fill(f.username);
  if (f.password) await popup.getByLabel('Password', { exact: true }).fill(f.password);
  if (f.url) {
    await popup.getByRole('button', { name: 'Add website' }).click();
    await popup.getByLabel('Website 1').fill(f.url);
  }
  if (f.totp) await popup.getByLabel('2FA secret key or otpauth:// link').fill(f.totp);
  await popup.getByRole('button', { name: 'Save' }).click();
  await expect(popup.getByTestId('detail-title')).toHaveText(f.title);
}
