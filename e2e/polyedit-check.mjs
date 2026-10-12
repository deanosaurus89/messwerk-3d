// Polygonbearbeitung: Register, gekoppelte Toleranz, Reduktion mit Live-Zähler, Abbrechen, Farbvergleich + Legende,
// magischer Radierer, Rückgängig/Original, danach Extraktion am bearbeiteten Netz.
// Aufruf: node e2e/polyedit-check.mjs [URL|-] [desktop|iphone] [screenshot.png]
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
const MODE = process.argv[3] || 'desktop', SHOT = process.argv[4];
if (!URL) { URL = 'http://localhost:8766/'; srv = spawn('npx', ['serve', '-l', '8766', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = MODE === 'desktop' ? await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }) : await webkit.launch();
const ctx = await browser.newContext(MODE === 'desktop' ? { viewport: { width: 1600, height: 950 } } : { ...devices['iPhone 14 Pro'] });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const S = (f, a) => page.evaluate(f, a);
const tris = () => S(() => window.__app.state.data.triCount);
const click = (sel) => S((s) => document.querySelector(s).click(), sel);
try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#btn-sample'); await page.click('.sample-card[data-key="beispielteil"]');
  await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 });
  const t0 = await tris(); console.log('Original', t0, 'Dreiecke');
  await click('.tab[data-tab="poly"]'); await click('[data-pe="reduce"]');
  await page.waitForSelector('#pe-tol-n', { state: 'attached' });
  // gekoppelt: Zahl -> Regler, Regler -> Zahl
  await S(() => { const n = document.querySelector('#pe-tol-n'); n.value = '0.1'; n.dispatchEvent(new Event('input')); });
  const r1 = await S(() => document.querySelector('#pe-tol-r').value);
  await S(() => { const r = document.querySelector('#pe-tol-r'); r.value = '500'; r.dispatchEvent(new Event('input')); });
  const n1 = await S(() => [document.querySelector('#pe-tol-n').value, window.__app.pe.tol]);
  console.log('Kopplung: 0.1 mm -> Regler', r1, '; Regler 500 ->', n1);
  if (r1 !== '667' || n1[0] !== '0.032' || n1[1] !== 0.032) fail('Toleranz nicht gekoppelt');
  // Abbrechen
  await click('[data-pe="subdiv"]'); await S(() => { document.querySelector('#pe-lv').value = '2'; document.querySelector('#pe-lv').dispatchEvent(new Event('change')); });
  await click('#pe-run'); await sleep(300); await page.waitForSelector('#pe-cancel', { state: 'attached' }); await click('#pe-cancel');
  await page.waitForFunction(() => /Abgebrochen/.test(document.querySelector('#pe-live').textContent));
  if ((await tris()) !== t0) fail('Abbrechen hat Netz verändert');
  // Reduktion mit Live-Zähler
  await click('[data-pe="reduce"]');
  await S(() => { const n = document.querySelector('#pe-tol-n'); n.value = '0.05'; n.dispatchEvent(new Event('input')); });
  const lives = []; await click('#pe-run');
  const tick = setInterval(async () => { try { lives.push(await S(() => document.querySelector('#pe-live')?.textContent)); } catch {} }, 150);
  await page.waitForFunction((t0) => window.__app.state.data.triCount < t0 && !window.__app.pe.running, t0, { timeout: 180000 });
  clearInterval(tick);
  const t1 = await tris(); console.log('Reduktion 0,05 mm:', t0, '->', t1, `(${(100 * t1 / t0).toFixed(1)} %)`, '| live:', [...new Set(lives.filter((x) => /Läuft/.test(x || '')))].slice(0, 4).join(' | '));
  // Farbvergleich
  await click('#btn-pe-cmp');
  await page.waitForFunction(() => window.__app.pe.dev && document.querySelector('#dev-legend'), null, { timeout: 60000 });
  const st = await S(() => window.__app.pe.devStats); console.log('Farbvergleich max', st);
  if (Math.max(st.maxPos, -st.maxNeg) > 0.0501) fail('Abweichung > Toleranz');
  // Radierer: Klick/Tap in Bildmitte
  await click('[data-pe="erase"]');
  const box = await S(() => { const r = window.__app.viewer.renderer.domElement.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const before = await tris(); await sleep(700); // Dialog-Schublade schließt animiert
  if (MODE === 'desktop') await page.mouse.click(box[0], box[1]); else await page.touchscreen.tap(box[0], box[1]);
  await page.waitForFunction(() => /Loch geschlossen|nicht gefüllt|Nichts/.test(document.querySelector('#pe-live').textContent), null, { timeout: 60000 }).catch(() => fail('Radierer ohne Wirkung'));
  console.log('Radierer:', await S(() => document.querySelector('#pe-live').textContent));
  await page.waitForFunction(() => window.__app.pe.dev && document.querySelector('#busy').classList.contains('hidden'), null, { timeout: 60000 });
  if (SHOT) { await sleep(500); await page.screenshot({ path: SHOT }); console.log('Screenshot', SHOT); }
  await click('#btn-pe-undo'); await page.waitForFunction((b) => window.__app.state.data.triCount === b, before, { timeout: 30000 }).catch(() => fail('Rückgängig'));
  // Extraktion am bearbeiteten Netz
  await click('#pe-exit'); await click('.tab[data-tab="merkmale"]'); await click('[data-ftype="auto"]');
  const xy = await S(() => { const { viewer } = window.__app; viewer.view('iso'); const v = viewer.camera.position.clone().set(20, 26.04, 17).project(viewer.camera); const r = viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
  if (MODE === 'desktop') await page.mouse.click(xy[0], xy[1]); else await page.touchscreen.tap(xy[0], xy[1]);
  await page.waitForFunction(() => window.__app.state.preview, null, { timeout: 30000 }).catch(() => fail('Extraktion nach Bearbeitung'));
  console.log('Extraktion am reduzierten Netz:', await S(() => { const p = window.__app.state.preview; return p && `${p.fit.type} n=${p.indices.length} rms=${p.fit.rms.toFixed(4)}`; }));
  await click('.tab[data-tab="poly"]'); await click('#btn-pe-reset');
  await page.waitForFunction((t0) => window.__app.state.data.triCount === t0, t0, { timeout: 30000 }).catch(() => fail('Original wiederherstellen'));
  const vis = await S(() => { const r = window.__app.viewer.renderer.domElement.getBoundingClientRect(); return [r.width, r.height]; });
  console.log('3D-Ansicht', vis); if (vis[0] < 100 || vis[1] < 100) fail('3D-Ansicht nicht sichtbar');
} catch (e) { fail(String(e)); }
const errs = errors.filter((e) => !/NotFoundError/.test(e));
if (errs.length) fail('Konsole: ' + errs.join(' | '));
console.log(process.exitCode ? 'FEHLGESCHLAGEN' : 'OK', MODE);
await browser.close(); srv?.kill();
