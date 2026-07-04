import { chromium } from 'playwright';

const results = [];
const errors = [];

function assert(name, condition, extra = '') {
  results.push({ name, pass: !!condition, extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    errors.push(`[console.error] ${msg.text()}`);
  }
});
page.on('pageerror', (err) => {
  errors.push(`[pageerror] ${err.message}`);
});

try {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.getByPlaceholder('ZIP code').fill('23219');
  await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: 'Find my elections' }).click();

  let mapCardAppeared = true;
  try {
    await page.waitForSelector('.map-card', { timeout: 30000 });
  } catch {
    mapCardAppeared = false;
  }

  // Give map tiles / pins time to load
  await page.waitForTimeout(8000);

  const mapCardCount = await page.locator('.map-card').count();
  assert('.map-card exists', mapCardAppeared && mapCardCount > 0, `count=${mapCardCount}`);

  const canvasCount = await page.locator('.map-container canvas').count();
  assert('.map-container canvas exists', canvasCount > 0, `count=${canvasCount}`);

  const legendCount = await page.locator('.map-legend').count();
  let legendText = '';
  if (legendCount > 0) {
    legendText = (await page.locator('.map-legend').first().innerText()).replace(/\s+/g, ' ').trim();
  }
  assert('.map-legend exists', legendCount > 0, `count=${legendCount}`);
  console.log(`LEGEND TEXT: ${legendText || '(none)'}`);

  await page.screenshot({ path: 'map-check.png', fullPage: true });
  console.log('Screenshot saved to map-check.png');
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
  try {
    await page.screenshot({ path: 'map-check.png', fullPage: true });
    console.log('Screenshot saved to map-check.png (after error)');
  } catch {}
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`);
process.exit(failed.length === 0 ? 0 : 1);
