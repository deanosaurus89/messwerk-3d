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
  // Radierer: Unebenheit in Bildmitte mit dem Pinsel markieren, dann „Entfernen & füllen“
  await click('[data-pe="erase"]');
  const box = await S(() => { const r = window.__app.viewer.renderer.domElement.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const before = await tris(); await sleep(700);
  await S(async ([x, y, touch]) => { const c = window.__app.viewer.renderer.domElement; const ev = (t, X, Y, tgt = c) => tgt.dispatchEvent(new PointerEvent(t, { clientX: X, clientY: Y, pointerType: touch ? 'touch' : 'mouse', button: 0, isPrimary: true, bubbles: true, pointerId: 9 }));
    ev('pointerdown', x, y); for (let i = 1; i <= 8; i++) { ev('pointermove', x + i * 3, y); await new Promise((r) => setTimeout(r, 80)); } ev('pointerup', x + 24, y, window); }, [box[0], box[1], MODE !== 'desktop']);
  await page.waitForFunction(() => /Ausgewählt/.test(document.querySelector('#pe-live')?.textContent || ''), null, { timeout: 20000 }).catch(() => fail('Radierer-Pinsel markiert nichts'));
  await click('#mode-bar [data-a="pe-go"]');
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
  await page.waitForFunction((t0) => window.__app.state.data.triCount === t0, t0, { timeout: 30000 });
  // Kurvennetz: erkennen, Layout, Kurve zeichnen, Persistenz
  await click('#btn-curve-detect');
  await page.waitForFunction(() => window.__app.state.curves.length > 0 && window.__app.state.layout, null, { timeout: 60000 }).catch(() => fail('Kurvenerkennung'));
  const cinfo = await S(() => { const s = window.__app.state; return { n: s.curves.length, kanten: s.curves.filter((c) => c.kind === 'Kante').length, tangenten: s.curves.filter((c) => c.kind === 'Tangente').length, patches: s.layout.regions.length, vier: s.layout.foursided, t: s.layout.tJunctions }; });
  console.log('Kurvennetz:', JSON.stringify(cinfo));
  await click('#btn-curve-layout'); await sleep(400);
  if (SHOT) { await page.screenshot({ path: SHOT.replace('.png', '-kurvennetz.png') }); console.log('Screenshot', SHOT.replace('.png', '-kurvennetz.png')); }
  await click('#btn-curve-draw'); await sleep(700);
  const pts = await S(() => { const { viewer } = window.__app; const r = viewer.renderer.domElement.getBoundingClientRect(); return [[r.left + r.width * 0.42, r.top + r.height * 0.5], [r.left + r.width * 0.58, r.top + r.height * 0.55]]; });
  for (const [x, y] of pts) { if (MODE === 'desktop') await page.mouse.click(x, y); else await page.touchscreen.tap(x, y); await sleep(300); }
  const nd = await S(() => document.querySelector('#mode-bar').textContent);
  await click('#mode-bar [data-a="ok"]');
  await page.waitForFunction(() => window.__app.state.curves.some((c) => c.kind === 'Benutzer'), null, { timeout: 30000 }).catch(() => fail('Benutzerkurve: ' + nd));
  const nBefore = await S(() => window.__app.state.curves.length);
  await S(() => window.__app.roundtrip());
  const nAfter = await S(() => [window.__app.state.curves.length, document.querySelectorAll('.curve-node').length]);
  console.log('Persistenz Kurven:', nBefore, '->', nAfter); if (nAfter[0] !== nBefore || nAfter[1] !== nBefore) fail('Kurven nicht gespeichert/geladen');
  const vis = await S(() => { const r = window.__app.viewer.renderer.domElement.getBoundingClientRect(); return [r.width, r.height]; });
  console.log('3D-Ansicht', vis); if (vis[0] < 100 || vis[1] < 100) fail('3D-Ansicht nicht sichtbar');
} catch (e) { fail(String(e)); }
const errs = errors.filter((e) => !/NotFoundError/.test(e));
if (errs.length) fail('Konsole: ' + errs.join(' | '));
console.log(process.exitCode ? 'FEHLGESCHLAGEN' : 'OK', MODE);
await browser.close(); srv?.kill();
