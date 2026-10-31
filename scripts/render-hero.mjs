// Renders docs/images/src/hero.html to docs/images/hero.png (1920x1080, 16:9) with Playwright's Chromium.
//   node scripts/render-hero.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const src = new URL('../docs/images/src/hero.html', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(src.href);
await page.waitForLoadState('networkidle');
writeFileSync(new URL('../docs/images/hero.png', import.meta.url), await page.screenshot());
await browser.close();
console.log('wrote', fileURLToPath(new URL('../docs/images/hero.png', import.meta.url)));
