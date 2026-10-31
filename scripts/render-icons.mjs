// Renders apps/mobile/assets/branding/*.svg to the PNGs app.json points at (uses Playwright's
// Chromium, which is already installed for the extension e2e tests).
//   node scripts/render-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('../apps/mobile/assets/branding/', import.meta.url);
const jobs = [
  ['icon', 1024],
  ['foreground', 1024],
  ['monochrome', 1024],
  ['splash', 1024],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [name, size] of jobs) {
  const svg = readFileSync(new URL(`${name}.svg`, dir), 'utf8');
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  writeFileSync(new URL(`${name}.png`, dir), await page.screenshot({ omitBackground: true }));
  console.log('wrote', `${name}.png`);
}
await browser.close();
