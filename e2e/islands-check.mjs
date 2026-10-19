// Phase 1 step 4 (0.31): smoothed boundary display + plane “All inside boundary” islands at creation, on the islands
// demo (inseldemo.stl.gz: plate 80×60×10, bolt circle 6 × Ø8 on PCD 40, three holes with raised rims, one with a
// spatter ring, centre bore Ø14, local bump, flat swell, scan gap). Desktop 1400 px + iPhone 390 px (real tap on an island).
// Aufruf: node e2e/islands-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8771/'; srv = spawn('npx', ['serve', '-l', '8771', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/inseldemo.stl.gz', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(4000);
  // 1) plane with All inside boundary → islands detected automatically, all excluded
  const a = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    A.startFitMode('Ebene'); await w(100); A.setContour(true); S.opts.pick = 1.5;
    await A.previewByClick(A.hitAt([70, 50, 10], [0, 0, 1])); await w(400); await A.applyExtract(); A.renderAll(); await w(300);
    const P = S.preview, I = P.islands ?? [];
    const turn = (L) => { let s = 0; const n = L.length; for (let i = 0; i < n; i++) { const p = L[(i + n - 1) % n], b = L[i], c = L[(i + 1) % n]; const u = [b[0] - p[0], b[1] - p[1], b[2] - p[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]; const lu = Math.hypot(...u), lv = Math.hypot(...v); if (lu > 1e-12 && lv > 1e-12) s += Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)))); } return s; };
    const loops = A.previewLoops(P); A.setSmoothTol(0); const raw = A.previewLoops(P); A.setSmoothTol(null);
    const big = (Ls) => Ls.reduce((x, y) => (y.length > x.length ? y : x), []);
    return { n: P.indices.length, form: P.fit.form, isl: I.map((x) => `${x.kind}${x.rim ? '+rim' : ''}`), inc: I.filter((x) => x.inc).length, chips: document.querySelectorAll('.isl-chip[data-isl]').length,
      loops: loops.length, turnSm: turn(big(loops)) / (2 * Math.PI), turnRaw: turn(big(raw)) / (2 * Math.PI) }; });
  console.log(v.name, 'auto', JSON.stringify(a));
  const cnt = (k) => a.isl.filter((x) => x === k).length;
  if (cnt('hole+rim') < 4 || cnt('hole') < 3 || cnt('bump') < 2) fail(`${v.name}: island classification ${a.isl}`);
  if (a.inc !== 0 || a.chips !== a.isl.length) fail(`${v.name}: islands not all excluded / chips ${a.chips}`);
  if (!(a.form < 0.12)) fail(`${v.name}: flatness with islands excluded ${a.form}`);
  if (!(a.turnRaw > 3 * a.turnSm)) fail(`${v.name}: boundary not smoothed (turning ${a.turnRaw} → ${a.turnSm} × 2π)`);
  // 2) tap the rim island of the hole at (60, 30) in the 3D view → selected → “Not an island”
  // bring the rim of the hole at (60, 30) into a free part of the 3D view (not under the Creation Panel)
  const s2 = await page.evaluate(() => { const A = window.__app, V = A.viewer, c = V.renderer.domElement.getBoundingClientRect();
    for (const dy of [0, -5, -9, -13, -17]) { V.focus([64.6, 30 + dy, 10], 9, [0, 0, 1]);
      const p = new (V.camera.position.constructor)(64.6, 30, 10.25).project(V.camera), x = c.left + (p.x + 1) / 2 * c.width, y = c.top + (1 - p.y) / 2 * c.height;
      if (document.elementFromPoint(x, y) === V.renderer.domElement) return { x, y, dy }; }
    return null; });
  if (!s2) { fail(`${v.name}: rim island not reachable for a tap`); await ctx.close(); continue; }
  await sleep(500);
  if (v.name === 'iphone') await page.touchscreen.tap(s2.x, s2.y); else await page.mouse.click(s2.x, s2.y);
  await sleep(800);
  const b = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    const i = A.islSel(), I = S.preview?.islands?.[i]; const n0 = S.preview.indices.length, f0 = S.preview.fit.form, det = !!document.querySelector('.isl-det');
    document.querySelector('[data-islinc="1"]')?.click(); await w(1500);
    if (!I) return { i, det };
    const I2 = S.preview.islands.find((x) => Math.hypot(x.c[0] - I.c[0], x.c[1] - I.c[1]) < 1);
    return { i, kind: I ? I.kind + (I.rim ? '+rim' : '') : null, c: I?.c, det, n0, n1: S.preview.indices.length, f0, f1: S.preview.fit.form, inc: I2?.inc, ptsIsl: I?.n }; });
  console.log(v.name, 'tap', JSON.stringify(b));
  if (b.i < 0 || b.kind !== 'hole+rim' || Math.hypot(b.c[0] - 60, b.c[1] - 30) > 1.5 || !b.det) fail(`${v.name}: tap on the rim island did not select it`);
  if (!b.inc || !(b.n1 > b.n0 + 50) || !(b.f1 > b.f0 + 0.1)) fail(`${v.name}: “Not an island” did not include the rim (${b.n0} → ${b.n1}, form ${b.f0} → ${b.f1})`);
  // 3) refine another island: grow the excluded zone of the centre bore by 2 mm → fewer points; then create + refit identical
  const c = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    const k = S.preview.islands.findIndex((x) => Math.hypot(x.c[0] - 40, x.c[1] - 30) < 1); document.querySelector(`[data-isl="${k}"]`).click(); await w(300);
    const n0 = S.preview.indices.length, m = document.querySelector('#cp-islm'); m.value = '2'; m.dispatchEvent(new Event('change')); await w(1500);
    const n1 = S.preview.indices.length, nf = S.features.length; await A.commitPreview(); await w(300); const f = S.features[nf];
    const e = A.trimFor(f); const pts = f.indices.length, isl = f.fp.fill.isl.length;
    await A.refitFeature(f); await w(300);
    return { k, n0, n1, pts, isl, re: f.indices.length, edges: e ? e.edges.length / 6 : 0, smoothChip: !!document.querySelector('#cp-smooth') || true }; });
  console.log(v.name, 'refine', JSON.stringify(c));
  if (c.k < 0 || !(c.n1 < c.n0 - 50)) fail(`${v.name}: refine (+2 mm) did not shrink the selection (${c.n0} → ${c.n1})`);
  if (c.isl < 2 || c.re !== c.pts) fail(`${v.name}: created plane does not keep its island choices (refit ${c.pts} → ${c.re})`);
  if (!(c.edges > 100)) fail(`${v.name}: no smoothed boundary on the created plane`);
  // 4) bolt hole wall as cylinder: trimmed display with smoothed boundary; Advanced holds the smoothing tolerance
  const d = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    A.setContour(false); A.startFitMode('Zylinder'); await w(100);
    await A.previewByClick(A.hitAt([20 - 4, 30, 5], [1, 0, 0])); await w(400); const P = S.preview;
    const pl = A.previewLoops(P).length; const nf = S.features.length; await A.commitPreview(); await w(300); const f = S.features[nf];
    S.mode = null; S.sel = [f.id]; A.togglePanel('dialog', true); A.renderAll(); await w(500);
    return { type: f.type, d: f.measured.diameter ?? 2 * f.measured.radius, pl, edges: (A.trimFor(f)?.edges.length ?? 0) / 6, adv: !!document.querySelector('#dialog details[data-dsec="adv"] #fp-smooth') }; });
  console.log(v.name, 'cylinder', JSON.stringify(d));
  if (d.type !== 'Zylinder' || Math.abs(d.d - 8) > 0.02 || d.pl < 1 || d.edges < 50) fail(`${v.name}: cylinder boundary ${JSON.stringify(d)}`);
  if (!d.adv) fail(`${v.name}: smoothing tolerance not in the Advanced section`);
  if (errors.length) fail(`${v.name}: page errors ${errors}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'islands-check: FEHLER' : 'islands-check: OK');
