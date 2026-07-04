import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });

// ---------- Check 1: Desktop map tiles ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => localStorage.setItem('groma-theme', 'light'));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.getByPlaceholder('ZIP code').fill('23219');
    await page.getByPlaceholder(/Street address/).fill('1000 Bank St, Richmond, VA');
    await page.getByRole('button', { name: 'Find my elections' }).click();

    await page.waitForSelector('.race-card', { timeout: 30000 });

    // Wait longer for map tiles to load
    await page.waitForTimeout(15000);

    const mapCard = page.locator('.map-card').first();
    await mapCard.scrollIntoViewIfNeeded();
    await mapCard.screenshot({ path: 'recheck-map.png' });
    console.log('Screenshot saved to recheck-map.png');

    const pct = await page.evaluate(() => {
      const src = document.querySelector('.map-container canvas');
      if (!src) return -1;
      const w = 200;
      const h = Math.max(1, Math.round((src.height / src.width) * w));
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const ctx = off.getContext('2d');
      ctx.drawImage(src, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let nonWhite = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] < 700) nonWhite++;
      }
      return (nonWhite / total) * 100;
    });

    if (pct < 0) {
      console.log('CHECK1 FAIL: .map-container canvas not found');
    } else {
      console.log(`CHECK1 non-white pixel percentage: ${pct.toFixed(2)}%`);
      console.log(`CHECK1 ${pct > 5 ? 'PASS' : 'FAIL'}: map canvas non-white pixels > 5%`);
    }
  } catch (err) {
    console.log(`CHECK1 FAIL: script error — ${err.message}`);
  } finally {
    await page.close();
  }
}

// ---------- Check 2: Mobile street input height ----------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => localStorage.setItem('groma-theme', 'light'));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.waitForSelector('.street-input', { timeout: 15000 });
    const box = await page.locator('.street-input').boundingBox();
    if (!box) {
      console.log('CHECK2 FAIL: .street-input bounding box not available');
    } else {
      console.log(`CHECK2 street input height: ${box.height.toFixed(2)}px`);
      const pass = box.height >= 30 && box.height <= 80;
      console.log(`CHECK2 ${pass ? 'PASS' : 'FAIL'}: height between 30 and 80 px`);
    }
  } catch (err) {
    console.log(`CHECK2 FAIL: script error — ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();
