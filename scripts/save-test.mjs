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

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

const url = 'http://127.0.0.1:5174';

// --- First visit: no save, starts immediately ---
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

const stardust1 = await page.locator('.res-val').textContent();
const plants1 = await page.locator('.counts b').first().textContent();
console.log('first visit', { stardust1, plants1 });

// Plant a tree near center
const canvas = page.locator('canvas.game-canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.42);
await page.waitForTimeout(400);
const stardust2 = await page.locator('.res-val').textContent();
const plants2 = await page.locator('.counts b').first().textContent();
console.log('after plant', { stardust2, plants2 });

// Manual save
await page.getByRole('button', { name: '存档' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: 'output/playwright/save-1-saved.png' });

// --- Reload: should show boot overlay with continue ---
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const overlay = page.locator('.boot-overlay');
const hasOverlay = await overlay.count();
console.log('overlay after reload', hasOverlay);
await page.screenshot({ path: 'output/playwright/save-2-overlay.png' });

const overlayText = hasOverlay ? await overlay.textContent() : '';
console.log('overlay text snippet', (overlayText || '').slice(0, 120));

// Continue
const continueBtn = page.getByRole('button', { name: '继续值日' });
if (await continueBtn.count()) {
  await continueBtn.click();
} else {
  console.log('NO CONTINUE BUTTON');
}
await page.waitForTimeout(1200);

const stardust3 = await page.locator('.res-val').textContent();
const plants3 = await page.locator('.counts b').first().textContent();
console.log('after continue', { stardust3, plants3 });
await page.screenshot({ path: 'output/playwright/save-3-continued.png' });

const ok =
  Number(plants3) >= Number(plants2) &&
  Math.abs(Number(stardust3) - Number(stardust2)) < 15;
console.log(JSON.stringify({ ok, stardust1, plants1, stardust2, plants2, stardust3, plants3 }));

// New game flow
await page.getByRole('button', { name: '存档' }).click();
await page.waitForTimeout(400);
// page.on dialog - accept confirm
page.on('dialog', (d) => d.accept());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const newBtn = page.getByRole('button', { name: '新星球' });
if (await newBtn.count()) {
  await newBtn.click();
  await page.waitForTimeout(800);
  const plantsNew = await page.locator('.counts b').first().textContent();
  console.log('after new game plants', plantsNew);
}

await browser.close();
process.exit(ok ? 0 : 1);
