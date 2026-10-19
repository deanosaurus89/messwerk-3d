// 0.27 regressions (desktop + iPhone viewport):
//  1. Cylinder with "Boundary from: Fitted geometry" – also via Auto detection ▸ type changed to Cylinder – the created
//     feature keeps the analytic zone (≈ all wall points of the demo hole), also after a refit; the panel offers the option in Auto.
//  2. Assigning a datum in the feature dialog changes nothing in the 3D view (vertex colours + primitives identical).
// Aufruf: node e2e/zone-datum-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8768/'; srv = spawn('npx', ['serve', '-l', '8768', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  const r = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms)), T = A.TRAIN_FEATS, r = {};
    A.startFitMode('auto'); A.renderAll(); await w(300); r.autoOption = !!document.querySelector('details.cp-params select[data-exs="zoneSrc"]') && !!document.querySelector('details.cp-params #cp-area');
    S.opts.ex.zoneSrc = 'geom'; await A.previewByClick(A.hitAt(T.H[1], T.H[2])); await w(1200); r.grown = S.preview.indices.length;
    const sel = document.querySelector('#cp-type'); sel.value = 'Zylinder'; sel.dispatchEvent(new Event('change')); await w(2500);
    r.preview = S.preview.indices.length; await A.commitPreview(); await w(1000); const f = S.features.at(-1); r.created = f.indices.length; r.src = f.fp?.zoneSrc;
    S.mode = null; S.preview = null; A.renderAll(); await A.refitFeature(f); await w(1000); r.refit = f.indices.length;
    const pos = A.viewer.model.geometry.getAttribute('position').array, m = f.measured, n = m.normal, c = m.center; let t0 = Infinity, t1 = -Infinity;
    for (const v of f.indices) { const t = (pos[3 * v] - c[0]) * n[0] + (pos[3 * v + 1] - c[1]) * n[1] + (pos[3 * v + 2] - c[2]) * n[2]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    let wall = 0; for (let v = 0; v < pos.length / 3; v++) { const q = [pos[3 * v] - c[0], pos[3 * v + 1] - c[1], pos[3 * v + 2] - c[2]], t = q[0] * n[0] + q[1] * n[1] + q[2] * n[2]; if (t < t0 || t > t1) continue; if (Math.abs(Math.hypot(q[0] - t * n[0], q[1] - t * n[1], q[2] - t * n[2]) - m.radius) <= 0.1) wall++; }
    r.wall = wall;
    // datum assignment in the feature dialog: no visual change
    S.sel = [f.id]; A.togglePanel('dialog', true); A.renderAll(); await w(1500);
    const col = () => Float32Array.from(A.viewer.model.geometry.attributes.color.array), c0 = col(), p0 = A.viewer.prims.children.length;
    document.querySelector('#dt-letter').value = 'A'; document.querySelector('#dt-apply').click(); await w(2500);
    const c1 = col(); let ch = 0; for (let i = 0; i < c0.length; i++) if (c0[i] !== c1[i]) ch++;
    r.datum = f.datum; r.colourChanges = ch; r.prims = [p0, A.viewer.prims.children.length]; r.reexOpened = !!document.querySelector('#dialog details.reex[open]');
    return r; });
  console.log(v.name, JSON.stringify(r));
  if (!r.autoOption) fail(`${v.name}: Auto detection panel: Parameters lack "Boundary from" or "Growth limit r"`);
  if (r.src !== 'geom') fail(`${v.name}: feature did not keep Boundary from = Fitted geometry`);
  for (const k of ['preview', 'created', 'refit']) if (r[k] < 0.97 * r.wall) fail(`${v.name}: ${k} ${r[k]} points < 97 % of the ${r.wall} wall points`);
  if (r.datum !== 'A') fail(`${v.name}: datum not assigned`);
  if (r.colourChanges) fail(`${v.name}: datum assignment changed ${r.colourChanges} vertex colour values`);
  if (r.prims[0] !== r.prims[1]) fail(`${v.name}: datum assignment changed the 3D primitives ${r.prims}`);
  if (r.reexOpened) fail(`${v.name}: datum assignment opened the re-extraction (zone preview)`);
  if (errors.length) fail(`${v.name}: page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
if (!process.exitCode) console.log('OK: fitted-geometry boundary kept (≈ all wall points) and datum assignment leaves the 3D view unchanged');
