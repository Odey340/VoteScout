import { chromium } from 'playwright';

const results = [];
const errors = [];

function assert(name, condition, extra = '') {
  results.push({ name, pass: !!condition, extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

function note(name, extra = '') {
  console.log(`NOTE: ${name}${extra ? ' — ' + extra : ''}`);
}

// Ignore favicon/ArcGIS noise and external resource 404s.
const IGNORE_ERROR = /favicon|arcgis|basemap|tile|Failed to load resource/i;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error' && !IGNORE_ERROR.test(msg.text())) {
    errors.push(`[console.error] ${msg.text()}`);
  }
});
page.on('pageerror', (err) => {
  errors.push(`[pageerror] ${err.message}`);
});

try {
  // ---- 1. Load + search ----
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByPlaceholder('ZIP code').fill('23219');
  await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: 'Find my elections' }).click();
  let raceCardAppeared = true;
  try {
    await page.waitForSelector('.race-card', { timeout: 30000 });
  } catch {
    raceCardAppeared = false;
  }
  assert('1. .race-card appears after search', raceCardAppeared);
  if (!raceCardAppeared) throw new Error('no .race-card — cannot continue');

  const card = page.locator('.race-card').first();

  // ---- 2. .office-ctx exists in the race card with "About this seat" toggle ----
  const officeCtx = card.locator('.office-ctx');
  const officeCtxCount = await officeCtx.count();
  assert('2. .office-ctx exists inside the race card', officeCtxCount > 0, `count=${officeCtxCount}`);
  if (officeCtxCount === 0) throw new Error('no .office-ctx — cannot continue');

  const officeToggle = officeCtx.first().locator('button.briefing-toggle').first();
  const toggleText = (await officeToggle.innerText()).trim();
  assert(
    '2. office-ctx toggle button text contains "About this seat"',
    /About this seat/i.test(toggleText),
    `text="${toggleText}"`,
  );

  // ---- 3. Expand and poll up to 60s for content or error ----
  await officeToggle.click();
  const briefingText = officeCtx.first().locator('.briefing-text');
  const briefingError = officeCtx.first().locator('.briefing-error');
  const loadingMsg = officeCtx.first().locator('.briefing-loading');

  let sawSkeleton = false;
  let outcome = 'timeout';
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (!sawSkeleton && (await loadingMsg.count()) > 0) {
      const lt = (await loadingMsg.first().innerText()).trim();
      sawSkeleton = true;
      note('caught loading skeleton', `text="${lt}"`);
    }
    if ((await briefingText.count()) > 0) {
      const txt = (await briefingText.first().innerText()).trim();
      if (txt.length > 0) {
        outcome = 'ready';
        break;
      }
    }
    if ((await briefingError.count()) > 0) {
      outcome = 'error';
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (sawSkeleton) {
    assert('3. loading skeleton ("Researching this office…") observed (expected loading state)', true);
  } else {
    note('loading skeleton not observed (context may have been cached / already ready)');
  }
  assert('3. office context resolved within 60s (ready or error)', outcome !== 'timeout', `outcome=${outcome}`);
  if (outcome === 'error') {
    const et = (await briefingError.first().innerText()).trim();
    assert('3. office context generated (no .briefing-error)', false, `error shown: "${et}"`);
    throw new Error('office context ended in error state');
  }
  if (outcome === 'timeout') throw new Error('office context never resolved');

  // ---- 4. Disclaimer, text, headers, officeholder mention, sources ----
  const disclaimer = officeCtx.first().locator('.briefing-disclaimer');
  const discCount = await disclaimer.count();
  const discText = discCount > 0 ? (await disclaimer.first().innerText()).trim() : '';
  console.log(`DISCLAIMER: ${discText}`);
  assert('4. .briefing-disclaimer exists in .office-ctx', discCount > 0);
  assert('4. disclaimer contains "AI-generated context"', /AI-generated context/i.test(discText), `"${discText}"`);
  assert(
    '4. disclaimer contains "as of" with a date',
    /as of\s+\w+\s+\d{4}/i.test(discText),
    `"${discText}"`,
  );

  const ctxText = (await briefingText.first().innerText()).trim();
  console.log('\n===== OFFICE CONTEXT TEXT (full) =====');
  console.log(ctxText);
  console.log('===== END OFFICE CONTEXT TEXT =====\n');

  for (const header of ['CURRENT OFFICEHOLDER', 'WHAT THIS OFFICE DOES', 'RECORD SNAPSHOT']) {
    assert(`4. context contains section header "${header}"`, ctxText.includes(header));
  }

  // Officeholder / open-seat mention (soft: print what it says)
  const mentionsOpen = /open seat|seat is open|\bopen\b/i.test(ctxText);
  const mentionsIncumbent = /incumbent/i.test(ctxText);
  assert(
    '4. context mentions open seat OR incumbent',
    mentionsOpen || mentionsIncumbent,
    `open=${mentionsOpen} incumbent=${mentionsIncumbent}`,
  );
  const holderMatch = ctxText.match(/CURRENT OFFICEHOLDER[:\s]*([\s\S]*?)(?=\n\s*\n|WHAT THIS OFFICE DOES)/i);
  console.log(`OFFICEHOLDER SECTION SAYS: ${holderMatch ? holderMatch[1].trim() : '(could not extract)'}`);

  // Sources
  const sources = officeCtx.first().locator('.office-sources');
  const sourcesCount = await sources.count();
  assert('4. .office-sources exists', sourcesCount > 0);
  let hrefs = [];
  if (sourcesCount > 0) {
    const links = sources.first().locator('a');
    const linkCount = await links.count();
    for (let i = 0; i < linkCount; i++) {
      const label = (await links.nth(i).innerText()).trim();
      const href = await links.nth(i).getAttribute('href');
      hrefs.push(href || '');
      console.log(`SOURCE LINK ${i + 1}: label="${label}" href="${href}"`);
    }
    assert('4. .office-sources has at least 2 links', linkCount >= 2, `count=${linkCount}`);
    assert(
      '4. one source href contains "wikipedia.org"',
      hrefs.some((h) => h.includes('wikipedia.org')),
      hrefs.join(' | '),
    );
    assert(
      '4. one source href contains "vote.gov"',
      hrefs.some((h) => h.includes('vote.gov')),
      hrefs.join(' | '),
    );
  }

  // ---- 5. Regular "AI Race Briefing" toggle still exists below in the same card ----
  const raceBriefingToggle = card.locator('.briefing button.briefing-toggle', { hasText: 'AI Race Briefing' });
  const rbCount = await raceBriefingToggle.count();
  assert('5. "AI Race Briefing" toggle still exists in the same card', rbCount > 0, `count=${rbCount}`);
  if (rbCount > 0) {
    const officeBox = await officeToggle.boundingBox();
    const rbBox = await raceBriefingToggle.first().boundingBox();
    assert(
      '5. "AI Race Briefing" is below "About this seat"',
      officeBox && rbBox && rbBox.y > officeBox.y,
      `office.y=${officeBox?.y?.toFixed(0)} raceBriefing.y=${rbBox?.y?.toFixed(0)}`,
    );
  }

  // ---- 6. Screenshot the expanded race card ----
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500); // let collapse animation settle
  await card.screenshot({ path: 'office-check.png' });
  console.log('Screenshot saved to office-check.png');
  assert('6. expanded race-card screenshot saved', true);
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
  try {
    await page.screenshot({ path: 'office-check-error.png', fullPage: true });
    console.log('Screenshot saved to office-check-error.png (after error)');
  } catch {}
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected (favicon/ArcGIS noise ignored): ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(
  `\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`,
);
process.exit(failed.length === 0 ? 0 : 1);
