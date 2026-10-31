import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccount, Env } from './helpers';

const env = new Env(8803);
test.beforeAll(() => env.start());
test.afterAll(() => env.stop());

test('import a CSV, check password health, switch to Portuguese', async () => {
  test.setTimeout(90_000);
  const { popup: page } = await env.profile('p9');
  await createAccount(page, env.serverUrl);
  // The popup opens ready to search.
  await expect(page.getByLabel('Search vault')).toBeFocused();

  const dir = mkdtempSync(path.join(tmpdir(), 'voult-import-'));
  const csv = path.join(dir, 'passwords.csv');
  writeFileSync(
    csv,
    [
      'name,url,username,password,note',
      'Forum,https://forum.example.com,bob,123456,',
      'Shop,https://shop.example.com,bob,x7#Qm9$vLp2@Rt8!,',
      'Mail,https://mail.example.com,bob,x7#Qm9$vLp2@Rt8!,',
    ].join('\n'),
  );

  await page.getByRole('navigation', { name: 'Main' }).getByText('Settings').click();
  await page.locator('input[type=file]').setInputFiles(csv);
  await expect(page.getByText('3 items found')).toBeVisible();
  await page.getByRole('button', { name: 'Import 3 items' }).click();
  await expect(page.getByText('Imported 3 items')).toBeVisible();

  await page.getByRole('button', { name: 'Scan my vault' }).click();
  await expect(page.getByText('Health score: 0/100')).toBeVisible();
  await expect(page.getByText('Weak passwords (1)')).toBeVisible();
  await expect(page.getByText('Reused passwords (2)')).toBeVisible();

  // Language: Portuguese relabels the navigation and settings.
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Português' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByText('Cofre')).toBeVisible();
  await expect(page.getByText('Definições').first()).toBeVisible();
});
