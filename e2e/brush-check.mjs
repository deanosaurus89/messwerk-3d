// Pinsel: Modusanzeige, Malen, Radieren (Shift/Knopf), Rückgängig (Strg+Z/Knopf), Auswahl löschen, Esc, danach Klick-Extraktion.
// Aufruf: node e2e/brush-check.mjs [URL|-] [desktop|iphone]
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
const MODE = process.argv[3] || 'desktop'; const P = MODE;
if (!URL) { URL = 'http://localhost:8765/'; srv = spawn('npx', ['serve', '-l', '8765', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = MODE === 'desktop' ? await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }) : await webkit.launch();
const ctx = await browser.newContext(MODE === 'desktop' ? { viewport: { width: 1600, height: 950 } } : { ...devices['iPhone 14 Pro'] });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const synthetic = (e) => /NotFoundError/.test(e) && MODE !== 'desktop'; // synthetische Touch-PointerEvents (Pointer-Capture unbekannter ID)
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const S = (f, a) => page.evaluate(f, a);
const count = () => S(() => window.__app.state.brushCount);
const scr = (p) => S((p) => { const { viewer } = window.__app; const v = viewer.camera.position.clone().set(...p).project(viewer.camera); const r = viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, p);
// Strich von a nach b (Weltpunkte) – Desktop: Maus, iPhone: Touch-PointerEvents
async function stroke(a, b, shift = false) {
  const A = await scr(a), B = await scr(b);
  if (MODE === 'desktop') {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(A[0], A[1]); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(A[0] + (B[0] - A[0]) * i / 12, A[1] + (B[1] - A[1]) * i / 12); await sleep(60); }
    await page.mouse.up(); if (shift) await page.keyboard.up('Shift');
  } else {
    await S(async ([A, B]) => { const c = window.__app.viewer.renderer.domElement; const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, bubbles: true, pointerId: 7 }));
      ev('pointerdown', A[0], A[1]); for (let i = 1; i <= 12; i++) { ev('pointermove', A[0] + (B[0] - A[0]) * i / 12, A[1] + (B[1] - A[1]) * i / 12); await new Promise((r) => setTimeout(r, 60)); }
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: B[0], clientY: B[1], pointerType: 'touch', isPrimary: true, bubbles: true, pointerId: 7 })); }, [A, B]);
  }
  await sleep(500);
}
try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#btn-sample'); await page.click('.sample-card[data-key="beispielteil"]');
  await page.waitForFunction(() => window.__app.state.data, null, { timeout: 60000 });
  await page.click('.tab[data-tab="merkmale"]'); await page.click('[data-ftype="Ebene"]');
  await S(() => window.__app.viewer.view('+Z')); await sleep(300);
  const bar = await page.textContent('#mode-bar'); if (!/Klick/.test(bar)) fail('Modusanzeige Klick fehlt: ' + bar);
  await page.click('#mode-bar [data-a="brush"]');
  if (!/Pinsel/.test(await page.textContent('#mode-bar'))) fail('Modusanzeige Pinsel fehlt');
  await stroke([60, 40, 20], [95, 50, 20]); const c1 = await count();
  await stroke([60, 10, 20], [95, 20, 20]); const c2 = await count();
  console.log('Gemalt:', c1, '→', c2);
  if (!(c1 > 50 && c2 > c1)) fail('Malen ohne Wirkung');
  await page.screenshot({ path: `docs/${P}-pinsel-modusanzeige.png` });
  // Radieren
  if (MODE === 'desktop') await stroke([60, 10, 20], [95, 20, 20], true);
  else { await page.click('#mode-bar [data-a="erase"]'); await stroke([60, 10, 20], [95, 20, 20]); await page.click('#mode-bar [data-a="paint"]'); }
  const c3 = await count(); console.log('Nach Radieren:', c3); if (!(c3 < c2)) fail('Radieren ohne Wirkung');
  // Rückgängig (Strg+Z bzw. Knopf) stellt den radierten Strich wieder her
  if (MODE === 'desktop') await page.keyboard.press('Control+z'); else await page.click('#mode-bar [data-a="undo"]');
  await sleep(200); const c4 = await count(); console.log('Nach Rückgängig:', c4); if (c4 !== c2) fail(`Rückgängig: ${c4} statt ${c2}`);
  await page.click('#mode-bar [data-a="undo"]'); await sleep(200); if (await count() !== c1) fail('2. Rückgängig falsch');
  // Fitten aus Pinsel funktioniert
  await page.click('#mode-bar [data-a="fit"]'); await page.waitForFunction(() => window.__app.state.preview?.method === 'Pinsel', null, { timeout: 30000 });
  await page.click('#pc-discard');
  // Auswahl löschen (prominenter Knopf)
  await page.click('#mode-bar [data-a="clear"]'); if (await count() !== 0) fail('Auswahl löschen ohne Wirkung');
  await page.screenshot({ path: `docs/${P}-pinsel-auswahl-geloescht.png` });
  // Esc: erst Auswahl löschen, dann zurück zu Klick (Desktop)
  await stroke([60, 40, 20], [95, 50, 20]);
  if (MODE === 'desktop') {
    await page.keyboard.press('Escape'); if (await count() !== 0) fail('Esc löscht Auswahl nicht');
    await page.keyboard.press('Escape'); if ((await S(() => window.__app.state.mode?.method)) !== 'Klick') fail('2. Esc → Klick fehlt');
    await page.click('#mode-bar [data-a="brush"]'); await stroke([60, 40, 20], [95, 50, 20]);
  }
  // Szenario Martin: Markierung bleibt stehen, neuer Typ im Menüband → Klick-Extraktion muss funktionieren
  if ((await count()) === 0) fail('Vorbedingung: Markierung');
  await page.click('[data-ftype="Zylinder"]');
  const st = await S(() => ({ m: window.__app.state.mode.method, n: window.__app.state.brushCount }));
  if (st.m !== 'Klick' || st.n !== 0) fail('Typwechsel lässt Pinsel/Markierung stehen: ' + JSON.stringify(st));
  await S(() => window.__app.viewer.view('iso')); await sleep(300);
  const xy = await scr([20, 26.04, 15]);
  MODE === 'desktop' ? await page.mouse.click(xy[0], xy[1]) : await page.touchscreen.tap(xy[0], xy[1]);
  await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 30000 });
  const pv = await S(() => ({ t: window.__app.state.preview.fit.type, d: window.__app.state.preview.fit.diameter }));
  console.log('Klick nach Pinsel:', JSON.stringify(pv)); if (pv.t !== 'Zylinder' || Math.abs(pv.d - 12.08) > 0.05) fail('Klick-Extraktion nach Pinsel blockiert');
} catch (e) { fail(e.stack || e); }
const real = errors.filter((e) => !synthetic(e)); console.log('Konsolenfehler:', real.length ? real : 'keine'); if (real.length) process.exitCode = 1;
await browser.close(); srv?.kill();
