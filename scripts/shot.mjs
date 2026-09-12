import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const exe =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

mkdirSync('output/playwright', { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'output/playwright/orbloom-1.png', fullPage: false });

// Drag planet a bit
const canvas = page.locator('canvas.game-canvas');
const box = await canvas.boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 20, { steps: 12 });
  await page.mouse.up();
}
await page.waitForTimeout(800);
await page.screenshot({ path: 'output/playwright/orbloom-2-drag.png' });

// Click to plant near center
await page.mouse.click(box ? box.x + box.width * 0.55 : 720, box ? box.y + box.height * 0.45 : 400);
await page.waitForTimeout(500);
await page.screenshot({ path: 'output/playwright/orbloom-3-plant.png' });

// Speed up and wait
const btn = page.getByRole('button', { name: '4×' });
if (await btn.count()) await btn.click();
await page.waitForTimeout(2000);
await page.screenshot({ path: 'output/playwright/orbloom-4-speed.png' });

const title = await page.title();
const hud = await page.locator('.title').textContent().catch(() => null);
const stardust = await page.locator('.res-val').textContent().catch(() => null);
console.log(JSON.stringify({ title, hud, stardust }));

await browser.close();
