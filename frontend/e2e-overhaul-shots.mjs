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

async function freshLightLoad(page) {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('groma-theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function doSearch(page) {
  await page.getByPlaceholder('ZIP code').fill('23219');
  await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: /Find my (ballot|elections)/ }).click();
  await page.waitForSelector('.race-card', { timeout: 30000 });
}

const browser = await chromium.launch({ headless: true });

try {
  // ===================== 1. Landing at 1280x900 =====================
  const dCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dPage = await dCtx.newPage();
  wireErrorCapture(dPage, 'desktop');

  await freshLightLoad(dPage);
  await dPage.waitForTimeout(3000);
  await dPage.screenshot({ path: 'ds-landing-1280.png', fullPage: true });
  console.log('Saved ds-landing-1280.png');

  // ---- Landing assertions at 1280 ----
  const heroText = await dPage
    .locator('.hero h1, .hero-headline, h1')
    .first()
    .textContent()
    .catch(() => '');
  assert(
    'landing 1280: hero headline contains "Know your ballot"',
    (heroText || '').includes('Know your ballot'),
    `h1="${(heroText || '').trim().slice(0, 80)}"`,
  );

  const trustRowCount = await dPage.locator('.trust-row').count();
  assert('landing 1280: .trust-row exists', trustRowCount > 0, `count=${trustRowCount}`);

  const howCount = await dPage.locator('.how').count();
  const howStepCount = await dPage.locator('.how .how-step').count();
  assert(
    'landing 1280: .how section exists with 3 .how-steps',
    howCount > 0 && howStepCount === 3,
    `.how count=${howCount}, .how-step count=${howStepCount}`,
  );

  const footerText = await dPage.locator('.footer').first().textContent().catch(() => '');
  assert(
    'landing 1280: .footer contains "Data sources"',
    (footerText || '').includes('Data sources'),
    footerText ? `footer text length=${footerText.length}` : 'no .footer element',
  );

  // ---- Focus ring check ----
  await dPage.keyboard.press('Tab');
  await dPage.waitForTimeout(300);
  const focusInfo = await dPage.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').trim().slice(0, 40),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      boxShadow: cs.boxShadow,
    };
  });
  if (focusInfo && focusInfo.rect.width > 0) {
    const pad = 24;
    const clip = {
      x: Math.max(0, focusInfo.rect.x - pad),
      y: Math.max(0, focusInfo.rect.y - pad),
      width: Math.min(1280, focusInfo.rect.width + pad * 2),
      height: Math.min(900, focusInfo.rect.height + pad * 2),
    };
    await dPage.screenshot({ path: 'ds-focus.png', clip });
    console.log('Saved ds-focus.png');
    const hasVisibleFocus =
      (focusInfo.outlineStyle !== 'none' && parseFloat(focusInfo.outlineWidth) > 0) ||
      (focusInfo.boxShadow && focusInfo.boxShadow !== 'none');
    assert(
      'focus: first Tab shows visible focus indicator',
      hasVisibleFocus,
      `el=<${focusInfo.tag} class="${focusInfo.cls}"> text="${focusInfo.text}" outline=${focusInfo.outlineStyle} ${focusInfo.outlineWidth} ${focusInfo.outlineColor}, boxShadow=${focusInfo.boxShadow.slice(0, 80)}`,
    );
  } else {
    assert('focus: first Tab shows visible focus indicator', false, 'no focused element after Tab');
  }

  // ===================== 3. Results at 1280x900 =====================
  await freshLightLoad(dPage);
  await dPage.waitForTimeout(1000);
  await doSearch(dPage);
  await dPage.waitForTimeout(6000); // briefings / map / avatars
  await dPage.screenshot({ path: 'ds-results-1280.png', fullPage: true });
  console.log('Saved ds-results-1280.png');

  // ---- Results assertions ----
  const mastheadCount = await dPage.locator('.masthead').count();
  const mastheadText = mastheadCount
    ? (await dPage.locator('.masthead').first().textContent()) || ''
    : '';
  const hasOfficial = /official election information/i.test(mastheadText);
  const hasCountdown = /\b\d+\s*(day|hour|week)|\bdays\b|countdown|until/i.test(mastheadText);
  assert(
    'results: .masthead exists containing "OFFICIAL ELECTION INFORMATION" (case-insensitive)',
    mastheadCount > 0 && hasOfficial,
    `masthead count=${mastheadCount}`,
  );
  assert(
    'results: .masthead contains a countdown',
    mastheadCount > 0 && hasCountdown,
    `text sample="${mastheadText.trim().replace(/\s+/g, ' ').slice(0, 140)}"`,
  );

  const mastheadBox = await dPage.locator('.masthead').first().boundingBox().catch(() => null);
  const readinessBox = await dPage.locator('.readiness').first().boundingBox().catch(() => null);
  if (mastheadBox && readinessBox) {
    const inside =
      readinessBox.x >= mastheadBox.x - 1 &&
      readinessBox.y >= mastheadBox.y - 1 &&
      readinessBox.x + readinessBox.width <= mastheadBox.x + mastheadBox.width + 1 &&
      readinessBox.y + readinessBox.height <= mastheadBox.y + mastheadBox.height + 1;
    assert(
      'results: .readiness is INSIDE .masthead bounding box',
      inside,
      `masthead=${JSON.stringify(mastheadBox)}, readiness=${JSON.stringify(readinessBox)}`,
    );
  } else {
    assert(
      'results: .readiness is INSIDE .masthead bounding box',
      false,
      `mastheadBox=${JSON.stringify(mastheadBox)}, readinessBox=${JSON.stringify(readinessBox)}`,
    );
  }

  const raceH3Count = await dPage.locator('.race-card h3').count();
  assert('results: race card h3 exists', raceH3Count > 0, `count=${raceH3Count}`);

  const candTileCount = await dPage.locator('.candidates li').count();
  const avatarCount = await dPage.locator('.candidates li .avatar').count();
  assert(
    'results: .candidates li tiles exist with .avatars',
    candTileCount > 0 && avatarCount > 0,
    `tiles=${candTileCount}, avatars=${avatarCount}`,
  );

  // ---- Mobile bar must NOT be visible at 1280 ----
  const mobileBarDesktopVisible = await dPage
    .locator('.mobile-bar')
    .first()
    .isVisible()
    .catch(() => false);
  assert('results 1280: .mobile-bar NOT visible', !mobileBarDesktopVisible);

  // ===================== 7. Modal (light, 1280) =====================
  await dPage.getByRole('button', { name: /Make my voting plan/i }).first().click();
  await dPage.waitForSelector('.modal', { timeout: 10000 });
  await dPage.waitForTimeout(800);
  await dPage.locator('.modal').first().screenshot({ path: 'ds-modal.png' });
  console.log('Saved ds-modal.png');
  await dPage.keyboard.press('Escape');
  await dPage.waitForTimeout(500);
  if (await dPage.locator('.modal-backdrop').first().isVisible().catch(() => false)) {
    // Escape didn't close it — try a close button, then backdrop click
    const closeBtn = dPage.locator('.modal button[aria-label*="lose" i], .modal .modal-close, .modal button:has-text("Close"), .modal button:has-text("×")').first();
    if (await closeBtn.count()) {
      await closeBtn.click().catch(() => {});
    } else {
      await dPage.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {});
    }
    await dPage.waitForTimeout(500);
  }

  // ===================== 6. Dark mode results at 1280 =====================
  await dPage.locator('.theme-toggle').click();
  await dPage.waitForTimeout(1000);
  await dPage.screenshot({ path: 'ds-dark-1280.png', fullPage: true });
  console.log('Saved ds-dark-1280.png');
  await dCtx.close();

  // ===================== 2. Landing at 375x812 =====================
  const mCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mPage = await mCtx.newPage();
  wireErrorCapture(mPage, 'mobile');

  await freshLightLoad(mPage);
  await mPage.waitForTimeout(3000);
  await mPage.screenshot({ path: 'ds-landing-375.png', fullPage: true });
  console.log('Saved ds-landing-375.png');

  // ===================== 4. Results at 375x812 =====================
  await doSearch(mPage);
  await mPage.waitForTimeout(5000);
  await mPage.screenshot({ path: 'ds-results-375.png', fullPage: true });
  console.log('Saved ds-results-375.png');

  // ---- Mobile bar visible at 375 ----
  const mobileBarVisible = await mPage
    .locator('.mobile-bar')
    .first()
    .isVisible()
    .catch(() => false);
  const mobileBarText = mobileBarVisible
    ? (await mPage.locator('.mobile-bar').first().textContent()) || ''
    : '';
  assert(
    'results 375: .mobile-bar IS visible',
    mobileBarVisible,
    mobileBarVisible ? `text="${mobileBarText.trim().replace(/\s+/g, ' ').slice(0, 80)}"` : 'not visible/absent',
  );
  assert(
    'results 375: .mobile-bar has "Where to vote" and "Make a plan" buttons',
    /where to vote/i.test(mobileBarText) && /make a plan/i.test(mobileBarText),
  );
  await mCtx.close();

  // ===================== 5. Results at 768x1024 =====================
  const tCtx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const tPage = await tCtx.newPage();
  wireErrorCapture(tPage, 'tablet');

  await freshLightLoad(tPage);
  await tPage.waitForTimeout(1000);
  await doSearch(tPage);
  await tPage.waitForTimeout(5000);
  await tPage.screenshot({ path: 'ds-results-768.png', fullPage: true });
  console.log('Saved ds-results-768.png');
  await tCtx.close();
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
