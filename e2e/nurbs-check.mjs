// Freiformfläche (B-Spline) am Freiform-Demoteil: Klick → Vorschau (Fläche, Randkurven, Kontrollnetz, Farbkarte) → Erzeugen →
// Eigenschaften (Kontrollpunkte/Grad/Glättung, Auto-Neu-Fit) → Prüfmerkmale Flächenprofil + Std.-Abw. → Export IGES/STEP/JSON → Pinsel.
// Aufruf: node e2e/nurbs-check.mjs [URL|-] [desktop|iphone]
import { chromium, webkit, devices } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
const URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : 'http://localhost:8766/';
const MODE = process.argv[3] || 'desktop'; const touch = MODE !== 'desktop';
const browser = MODE === 'desktop' ? await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }) : await webkit.launch();
const ctx = await browser.newContext({ ...(MODE === 'desktop' ? { viewport: { width: 1600, height: 950 } } : devices['iPhone 14 Pro']), acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const S = (f, a) => page.evaluate(f, a);
const Zf = (x, y) => 20 + Math.sin(Math.PI * x / 70) * (17 + 3 * Math.cos(2 * Math.PI * y / 80) + 2.5 * y / 80);
const screenOf = (p) => S((p) => { const { viewer } = window.__app; const q = viewer.camera.position.clone().set(...p).project(viewer.camera);
  const r = viewer.renderer.domElement.getBoundingClientRect(); return [Math.floor(r.left + (q.x + 1) / 2 * r.width), Math.floor(r.top + (1 - q.y) / 2 * r.height)]; }, p);
const tap = async (xy) => (touch ? page.touchscreen.tap(xy[0], xy[1]) : page.mouse.click(xy[0], xy[1]));
/** Genauigkeit der Fläche gegen die Formel (an Flächenpunkten, Rand 3 % ausgenommen). */
const accuracy = (fit) => S((fit) => window.__app.nurbsAccuracy(fit), fit);
try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#btn-sample'); await page.click('.sample-card[data-key="freiform"]');
  await page.waitForFunction(() => window.__app.state.data?.name === 'freiform', null, { timeout: 180000 });
  await page.click('.tab[data-tab="merkmale"]'); await page.click('#btn-feat-more'); await page.click('[data-ftype="Freiformfläche"]');
  await S(() => window.__app.viewer.viewDir([0.35, -1, 1.3])); await sleep(500);
  const hitP = [35, 40, Zf(35, 40)]; await tap(await screenOf(hitP));
  await page.waitForFunction(() => window.__app.state.preview?.fit?.nurbs, null, { timeout: 90000 });
  let pv = await S(() => { const p = window.__app.state.preview; return { n: p.indices.length, kind: p.fit.nurbs.kind, curves: p.fit.nurbs.boundary.length, std: p.fit.nurbs.std, form: p.fit.form, hit: p.hit?.point }; });
  console.log('Vorschau:', JSON.stringify(pv));
  if (pv.kind !== 'vierseitig' || pv.curves !== 4 || !(pv.std < 0.012)) fail('Vorschau Freiformfläche');
  let acc = await accuracy(await S(() => window.__app.state.preview.fit)); console.log('Genauigkeit gegen Formel (Vorschau):', JSON.stringify(acc));
  if (!(acc.max < 0.01)) fail('Fläche weicht von bekannter Fläche ab');
  await sleep(300); await page.screenshot({ path: `docs/${MODE}-freiform-vorschau.png` });
  await page.click('#pc-create');
  await page.waitForFunction(() => window.__app.state.features.some((f) => f.type === 'Freiformfläche'), null, { timeout: 20000 });
  // Eigenschaften: Kontrollpunkte ändern → automatisch neu
  await page.keyboard.press('Escape').catch(() => {}); await S(() => { const { state } = window.__app; state.mode = null; state.sel = [state.features.find((f) => f.type === 'Freiformfläche').id]; window.__app.renderAll(); });
  if (touch) await S(() => window.__app.togglePanel('dialog', true));
  await page.waitForSelector('#nb-nu');
  const sig = () => S(() => JSON.stringify(window.__app.state.features.find((f) => f.type === 'Freiformfläche').measured.nurbs.surface.nu));
  await page.fill('#nb-nu', '6'); await page.locator('#nb-nu').evaluate((e) => e.dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForFunction(() => window.__app.state.features.find((f) => f.type === 'Freiformfläche').measured.nurbs.surface.nu === 6, null, { timeout: 60000 });
  const f6 = await S(() => { const f = window.__app.state.features.find((f) => f.type === 'Freiformfläche'); return { std: f.measured.nurbs.std, form: f.measured.form }; });
  await page.fill('#nb-nu', '12'); await page.locator('#nb-nu').evaluate((e) => e.dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForFunction(() => window.__app.state.features.find((f) => f.type === 'Freiformfläche').measured.nurbs.surface.nu === 12, null, { timeout: 60000 });
  await page.selectOption('#nb-deg', '2');
  await page.waitForFunction(() => window.__app.state.features.find((f) => f.type === 'Freiformfläche').measured.nurbs.surface.degU === 2, null, { timeout: 60000 });
  await page.selectOption('#nb-deg', '3');
  await page.waitForFunction(() => window.__app.state.features.find((f) => f.type === 'Freiformfläche').measured.nurbs.surface.degU === 3, null, { timeout: 60000 });
  const ff = await S(() => { const f = window.__app.state.features.find((f) => f.type === 'Freiformfläche'); return { name: f.name, n: f.pointCount, std: f.measured.nurbs.std, form: f.measured.form, fit: f.measured }; });
  console.log('6×12 Kontrollpunkte: Std.-Abw.', f6.std.toFixed(4), '→ 12×12:', ff.std.toFixed(4), '| Flächenprofil', ff.form.toFixed(4));
  if (!(f6.std > ff.std)) fail('Weniger Kontrollpunkte sollte gröber sein');
  acc = await accuracy(ff.fit); console.log('Genauigkeit gegen Formel (Merkmal):', JSON.stringify(acc)); if (!(acc.max < 0.01)) fail('Genauigkeit Merkmal');
  // Prüfmerkmale Flächenprofil + Std.-Abw.
  await S(() => { const { state } = window.__app; const f = state.features.find((x) => x.type === 'Freiformfläche'); state.addFeat = f.id; state.ctab = 'katalog'; window.__app.renderAll(); });
  if (touch) await S(() => window.__app.togglePanel('table', true));
  for (const k of ['Form', 'Std.-Abw.']) await page.locator(`#catalog .cat-item[data-kind="${k}"] input[type=checkbox]`).check();
  const ctr = await S(() => { const { state, evaluate } = window.__app; const fm = new Map(state.features.map((f) => [f.id, f])); return state.controls.map((c) => c.kind + '=' + evaluate(c, fm, window.__app.ctx()).measured?.toFixed(4)); });
  console.log('Prüfmerkmale:', ctr.join(', ')); if (ctr.length < 2) fail('Prüfmerkmale fehlen');
  if (touch) await S(() => window.__app.togglePanel('dialog', true));
  // Export
  for (const [b, ext] of [['#nb-igs', 'igs'], ['#nb-stp', 'stp'], ['#nb-json', 'json']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(b)]);
    const path = `/workspace/tmp-nurbs/live-${MODE}.${ext}`; await dl.saveAs(path);
    const txt = readFileSync(path, 'utf8'); console.log(`Export ${ext}: ${txt.length} Bytes`);
    if (ext === 'igs' && !/ 128 /.test(txt.split('\n').find((l) => l[72] === 'D') ?? '')) fail('IGES ohne Entity 128');
    if (ext === 'stp' && !txt.includes('B_SPLINE_SURFACE_WITH_KNOTS')) fail('STEP ohne Fläche');
  }
  // Screenshot Merkmal ausgewählt (Farbkarte, Randkurven, Kontrollnetz)
  if (touch) await S(() => window.__app.togglePanel('dialog', false));
  await S(() => window.__app.viewer.viewDir([0.35, -1, 1.3])); await sleep(500);
  await page.screenshot({ path: `docs/${MODE}-freiform-merkmal.png` });
  if (touch) { await S(() => window.__app.togglePanel('dialog', true)); await page.locator('#fp-box').scrollIntoViewIfNeeded(); await page.screenshot({ path: `docs/${MODE}-freiform-eigenschaften.png` }); await S(() => window.__app.togglePanel('dialog', false)); }
  // Pinsel: Teilbereich (getrimmtes oder vierseitiges Patch)
  await page.click('#btn-feat-more'); await page.click('[data-ftype="Freiformfläche"]'); await page.click('#mode-bar [data-a="brush"]');
  await S(() => { window.__app.state.opts.brush = 6; });
  const pts = [[20, 25], [30, 30], [40, 35], [45, 45], [35, 50], [25, 45]].map(([x, y]) => [x, y, Zf(x, y)]);
  for (const p of pts) { const xy = await screenOf(p); if (touch) await page.touchscreen.tap(xy[0], xy[1]); else { await page.mouse.move(xy[0], xy[1]); await page.mouse.down(); await page.mouse.move(xy[0] + 3, xy[1] + 3, { steps: 3 }); await page.mouse.up(); } await sleep(150); }
  const bc = await S(() => window.__app.state.brushCount); console.log('Pinsel:', bc, 'Punkte');
  await page.click('#mode-bar [data-a="fit"]');
  await page.waitForFunction(() => window.__app.state.preview?.fit?.nurbs, null, { timeout: 60000 });
  pv = await S(() => { const p = window.__app.state.preview; return { n: p.indices.length, kind: p.fit.nurbs.kind, curves: p.fit.nurbs.boundary.length, std: p.fit.nurbs.std }; });
  acc = await accuracy(await S(() => window.__app.state.preview.fit));
  console.log('Pinsel-Vorschau:', JSON.stringify(pv), 'Genauigkeit:', JSON.stringify(acc));
  if (!(pv.std < 0.015 && pv.curves === 1 && acc.max < 0.1)) fail('Pinsel-Freiform');
  await page.screenshot({ path: `docs/${MODE}-freiform-pinsel.png` });
} catch (e) { fail(e.stack || e); }
console.log('Konsolenfehler:', errors.length ? errors : 'keine'); if (errors.length) process.exitCode = 1;
await browser.close();
