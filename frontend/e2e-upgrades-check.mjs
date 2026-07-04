import { chromium } from 'playwright';

const results = [];
const errors = [];

function assert(name, condition, extra = '') {
  results.push({ name, pass: !!condition, extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

const IGNORE_ERROR = /favicon|arcgis|basemap|tile|Failed to load resource.*(?:404|arcgis)/i;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5173' });
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error' && !IGNORE_ERROR.test(msg.text())) {
    errors.push(`[console.error] ${msg.text()}`);
  }
});
page.on('pageerror', (err) => {
  errors.push(`[pageerror] ${err.message}`);
});

async function doSearch() {
  await page.getByPlaceholder('ZIP code').fill('23219');
  await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: 'Find my elections' }).click();
  await page.waitForSelector('.card', { timeout: 30000 });
}

try {
  // ---- 1. Load app, clear localStorage ----
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  assert('1. app loads and localStorage cleared', true);

  // ---- 2. Search ----
  let cardAppeared = true;
  try {
    await doSearch();
  } catch {
    cardAppeared = false;
  }
  assert('2. .card appears after search', cardAppeared);
  if (!cardAppeared) throw new Error('no .card — cannot continue');

  const electionName = (await page.locator('.card h2').first().innerText()).trim();
  console.log(`ELECTION NAME: ${electionName}`);

  // ---- 3. Readiness bar ----
  const readiness = page.locator('.readiness');
  const readinessExists = (await readiness.count()) > 0;
  assert('3. .readiness exists', readinessExists);
  if (readinessExists) {
    const rText = (await readiness.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`READINESS TEXT: ${rText}`);
    assert('3. readiness text contains "You\'ve reviewed 0 of 1"', rText.includes("You've reviewed 0 of 1"));
  } else {
    assert('3. readiness text contains "You\'ve reviewed 0 of 1"', false, 'no .readiness element');
  }

  // ---- 4. Pledge banner ----
  const pledgeBanner = page.locator('.pledge-banner');
  let pledgeBefore = null;
  let bannerOk = true;
  try {
    await pledgeBanner.waitFor({ timeout: 15000 });
  } catch {
    bannerOk = false;
  }
  assert('4. .pledge-banner exists', bannerOk);
  if (bannerOk) {
    const pText = (await pledgeBanner.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`PLEDGE BANNER TEXT: ${pText}`);
    const m = pText.replace(/,/g, '').match(/(\d+) people in 23219 have made a voting plan/);
    assert('4. banner matches /\\d+ people in 23219 have made a voting plan/', m != null, `text="${pText}"`);
    if (m) {
      pledgeBefore = parseInt(m[1], 10);
      console.log(`PLEDGE COUNT (step 4): ${pledgeBefore}`);
    }
  } else {
    assert('4. banner matches /\\d+ people in 23219 have made a voting plan/', false, 'no banner');
  }

  // ---- 5. Auto briefing ----
  let spinnerGone = true;
  try {
    await page.waitForSelector('.briefing-spinner', { state: 'detached', timeout: 60000 });
  } catch {
    spinnerGone = false;
  }
  assert('5. briefing spinner gone within 60s (briefing pre-fetched)', spinnerGone);

  await page.getByRole('button', { name: /AI Race Briefing/ }).click();
  const briefingText = page.locator('.briefing-text');
  let briefingAppeared = true;
  try {
    await briefingText.waitFor({ timeout: 10000 });
  } catch {
    briefingAppeared = false;
  }
  assert('5. .briefing-text appears after opening toggle', briefingAppeared);
  if (briefingAppeared) {
    const bText = (await briefingText.innerText()).trim();
    console.log(`BRIEFING (first 100 chars): ${bText.slice(0, 100)}`);
    assert('5. briefing has content', bText.length > 0, `length=${bText.length}`);
  }
  const panelText = (await page.locator('.briefing-panel').innerText()).replace(/\s+/g, ' ');
  assert('5. briefing does NOT show "Generating" (pre-fetched)', !panelText.includes('Generating'));

  // ---- 6. Reviewed check + 100% readiness ----
  const reviewedCheck = page.locator('.reviewed-check');
  let checkAppeared = true;
  try {
    await reviewedCheck.waitFor({ timeout: 5000 });
  } catch {
    checkAppeared = false;
  }
  assert('6. .reviewed-check appears next to race name', checkAppeared);

  const readyText = (await readiness.innerText()).replace(/\s+/g, ' ').trim();
  console.log(`READINESS TEXT (after review): ${readyText}`);
  assert('6. readiness shows "You\'re ballot-ready ✅"', readyText.includes("You're ballot-ready ✅"));
  assert(
    '6. "Make your voting plan" button in readiness area',
    (await readiness.getByRole('button', { name: 'Make your voting plan' }).count()) > 0,
  );
  assert(
    '6. "Share your pledge card" button in readiness area',
    (await readiness.getByRole('button', { name: 'Share your pledge card' }).count()) > 0,
  );
  await page.screenshot({ path: 'upgrades-ready.png', fullPage: true });
  console.log('Screenshot saved to upgrades-ready.png');

  // ---- 7. localStorage persistence across reload ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await doSearch();
  const readiness2 = page.locator('.readiness');
  let restored = false;
  try {
    await page.waitForFunction(
      () => document.querySelector('.readiness')?.innerText.includes("You're ballot-ready"),
      { timeout: 10000 },
    );
    restored = true;
  } catch {}
  const rText2 = (await readiness2.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  assert('7. ballot-ready state restored after reload without clicks', restored, `readiness="${rText2}"`);
  assert('7. .reviewed-check present after reload', (await page.locator('.reviewed-check').count()) > 0);

  // ---- 8. Pledge increment + copy/invite ----
  // Read the current pledge number after reload (for reference).
  await pledgeBanner.waitFor({ timeout: 15000 });
  const preText = (await pledgeBanner.innerText()).replace(/\s+/g, ' ').replace(/,/g, '');
  const preM = preText.match(/(\d+) people/);
  const pledgePrePlan = preM ? parseInt(preM[1], 10) : null;
  console.log(`PLEDGE COUNT (before plan, step 8): ${pledgePrePlan}`);

  const modal = page.locator('.modal');
  await page.getByRole('button', { name: 'Make my voting plan', exact: true }).click();
  await modal.waitFor({ timeout: 5000 });
  await modal.locator('.mp-daycard').first().click();
  await modal.getByRole('button', { name: 'Next' }).click();
  await modal.getByRole('button', { name: /^Morning/ }).click();
  await modal.getByRole('button', { name: 'Next' }).click();
  await modal.getByRole('button', { name: /Driving/ }).click();
  await modal.getByRole('button', { name: 'Create my plan' }).click();

  const planTitle = modal.locator('.mp-plan-title');
  await planTitle.waitFor({ timeout: 5000 });
  const planText = await planTitle.innerText();
  assert('8. plan result appears ("You\'re voting")', planText.includes("You're voting"), `got "${planText}"`);

  const copyBtn = modal.getByRole('button', { name: 'Copy pledge text' });
  const inviteBtn = modal.getByRole('button', { name: 'Invite friends to make a plan' });
  assert('8. modal has "Copy pledge text" button', (await copyBtn.count()) > 0);
  assert('8. modal has "Invite friends to make a plan" button', (await inviteBtn.count()) > 0);

  await copyBtn.click();
  let copiedLabel = '';
  try {
    await modal.getByRole('button', { name: 'Copied!', exact: true }).waitFor({ timeout: 3000 });
    copiedLabel = 'Copied!';
  } catch {}
  assert('8. button text changes to "Copied!"', copiedLabel === 'Copied!');

  const pledgeClipboard = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `<clipboard error: ${e.message}>`);
  console.log(`PLEDGE CLIPBOARD: ${pledgeClipboard}`);
  assert('8. pledge text contains "I have a voting plan"', pledgeClipboard.includes('I have a voting plan'));
  assert('8. pledge text does NOT contain "101 E Franklin"', !pledgeClipboard.includes('101 E Franklin'));

  await inviteBtn.click();
  await page.waitForTimeout(300);
  const inviteClipboard = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `<clipboard error: ${e.message}>`);
  console.log(`INVITE CLIPBOARD: ${inviteClipboard}`);
  assert('8. invite text contains "takes 2 minutes"', inviteClipboard.includes('takes 2 minutes'));
  assert('8. invite text contains election name', inviteClipboard.includes(electionName), `election="${electionName}"`);

  // ---- 9. Pledge count incremented ----
  await modal.locator('.modal-close').click();
  let pledgeAfter = null;
  try {
    await page.waitForFunction(
      (before) => {
        const el = document.querySelector('.pledge-banner');
        if (!el) return false;
        const m = el.innerText.replace(/,/g, '').match(/(\d+) people/);
        return m && parseInt(m[1], 10) > before;
      },
      pledgeBefore ?? 0,
      { timeout: 10000 },
    );
  } catch {}
  const afterText = ((await pledgeBanner.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').replace(/,/g, '');
  const afterM = afterText.match(/(\d+) people/);
  if (afterM) pledgeAfter = parseInt(afterM[1], 10);
  console.log(`PLEDGE COUNT (after plan, step 9): ${pledgeAfter}`);
  assert(
    '9. pledge count incremented (> step-4 count)',
    pledgeBefore != null && pledgeAfter != null && pledgeAfter > pledgeBefore,
    `before=${pledgeBefore}, after=${pledgeAfter}`,
  );

  // ---- 10. Final screenshot ----
  await page.screenshot({ path: 'upgrades-final.png', fullPage: true });
  console.log('Screenshot saved to upgrades-final.png');
  assert('10. final screenshot saved', true);
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
  try {
    await page.screenshot({ path: 'upgrades-error.png', fullPage: true });
    console.log('Screenshot saved to upgrades-error.png (after error)');
  } catch {}
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected (favicon/ArcGIS noise ignored): ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`);
process.exit(failed.length === 0 ? 0 : 1);
