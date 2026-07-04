import { chromium } from 'playwright';

const results = [];
const errors = [];

function assert(name, condition, extra = '') {
  results.push({ name, pass: !!condition, extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

const IGNORE = /favicon|arcgis|ERR_BLOCKED_BY_CLIENT/i;

function wireErrors(page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORE.test(msg.text())) {
      errors.push(`[console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    if (!IGNORE.test(err.message)) errors.push(`[pageerror] ${err.message}`);
  });
}

async function doSearch(page) {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByPlaceholder('ZIP code').fill('23219');
  await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: /Find my/ }).click();
  await page.waitForSelector('.race-card', { timeout: 30000 });
}

const browser = await chromium.launch({ headless: true });

try {
  // ---- Desktop: 1280x900, light mode ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  wireErrors(page);
  await page.addInitScript(() => localStorage.setItem('groma-theme', 'light'));

  await doSearch(page);
  console.log('Desktop: .race-card appeared; waiting 12s for map tiles...');
  await page.waitForTimeout(12000);

  // 2. Bounding box of .map-container
  const box = await page.locator('.map-container').first().boundingBox();
  if (!box) {
    assert('desktop .map-container has bounding box', false, 'boundingBox() returned null');
  } else {
    const h = Math.round(box.height);
    const w = Math.round(box.width);
    assert('desktop .map-container height ~420px (400-440)', h >= 400 && h <= 440, `height=${h}px`);
    assert('desktop .map-container width > 300px', w > 300, `width=${w}px`);
  }

  // 3. Non-white pixel ratio on the map canvas
  const pixelStats = await page.evaluate(() => {
    const canvas = document.querySelector('.map-container canvas');
    if (!canvas) return { error: 'no canvas found in .map-container' };
    const w = 100;
    const h = Math.max(1, Math.round((canvas.height / canvas.width) * 100)) || 100;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return { error: 'getImageData failed: ' + e.message };
    }
    let nonWhite = 0;
    const total = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a === 0) continue; // transparent counts as blank
      if (r < 245 || g < 245 || b < 245) nonWhite++;
    }
    return { nonWhite, total, pct: (nonWhite / total) * 100 };
  });
  let tileNote = 'via canvas getImageData';
  let tileStats = pixelStats;
  if (pixelStats.error || pixelStats.pct === 0) {
    // WebGL canvases without preserveDrawingBuffer read back blank via drawImage.
    // Fall back: screenshot the map container and analyze its pixels in-page.
    tileNote = 'via element screenshot (canvas read back blank — likely WebGL preserveDrawingBuffer=false)';
    const shot = await page.locator('.map-container').first().screenshot();
    const dataUrl = 'data:image/png;base64,' + shot.toString('base64');
    tileStats = await page.evaluate(async (url) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const w = 100;
      const h = Math.max(1, Math.round((img.height / img.width) * 100));
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let nonWhite = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a === 0) continue;
        if (r < 245 || g < 245 || b < 245) nonWhite++;
      }
      return { nonWhite, total, pct: (nonWhite / total) * 100 };
    }, dataUrl);
  }
  if (tileStats.error) {
    assert('desktop map tiles rendered (>5% non-white)', false, tileStats.error);
  } else {
    assert(
      'desktop map tiles rendered (>5% non-white)',
      tileStats.pct > 5,
      `${tileStats.pct.toFixed(1)}% non-white (${tileStats.nonWhite}/${tileStats.total} sampled px, ${tileNote})`
    );
  }

  // 4. Screenshot the .map-card element
  const mapCard = page.locator('.map-card').first();
  if ((await mapCard.count()) > 0) {
    await mapCard.screenshot({ path: 'map-size-check.png' });
    console.log('Screenshot saved to map-size-check.png');
  } else {
    assert('.map-card exists for screenshot', false, 'not found');
  }
  await page.close();

  // ---- Mobile: 375x812 ----
  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  wireErrors(mobile);
  await mobile.addInitScript(() => localStorage.setItem('groma-theme', 'light'));

  await doSearch(mobile);
  console.log('Mobile: .race-card appeared; waiting 8s for map tiles...');
  await mobile.waitForTimeout(8000);

  const mbox = await mobile.locator('.map-container').first().boundingBox();
  if (!mbox) {
    assert('mobile .map-container has bounding box', false, 'boundingBox() returned null');
  } else {
    const mh = Math.round(mbox.height);
    assert('mobile .map-container height ~340px (320-360)', mh >= 320 && mh <= 360, `height=${mh}px, width=${Math.round(mbox.width)}px`);
  }
  await mobile.close();
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  results.push({ name: 'script completed without error', pass: false, extra: err.message });
} finally {
  await browser.close();
}

console.log(`\nConsole/page errors collected (favicon/ArcGIS ignored): ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n=== SUMMARY: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length} assertions passed) ===`);
process.exit(failed.length === 0 ? 0 : 1);
