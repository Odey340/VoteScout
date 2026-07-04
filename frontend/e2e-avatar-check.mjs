import { chromium } from 'playwright';

const results = [];
const errors = [];

function assert(name, condition, extra = '') {
  results.push({ name, pass: !!condition, extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

// Ignore favicon/ArcGIS noise and external photo-host 404s (handled by initials fallback).
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

  // ---- 2. Every candidate row has .avatar with .avatar-initials ----
  const rows = page.locator('.candidates li');
  const rowCount = await rows.count();
  console.log(`CANDIDATE ROWS: ${rowCount}`);
  assert('2. at least one .candidates li row exists', rowCount > 0, `count=${rowCount}`);

  let rowsWithAvatar = 0;
  let rowsWithInitials = 0;
  const initialsList = [];
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const avatarCount = await row.locator('.avatar').count();
    const initialsLoc = row.locator('.avatar .avatar-initials');
    const initialsCount = await initialsLoc.count();
    if (avatarCount > 0) rowsWithAvatar++;
    if (initialsCount > 0) {
      rowsWithInitials++;
      const txt = (await initialsLoc.first().innerText()).trim();
      initialsList.push(txt);
    } else {
      initialsList.push('<none>');
    }
  }
  console.log(`INITIALS: ${initialsList.join(', ')}`);
  assert('2. every candidate row has a .avatar', rowsWithAvatar === rowCount, `${rowsWithAvatar}/${rowCount}`);
  assert(
    '2. every .avatar has a .avatar-initials child',
    rowsWithInitials === rowCount,
    `${rowsWithInitials}/${rowCount}`,
  );

  // ---- 3. Wait up to 20s for at least one loaded photo (poll every 500ms) ----
  let loadedCount = 0;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    loadedCount = await page.locator('.avatar-img.loaded').count();
    if (loadedCount > 0) break;
    await page.waitForTimeout(500);
  }
  // give a little extra time for any stragglers, then recount
  await page.waitForTimeout(1500);
  loadedCount = await page.locator('.avatar-img.loaded').count();
  assert('3. at least one .avatar-img.loaded appears within 20s', loadedCount > 0, `loaded=${loadedCount}`);
  console.log(`AVATARS WITH LOADED PHOTO: ${loadedCount} / ${rowCount} (initials-only: ${rowCount - loadedCount})`);

  // ---- 4. Title attribute + src domain of each loaded photo ----
  const loadedInfo = await page.$$eval('.avatar-img.loaded', (imgs) =>
    imgs.map((img) => {
      const avatar = img.closest('.avatar');
      let domain = '';
      try {
        domain = new URL(img.src).hostname;
      } catch {
        domain = img.src;
      }
      const nameEl = avatar?.closest('li')?.querySelector('.candidate-name, strong, b');
      return {
        title: avatar ? avatar.getAttribute('title') : null,
        domain,
        candidate: nameEl ? nameEl.textContent.trim() : '',
      };
    }),
  );
  let allTitled = loadedInfo.length > 0;
  for (const info of loadedInfo) {
    console.log(
      `LOADED PHOTO: candidate="${info.candidate}" title="${info.title}" src-domain="${info.domain}"`,
    );
    if (!info.title || !/^Photo:/i.test(info.title)) allTitled = false;
  }
  assert(
    '4. every loaded photo avatar has a title like "Photo: <source>"',
    allTitled,
    loadedInfo.map((i) => i.title).join(' | ') || 'no loaded photos',
  );

  // ---- 5. Avatars circular and uniform 44x44 (±1px) ----
  const avatars = page.locator('.avatar');
  const avatarTotal = await avatars.count();
  const boxes = [];
  for (let i = 0; i < avatarTotal; i++) {
    const box = await avatars.nth(i).boundingBox();
    if (box) boxes.push(box);
  }
  const sizesOk = boxes.every(
    (b) => Math.abs(b.width - 44) <= 1 && Math.abs(b.height - 44) <= 1 && Math.abs(b.width - b.height) <= 1,
  );
  const sizeSummary = boxes
    .map((b) => `${b.width.toFixed(1)}x${b.height.toFixed(1)}`)
    .join(', ');
  console.log(`AVATAR SIZES: ${sizeSummary}`);
  assert('5. all avatars uniform 44x44 (±1px) and square', boxes.length === avatarTotal && sizesOk, sizeSummary);

  const radius = await avatars.first().evaluate((el) => getComputedStyle(el).borderRadius);
  console.log(`AVATAR BORDER-RADIUS: ${radius}`);
  assert(
    '5. avatars are circular (border-radius 50% or >= half size)',
    radius === '50%' || parseFloat(radius) >= 22,
    `border-radius=${radius}`,
  );

  // ---- 6. Screenshot first race card ----
  await page.locator('.race-card').first().screenshot({ path: 'avatar-check.png' });
  console.log('Screenshot saved to avatar-check.png');
  assert('6. race-card screenshot saved', true);
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
  try {
    await page.screenshot({ path: 'avatar-check-error.png', fullPage: true });
    console.log('Screenshot saved to avatar-check-error.png (after error)');
  } catch {}
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected (favicon/ArcGIS/img-404 noise ignored): ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(
  `\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`,
);
process.exit(failed.length === 0 ? 0 : 1);
