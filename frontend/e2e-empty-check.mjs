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

  await page.getByPlaceholder('ZIP code').fill('20500');
  await page.getByPlaceholder(/Street address/).fill('1600 Pennsylvania Ave NW, Washington, DC');
  await page.getByRole('button', { name: 'Find my elections' }).click();

  let resultAppeared = true;
  try {
    await page.waitForSelector('.map-card, .empty', { timeout: 30000 });
  } catch {
    resultAppeared = false;
  }
  if (!resultAppeared) {
    console.log('WARNING: neither .map-card nor .empty appeared within 30s');
  }

  // Give map tiles / geocoding time to finish
  await page.waitForTimeout(8000);

  const emptyCount = await page.locator('.empty').count();
  let emptyText = '';
  if (emptyCount > 0) {
    emptyText = (await page.locator('.empty').first().innerText()).replace(/\s+/g, ' ').trim();
  }
  assert('.empty message exists', emptyCount > 0, `count=${emptyCount}`);
  console.log(`EMPTY MESSAGE TEXT: ${emptyText || '(none)'}`);

  const mapCardCount = await page.locator('.map-card').count();
  assert('.map-card exists', mapCardCount > 0, `count=${mapCardCount}`);

  const canvasCount = await page.locator('.map-container canvas').count();
  assert('.map-container canvas exists', canvasCount > 0, `count=${canvasCount}`);

  const legendCount = await page.locator('.map-legend').count();
  let legendText = '';
  if (legendCount > 0) {
    legendText = (await page.locator('.map-legend').first().innerText()).replace(/\s+/g, ' ').trim();
  }
  console.log(`LEGEND TEXT: ${legendText || '(none)'}`);

  await page.screenshot({ path: 'empty-check.png', fullPage: true });
  console.log('Screenshot saved to empty-check.png');
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
  try {
    await page.screenshot({ path: 'empty-check.png', fullPage: true });
    console.log('Screenshot saved to empty-check.png (after error)');
  } catch {}
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`);
process.exit(failed.length === 0 ? 0 : 1);
