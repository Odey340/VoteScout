import { chromium } from 'playwright';
import fs from 'node:fs';

const results = [];
const errors = [];

function assert(name, condition, extra = '') {
  results.push({ name, pass: !!condition, extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

const IGNORE_ERROR = /favicon|arcgis|basemap|tile|Failed to load resource.*(?:404|arcgis)/i;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, acceptDownloads: true });

page.on('console', (msg) => {
  if (msg.type() === 'error' && !IGNORE_ERROR.test(msg.text())) {
    errors.push(`[console.error] ${msg.text()}`);
  }
});
page.on('pageerror', (err) => {
  errors.push(`[pageerror] ${err.message}`);
});

const modal = page.locator('.modal');

async function completeWizard() {
  // Assumes modal is open on step 1 with no selections (or day step).
  // STEP 1 – day
  await modal.locator('.mp-daycard').first().click();
  await modal.getByRole('button', { name: 'Next' }).click();
  // STEP 2 – morning
  await modal.getByRole('button', { name: /^Morning/ }).click();
  await modal.getByRole('button', { name: 'Next' }).click();
  // STEP 3 – driving
  await modal.getByRole('button', { name: /Driving/ }).click();
  await modal.getByRole('button', { name: 'Create my plan' }).click();
}

try {
  // ---- 1. Load app ----
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // ---- 2. Search ----
  await page.getByPlaceholder('ZIP code').fill('23219');
  await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: 'Find my elections' }).click();

  let planCardAppeared = true;
  try {
    await page.waitForSelector('.plan-card', { timeout: 30000 });
  } catch {
    planCardAppeared = false;
  }
  assert('.plan-card appears after search', planCardAppeared);

  // ---- 3. Open modal ----
  const buildBtn = page.getByRole('button', { name: 'Make my voting plan' });
  assert('"Make my voting plan" button exists', (await buildBtn.count()) > 0);
  await buildBtn.click();
  await modal.waitFor({ timeout: 5000 });
  assert('modal opens', await modal.isVisible());

  // ---- 4. STEP 1 ----
  const headerText = await modal.locator('.modal-header h3').innerText();
  assert('header shows "Step 1 of 3"', headerText.trim() === 'Step 1 of 3', `got "${headerText.trim()}"`);
  assert(
    '"Which day will you vote?" heading',
    (await modal.getByRole('heading', { name: 'Which day will you vote?' }).count()) > 0,
  );

  const dayCards = modal.locator('.mp-daycard');
  const dayCount = await dayCards.count();
  assert('day cards exist (.mp-daycard)', dayCount > 0, `count=${dayCount}`);

  // Note: the kind badge is CSS-uppercased, so innerText returns e.g. "ELECTION DAY" — match case-insensitively.
  let earlyCount = 0;
  let edayCount = 0;
  const cardTexts = await dayCards.allInnerTexts();
  for (const t of cardTexts) {
    if (/early voting/i.test(t)) earlyCount++;
    if (/election day/i.test(t)) edayCount++;
  }
  console.log(`DAY CARDS: total=${dayCount}, "Early voting"=${earlyCount}, "Election Day"=${edayCount}`);

  const firstCardText = (cardTexts[0] ?? '').replace(/\s+/g, ' ').trim();
  console.log(`FIRST DAY CARD TEXT: ${firstCardText}`);
  assert('first day card is Election Day', /election day/i.test(firstCardText));

  const nextBtn = modal.getByRole('button', { name: 'Next' });
  assert('Next disabled before selecting a day', await nextBtn.isDisabled());
  await dayCards.first().click();
  assert('Next enabled after selecting first day card', await nextBtn.isEnabled());
  await nextBtn.click();

  // ---- 5. STEP 2 ----
  assert(
    '"What time of day" heading (step 2)',
    (await modal.getByRole('heading', { name: /What time of day/ }).count()) > 0,
  );
  assert('header shows "Step 2 of 3"', (await modal.locator('.modal-header h3').innerText()).trim() === 'Step 2 of 3');
  await modal.getByRole('button', { name: /^Morning/ }).click();
  await modal.getByRole('button', { name: 'Next' }).click();

  // ---- 6. STEP 3 ----
  assert(
    '"How are you getting there" heading (step 3)',
    (await modal.getByRole('heading', { name: /How are you getting there/ }).count()) > 0,
  );
  const drivingChip = modal.getByRole('button', { name: /Driving/ });
  assert('"🚗 Driving" chip exists', (await drivingChip.count()) > 0);
  await drivingChip.click();
  await modal.getByRole('button', { name: 'Create my plan' }).click();

  // ---- 7. RESULT ----
  const resultHeading = modal.locator('.mp-plan-title');
  await resultHeading.waitFor({ timeout: 5000 });
  const resultText = await resultHeading.innerText();
  assert('result heading contains "You\'re voting"', resultText.includes("You're voting"), `got "${resultText}"`);

  const subText = (await modal.locator('.mp-plan-sub').innerText()).replace(/\s+/g, ' ').trim();
  console.log(`PLAN SUBTITLE: ${subText}`);

  const whereCount = await modal.locator('.mp-where').count();
  const whereText = whereCount
    ? (await modal.locator('.mp-where').innerText()).trim().split('\n').map((l) => l.trim()).join(' | ')
    : '(no .mp-where block)';
  console.log(`POLLING PLACE: ${whereText}`);

  const checklistItems = await modal.locator('.mp-checklist li').allInnerTexts();
  console.log(`CHECKLIST (${checklistItems.length} items):`);
  checklistItems.forEach((t, i) => console.log(`  ${i + 1}. ${t.replace(/\s+/g, ' ').trim()}`));
  assert('checklist has items', checklistItems.length > 0, `count=${checklistItems.length}`);

  await page.screenshot({ path: 'plan-check.png', fullPage: true });
  console.log('Screenshot saved to plan-check.png');

  // ---- 8. MID-FLOW BANNER TEST ----
  // Close the modal first (result view), which reveals the on-page PlanResult.
  await modal.locator('.modal-close').click();
  await page.getByRole('button', { name: 'Start over' }).click();

  await page.getByRole('button', { name: 'Make my voting plan' }).click();
  await modal.waitFor({ timeout: 5000 });
  await modal.locator('.mp-daycard').first().click();
  await modal.locator('.modal-close').click();

  const banner = page.locator('.mp-banner');
  let bannerAppeared = true;
  try {
    await banner.waitFor({ timeout: 5000 });
  } catch {
    bannerAppeared = false;
  }
  assert('.mp-banner appears after closing mid-flow', bannerAppeared);
  if (bannerAppeared) {
    const bannerText = (await banner.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`BANNER TEXT: ${bannerText}`);
    assert('banner contains "partway through"', bannerText.includes('partway through'));
    const resumeBtn = banner.getByRole('button', { name: 'Resume' });
    assert('banner has Resume button', (await resumeBtn.count()) > 0);

    await page.screenshot({ path: 'plan-banner-check.png', fullPage: true });
    console.log('Screenshot saved to plan-banner-check.png');

    await resumeBtn.click();
    await modal.waitFor({ timeout: 5000 });
    assert(
      'Resume reopens modal on day step',
      (await modal.getByRole('heading', { name: 'Which day will you vote?' }).count()) > 0,
    );
    assert('resumed header shows "Step 1 of 3"', (await modal.locator('.modal-header h3').innerText()).trim() === 'Step 1 of 3');
  }

  // ---- 9. CALENDAR DOWNLOAD ----
  // Modal is open on day step with the day still selected; finish the wizard fresh.
  await completeWizard();
  await modal.locator('.mp-plan-title').waitFor({ timeout: 5000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await modal.getByRole('button', { name: 'Add to calendar' }).click();
  let download = null;
  try {
    download = await downloadPromise;
  } catch {}
  assert('"Add to calendar" triggers a download', download != null, download ? `filename=${download.suggestedFilename()}` : '');

  if (download) {
    await download.saveAs('test-plan.ics');
    const ics = fs.readFileSync('test-plan.ics', 'utf8');
    console.log('--- ICS CONTENT START ---');
    console.log(ics);
    console.log('--- ICS CONTENT END ---');
    assert('ICS DTSTART has a time component', /DTSTART:\d{8}T\d{6}/.test(ics), (ics.match(/DTSTART:[^\r\n]*/) ?? [''])[0]);
    assert('ICS contains a VALARM', ics.includes('BEGIN:VALARM'));
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
  try {
    await page.screenshot({ path: 'plan-check-error.png', fullPage: true });
    console.log('Screenshot saved to plan-check-error.png (after error)');
  } catch {}
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected (favicon/ArcGIS noise ignored): ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`);
process.exit(failed.length === 0 ? 0 : 1);
