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

const browser = await chromium.launch({ headless: true });

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  wireErrorCapture(page, 'i18n');

  // ===================== 1. Fresh load =====================
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('groma-theme', 'light');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // ===================== 2. Language switcher =====================
  const langToggle = page.locator('.lang-toggle');
  const toggleCount = await langToggle.count();
  assert('lang switcher: .lang-toggle button exists', toggleCount > 0, `count=${toggleCount}`);

  const toggleBox = await langToggle.first().boundingBox().catch(() => null);
  assert(
    'lang switcher: .lang-toggle is in top-right',
    toggleBox && toggleBox.x > 640 && toggleBox.y < 200,
    toggleBox ? `x=${Math.round(toggleBox.x)}, y=${Math.round(toggleBox.y)}` : 'no bounding box',
  );

  await langToggle.first().click();
  await page.waitForSelector('.lang-menu', { timeout: 5000 }).catch(() => {});
  const menuCount = await page.locator('.lang-menu').count();
  assert('lang switcher: .lang-menu appears on click', menuCount > 0, `count=${menuCount}`);

  const menuText = menuCount ? (await page.locator('.lang-menu').first().textContent()) || '' : '';
  for (const label of ['English', 'Español', 'Tiếng Việt', '中文']) {
    assert(`lang switcher: menu lists "${label}"`, menuText.includes(label));
  }

  await page.locator('.lang-menu button', { hasText: 'Español' }).first().click();
  await page.waitForTimeout(1000);

  // ===================== 3. UI in Spanish =====================
  const heroText =
    (await page.locator('.hero h1, .hero-headline, h1').first().textContent().catch(() => '')) || '';
  assert(
    'spanish UI: hero headline contains "Conozca su boleta"',
    heroText.includes('Conozca su boleta'),
    `h1="${heroText.trim().slice(0, 80)}"`,
  );

  const ctaText =
    (await page.getByRole('button', { name: /Buscar mi boleta/ }).first().textContent().catch(() => '')) || '';
  assert('spanish UI: CTA button reads "Buscar mi boleta"', ctaText.includes('Buscar mi boleta'), `cta="${ctaText.trim()}"`);

  const trustText = (await page.locator('.trust-row').first().textContent().catch(() => '')) || '';
  assert(
    'spanish UI: trust row contains "Datos electorales oficiales"',
    trustText.includes('Datos electorales oficiales'),
    `trust="${trustText.trim().replace(/\s+/g, ' ').slice(0, 120)}"`,
  );

  await page.screenshot({ path: 'i18n-landing-es.png' });
  console.log('Saved i18n-landing-es.png');

  // ===================== 4. Persistence =====================
  const storedLang = await page.evaluate(() => localStorage.getItem('groma-lang'));
  assert("persistence: localStorage 'groma-lang' === 'es'", storedLang === 'es', `value=${storedLang}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const heroAfterReload =
    (await page.locator('.hero h1, .hero-headline, h1').first().textContent().catch(() => '')) || '';
  assert(
    'persistence: headline still Spanish after reload',
    heroAfterReload.includes('Conozca su boleta'),
    `h1="${heroAfterReload.trim().slice(0, 80)}"`,
  );

  // ===================== 5. Search in Spanish =====================
  await page.getByPlaceholder('Código postal').fill('23219');
  await page.getByPlaceholder(/Dirección/).fill('1000 Bank St, Richmond, VA');
  await page.getByRole('button', { name: /Buscar mi boleta/ }).click();
  await page.waitForSelector('.race-card', { timeout: 30000 });
  await page.waitForTimeout(2000);

  const mastheadText = (await page.locator('.masthead').first().textContent().catch(() => '')) || '';
  assert(
    'results: masthead contains "Información electoral oficial"',
    /Información electoral oficial/i.test(mastheadText),
    `masthead="${mastheadText.trim().replace(/\s+/g, ' ').slice(0, 140)}"`,
  );
  assert(
    'results: countdown label contains "días" or "día"',
    /días?\b/i.test(mastheadText),
  );

  const bodyText = (await page.locator('body').textContent()) || '';
  assert('results: races title reads "En su boleta"', bodyText.includes('En su boleta'));
  assert(
    'results: race name "Member, United States Senate" unchanged',
    bodyText.includes('Member, United States Senate'),
  );
  assert('results: candidate name "Bert Mizusawa" unchanged', bodyText.includes('Bert Mizusawa'));
  for (const h of ['Lugares de votación', 'Votación anticipada', 'Entrega de boletas']) {
    assert(`results: sidebar header "${h}" exists`, bodyText.includes(h));
  }

  // ===================== 6. AI briefing in Spanish =====================
  // Find the race card containing the Senate race + Bert Mizusawa
  const senateCard = page
    .locator('.race-card', { hasText: 'Member, United States Senate' })
    .first();
  const briefingToggle = senateCard
    .locator('.collapse-toggle', { hasText: 'Resumen de candidatos' })
    .first();
  const briefingToggleCount = await briefingToggle.count();
  assert('briefing: "Resumen de candidatos" toggle exists on Senate card', briefingToggleCount > 0);

  let briefingText = '';
  if (briefingToggleCount > 0) {
    await briefingToggle.click();
    const briefingPanel = senateCard.locator('.briefing .panel-text').first();
    try {
      await briefingPanel.waitFor({ state: 'visible', timeout: 90000 });
      // wait until it has real content
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        briefingText = ((await briefingPanel.textContent().catch(() => '')) || '').trim();
        if (briefingText.length > 50) break;
        await page.waitForTimeout(1000);
      }
    } catch {
      briefingText = '';
    }
  }
  assert(
    'briefing: Spanish text present (matches /candidato|Partido|información/i)',
    /candidato|Partido|información/i.test(briefingText),
    `len=${briefingText.length}`,
  );
  assert('briefing: still contains "Bert Mizusawa" unchanged', briefingText.includes('Bert Mizusawa'));

  const senateCardText = (await senateCard.textContent().catch(() => '')) || '';
  assert(
    'briefing: disclaimer contains "el texto oficial de la boleta es el que rige"',
    senateCardText.includes('el texto oficial de la boleta es el que rige'),
  );
  console.log(`\nSPANISH BRIEFING (first 200 chars):\n${briefingText.slice(0, 200)}\n`);

  // ===================== 7. Office context in Spanish =====================
  const aboutToggle = senateCard
    .locator('.collapse-toggle', { hasText: 'Sobre este cargo' })
    .first();
  const aboutCount = await aboutToggle.count();
  assert('office context: "Sobre este cargo" toggle exists', aboutCount > 0);

  let aboutText = '';
  if (aboutCount > 0) {
    await aboutToggle.click();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      aboutText = (
        (await senateCard
          .locator('.collapse-body .panel-text')
          .last()
          .textContent()
          .catch(() => '')) || ''
      ).trim();
      // the briefing panel-text may match too; find one that isn't the briefing text
      const panels = await senateCard.locator('.panel-text').allTextContents().catch(() => []);
      const other = panels.map((p) => p.trim()).find((p) => p.length > 50 && p !== briefingText);
      if (other) {
        aboutText = other;
        break;
      }
      await page.waitForTimeout(1000);
    }
  }
  assert('office context: Spanish text loaded', aboutText.length > 50, `len=${aboutText.length}`);
  console.log(`\n"SOBRE ESTE CARGO" (first 200 chars):\n${aboutText.slice(0, 200)}\n`);

  // ===================== 8. Make a plan in Spanish =====================
  await page.getByRole('button', { name: /Hacer mi plan de votación/ }).first().click();
  await page.waitForSelector('.modal', { timeout: 10000 });
  await page.waitForTimeout(500);

  const modalHeader = (await page.locator('.modal .modal-header h3').first().textContent().catch(() => '')) || '';
  assert('plan: modal header "Paso 1 de 3"', modalHeader.includes('Paso 1 de 3'), `header="${modalHeader.trim()}"`);

  const stepQ = (await page.locator('.modal .mp-step h4').first().textContent().catch(() => '')) || '';
  assert('plan: question "¿Qué día votará?"', stepQ.includes('¿Qué día votará?'), `q="${stepQ.trim()}"`);

  const dayCardsText = (await page.locator('.modal .mp-days').first().textContent().catch(() => '')) || '';
  assert(
    'plan: day cards show "Día de las elecciones" badge (case-insensitive)',
    /día de las elecciones/i.test(dayCardsText),
    `sample="${dayCardsText.trim().replace(/\s+/g, ' ').slice(0, 100)}"`,
  );

  await page.locator('.modal .mp-daycard').first().click();
  await page.locator('.modal button', { hasText: 'Siguiente' }).click();
  await page.waitForTimeout(300);
  await page.locator('.modal .chip', { hasText: 'Mañana' }).first().click();
  await page.locator('.modal button', { hasText: 'Siguiente' }).click();
  await page.waitForTimeout(300);
  await page.locator('.modal .chip', { hasText: 'En auto' }).first().click();
  await page.locator('.modal button', { hasText: 'Crear mi plan' }).click();
  await page.waitForTimeout(800);

  const modalResultText = (await page.locator('.modal').first().textContent().catch(() => '')) || '';
  assert('plan result: contains "Usted votará el"', modalResultText.includes('Usted votará el'));
  assert(
    'plan result: contains Spanish weekday (martes)',
    /martes|lunes|miércoles|jueves|viernes|sábado|domingo/i.test(modalResultText),
    `sample="${modalResultText.trim().replace(/\s+/g, ' ').slice(0, 160)}"`,
  );

  await page.locator('.modal').first().screenshot({ path: 'i18n-plan-es.png' });
  console.log('Saved i18n-plan-es.png');

  // ===================== 9. Switch back to English =====================
  await page.locator('.modal .modal-close').first().click().catch(async () => {
    await page.keyboard.press('Escape');
  });
  await page.waitForTimeout(500);
  if (await page.locator('.modal').first().isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  await page.locator('.lang-toggle').first().click();
  await page.waitForSelector('.lang-menu', { timeout: 5000 });
  await page.locator('.lang-menu button', { hasText: 'English' }).first().click();
  await page.waitForTimeout(1500);

  const bodyEn = (await page.locator('body').textContent()) || '';
  assert('switch back: races title flips to "On your ballot"', bodyEn.includes('On your ballot'));

  // Briefings should re-fetch in English: look for loading or ready state
  const senateCardEn = page
    .locator('.race-card', { hasText: 'Member, United States Senate' })
    .first();
  let briefingEnState = '';
  const deadlineEn = Date.now() + 30000;
  while (Date.now() < deadlineEn) {
    const cardText = (await senateCardEn.textContent().catch(() => '')) || '';
    if (/Generating your briefing|Researching/i.test(cardText)) {
      briefingEnState = 'loading';
    }
    const panels = await senateCardEn.locator('.panel-text').allTextContents().catch(() => []);
    const ready = panels.map((p) => p.trim()).find((p) => p.length > 50);
    if (ready && !/candidato al Senado|información electoral/i.test(ready)) {
      briefingEnState = `ready (starts: "${ready.slice(0, 60)}")`;
      break;
    }
    if (briefingEnState === 'loading') break;
    await page.waitForTimeout(1000);
  }
  assert(
    'switch back: briefings show loading or ready state (re-fetched in English)',
    briefingEnState !== '',
    briefingEnState || 'no loading/ready state detected',
  );

  await ctx.close();
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
