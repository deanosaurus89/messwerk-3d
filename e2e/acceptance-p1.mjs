// Phase 1 acceptance (feature creation on the mesh, actual data) – desktop 1400 px + iPhone 390 px:
// every feature type in scope is created via Click & grow (typed, plus Auto) on the demo part (beispielteil.stl:
// CAD nominals known, measured part = hole Ø12.08, boss +0.05 in X; Gaussian noise σ = 0.008 mm per coordinate) and the
// created feature must match the nominal within the per-type tolerances (criteria: research/feature-creation-spec.md).
// Aufruf: node e2e/acceptance-p1.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8771/'; srv = spawn('npx', ['serve', '-l', '8771', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const nz = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const SIGMA = 0.008;
// [name, mode, tap point, tap normal, expected { type, size checks [field, nominal, tol], centre/axis checks }]
const CASES = [
  ['Plane top', 'Ebene', [70, 52, 20], [0, 0, 1], { type: 'Ebene', axis: [0, 0, 1], onPlane: 20, minPts: 10000 }],
  ['Hole Ø12.08 (cylinder)', 'Zylinder', [20, 26.04, 15], [0, -1, 0], { type: 'Zylinder', size: [['diameter', 12.08, 0.01]], axis: [0, 0, 1], cxy: [20, 20] }],
  ['Boss Ø16 (cylinder)', 'Zylinder', [63.05, 30, 26], [1, 0, 0], { type: 'Zylinder', size: [['diameter', 16, 0.01]], axis: [0, 0, 1], cxy: [55.05, 30] }],
  ['Circle Ø12.08 (tap on plane at rim)', 'Kreis', [20, 26.84, 20], [0, 0, 1], { type: 'Kreis', size: [['diameter', 12.08, 0.01]], axis: [0, 0, 1], cxy: [20, 20], aux: true }],
  ['Circle Ø6 (tap on wall at rim)', 'Kreis', [85 + 3 * Math.cos(-1), 10 + 3 * Math.sin(-1), 19.2], [-Math.cos(-1), -Math.sin(-1), 0], { type: 'Kreis', size: [['diameter', 6, 0.01]], axis: [0, 0, 1], cxy: [85, 10], aux: true }],
  ['Slot 30×10', 'Langloch', [20, 39.2, 20], [0, 0, 1], { type: 'Langloch', size: [['length', 30, 0.02], ['width', 10, 0.01]], axis: [0, 0, 1], cxy: [20, 45], aux: true }],
  ['Cone R10→4 h10', 'Kegel', [89, 38, 25], nz([10, 0, 6]), { type: 'Kegel', size: [['halfAngleDeg', Math.atan(6 / 10) * 180 / Math.PI, 0.05]], axis: [0, 0, 1], cxy: [82, 38] }],
  ['Sphere R7', 'Kugel', [60, 8, 24], [0, 0, 1], { type: 'Kugel', size: [['radius', 7, 0.01]], c3: [60, 8, 17] }],
  ['Torus R6 r2', 'Torus', [46, 10, 22.8], [0, 0, 1], { type: 'Torus', size: [['radius', 6, 0.02], ['minorRadius', 2, 0.01]], axis: [0, 0, 1], cxy: [40, 10] }],
  ['Auto: hole Ø12.08', 'auto', [20, 26.04, 15], [0, -1, 0], { size: [['diameter', 12.08, 0.01]], axis: [0, 0, 1], cxy: [20, 20] }],
];
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  for (const [name, mode, p, n, ex] of CASES) {
    const r = await page.evaluate(async ({ mode, p, n }) => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
      S.preview = null; S.opts.pick = 1.5; S.opts.multi = false; A.startFitMode(mode); await w(100);
      const h = A.hitAt(p, n); if (!h) return { err: 'no hit' };
      try { await A.previewByClick(h); } catch (e) { return { err: e.message }; } await w(300);
      const pv = S.preview; if (!pv) return { err: 'no preview' };
      const stats = [...document.querySelectorAll('.cp-kv small')].map((e) => e.textContent);
      const n0 = S.features.length; await A.commitPreview(); await w(300); const f = S.features[n0]; if (!f) return { err: 'not created' };
      const m = f.measured; return { type: m.type, center: m.center, normal: m.normal, diameter: m.diameter ?? (m.radius != null ? 2 * m.radius : undefined), radius: m.radius, minorRadius: m.minorRadius, length: m.length, width: m.width,
        halfAngleDeg: m.halfAngle != null ? m.halfAngle * 180 / Math.PI : undefined, rms: m.rms, form: m.form, n: m.n, pts: f.indices?.length, aux: f.aux?.pointCount ?? 0, outliers: m.outliers ?? 0, nf: m.nfRemoved ?? 0, previewPts: pv.indices.length, stats }; }, { mode, p, n });
    const errs = [];
    if (r.err) errs.push(r.err);
    else {
      if (ex.type && r.type !== ex.type) errs.push(`type ${r.type}`);
      for (const [k, nom, tol] of ex.size ?? []) if (!(Math.abs(r[k] - nom) <= tol)) errs.push(`${k} ${r[k]?.toFixed(4)} vs ${nom.toFixed(4)} ±${tol}`);
      if (ex.axis && !(Math.abs(Math.abs(r.normal[0] * ex.axis[0] + r.normal[1] * ex.axis[1] + r.normal[2] * ex.axis[2]) - 1) < 1e-4)) errs.push(`axis ${r.normal.map((x) => x.toFixed(4))}`);
      if (ex.cxy && !(Math.hypot(r.center[0] - ex.cxy[0], r.center[1] - ex.cxy[1]) <= 0.01)) errs.push(`centre ${r.center.map((x) => x.toFixed(4))}`);
      if (ex.c3 && !(Math.hypot(r.center[0] - ex.c3[0], r.center[1] - ex.c3[1], r.center[2] - ex.c3[2]) <= 0.01)) errs.push(`centre ${r.center.map((x) => x.toFixed(4))}`);
      if (ex.onPlane != null && !(Math.abs(r.center[2] - ex.onPlane) <= 0.01)) errs.push(`plane z ${r.center[2]}`);
      if (ex.minPts && r.n < ex.minPts) errs.push(`only ${r.n} points`);
      // step 3 (create = raw fit of the selection, no filters) – enforced once released: P1_RAW=1
      if (process.env.P1_RAW && (r.outliers || r.nf)) errs.push(`filters removed points (${r.outliers} outliers, ${r.nf} normal filter)`);
      if (ex.aux && r.aux < 100) errs.push(`aux plane ${r.aux} points`);
      // noise model: std. dev. ≈ σ (tessellation adds a little), form within a few σ … ~10 σ (Gauss range of n points)
      if (!(r.rms >= 0.6 * SIGMA && r.rms <= 1.6 * SIGMA)) errs.push(`std dev ${r.rms.toFixed(4)} not ≈ σ ${SIGMA}`);
      if (!(r.form >= 3 * SIGMA && r.form <= 12 * SIGMA)) errs.push(`form ${r.form.toFixed(4)} not within 3…12 σ`);
    }
    console.log(`${v.name} | ${name} | ${errs.length ? '✗ ' + errs.join('; ') : '✓'} | ${JSON.stringify(r)}`);
    for (const e of errs) fail(`${v.name} ${name}: ${e}`);
  }
  if (errors.length) fail(`${v.name}: page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'acceptance-p1: FEHLER' : 'acceptance-p1: OK');
