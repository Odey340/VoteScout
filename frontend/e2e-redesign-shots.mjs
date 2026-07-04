import { chromium } from 'playwright';

const results = [];
const errors = [];

function assert(name, condition, extra = '') {
  results.push({ name, pass: !!condition, extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

const IGNORE_ERROR = /favicon|arcgis|basemap|tile|Failed to load resource.*(?:404|arcgis)/i;

function wireErrorCapture(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORE_ERROR.test(msg.text())) {
      errors.push(`[${label} console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`[${label} pageerror] ${err.message}`);
  });
}

async function doSearch(page) {
  await page.getByPlaceholder('ZIP code').fill('23219');
  await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: 'Find my elections' }).click();
  await page.waitForSelector('.race-card', { timeout: 30000 });
}

const browser = await chromium.launch({ headless: true });

try {
  // ===================== Desktop page (1440x900) =====================
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  wireErrorCapture(page, 'desktop');

  // ---- 1. Landing, light mode ----
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('groma-theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'redesign-landing.png', fullPage: true });
  console.log('Saved redesign-landing.png');

  // ---- 2. Landing, dark mode via theme toggle ----
  await page.locator('.theme-toggle').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'redesign-landing-dark.png', fullPage: true });
  console.log('Saved redesign-landing-dark.png');

  // ---- 3. Results, light mode ----
  await page.locator('.theme-toggle').click(); // back to light
  await page.waitForTimeout(500);
  await doSearch(page);
  await page.waitForTimeout(6000); // briefings/map
  await page.screenshot({ path: 'redesign-results.png', fullPage: true });
  console.log('Saved redesign-results.png');

  // ---- 6a. Desktop layout assertions ----
  const raceCardCount = await page.locator('.race-card').count();
  assert('.race-card exists on results page', raceCardCount > 0, `count=${raceCardCount}`);

  const sideBox = await page.locator('.results-side').first().boundingBox().catch(() => null);
  const mainBox = await page.locator('.results-main').first().boundingBox().catch(() => null);
  if (sideBox && mainBox) {
    const sideBySide = Math.abs(sideBox.x - mainBox.x) > 100; // clearly different columns
    assert(
      'two-column layout at 1440px (.results-side and .results-main side by side)',
      sideBySide,
      `side.x=${Math.round(sideBox.x)} w=${Math.round(sideBox.width)}, main.x=${Math.round(mainBox.x)} w=${Math.round(mainBox.width)}`,
    );
  } else {
    assert('two-column layout at 1440px (.results-side and .results-main side by side)', false,
      `sideBox=${JSON.stringify(sideBox)}, mainBox=${JSON.stringify(mainBox)}`);
  }

  const readinessBox = await page.locator('.readiness').first().boundingBox().catch(() => null);
  if (readinessBox && mainBox && sideBox) {
    const contentTop = Math.min(mainBox.y, sideBox.y);
    assert(
      '.readiness bar at top of results',
      readinessBox.y <= contentTop + 5,
      `readiness.y=${Math.round(readinessBox.y)}, main.y=${Math.round(mainBox.y)}, side.y=${Math.round(sideBox.y)}`,
    );
  } else {
    assert('.readiness bar at top of results', !!readinessBox,
      readinessBox ? `readiness.y=${Math.round(readinessBox.y)} (columns missing)` : 'no .readiness element');
  }

  // ---- 4. Results, dark mode ----
  await page.locator('.theme-toggle').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'redesign-results-dark.png', fullPage: true });
  console.log('Saved redesign-results-dark.png');

  // ===================== Mobile page (390x844) =====================
  const mContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mContext.newPage();
  wireErrorCapture(mPage, 'mobile');

  await mPage.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mPage.evaluate(() => localStorage.setItem('groma-theme', 'light'));
  await mPage.reload({ waitUntil: 'domcontentloaded' });
  await mPage.waitForTimeout(1000);
  await doSearch(mPage);
  await mPage.waitForTimeout(5000);
  await mPage.screenshot({ path: 'redesign-mobile.png', fullPage: true });
  console.log('Saved redesign-mobile.png');

  // ---- 6b. Mobile stacking assertion ----
  const mMainBox = await mPage.locator('.results-main').first().boundingBox().catch(() => null);
  const mSideBox = await mPage.locator('.results-side').first().boundingBox().catch(() => null);
  if (mMainBox && mSideBox) {
    assert(
      'mobile 390px: .results-main and .results-side stack vertically (main.y < side.y)',
      mMainBox.y < mSideBox.y,
      `main.y=${Math.round(mMainBox.y)} x=${Math.round(mMainBox.x)}, side.y=${Math.round(mSideBox.y)} x=${Math.round(mSideBox.x)}`,
    );
  } else {
    assert('mobile 390px: .results-main and .results-side stack vertically (main.y < side.y)', false,
      `mainBox=${JSON.stringify(mMainBox)}, sideBox=${JSON.stringify(mSideBox)}`);
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected (favicon/ArcGIS noise ignored): ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`);
process.exit(failed.length === 0 ? 0 : 1);
