// 2026.0.46: Boundary from Geometry on the training part uses the fitted surface,
// not the clicked-point highlight. Cone, cylinder, sphere and torus.
// Aufruf: node e2e/geom046-check.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const port = 4186;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
const srvLog = [];
srv.stdout?.on('data', (d) => srvLog.push(String(d)));
srv.stderr?.on('data', (d) => srvLog.push(String(d)));
for (let i = 0; i < 40 && !srvLog.join('').includes('ready'); i++) await sleep(200);
if (!srvLog.join('').includes('ready')) { console.log(srvLog.join('').slice(-2000)); throw new Error('vite did not start'); }

const nz = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const CASES = [
  ['Cone', 'Kegel', [89, 38, 25], nz([10, 0, 6])],
  ['Cylinder', 'Zylinder', [20, 26.04, 15], [0, -1, 0]],
  ['Sphere', 'Kugel', [60, 8, 24], [0, 0, 1]],
  ['Torus', 'Torus', [46, 10, 22.8], [0, 0, 1]],
];

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}/?nodemo`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.setInputFiles('#file', STL);
  await page.waitForSelector('#unit-dlg', { timeout: 120000 });
  await page.evaluate(() => document.querySelector('#unit-dlg [data-ok]').click());
  await page.waitForFunction(() => window.__app?.state?.data, null, { timeout: 60000 });
  await page.evaluate(() => document.querySelector('#whatsnew')?.remove());

  for (const [name, mode, p, n] of CASES) {
    const r = await page.evaluate(async ({ mode, p, n }) => {
      const A = window.__app, S = A.state;
      const w = (ms) => new Promise((res) => setTimeout(res, ms));
      S.features = []; S.preview = null; S.opts.ex.zoneSrc = 'geom'; S.opts.pick = 1.5; S.opts.multi = false;
      A.startFitMode(mode); await w(50);
      const h = A.hitAt(p, n); if (!h) return { err: 'no hit' };
      try { await A.previewByClick(h); } catch (e) { return { err: String(e.message || e) }; }
      await w(200);
      if (S.opts.ex.zoneSrc === 'geom') await A.applyExtract();
      const pv = S.preview; if (!pv) return { err: 'no preview' };
      const badge = document.querySelector('[data-detected]')?.dataset.detected || '';
      A.commitPreview(); await w(50);
      const f = S.features.at(-1); if (!f) return { err: 'not in tree' };
      const pos = A.viewer.model.geometry.getAttribute('position').array;
      const out = {
        type: f.type, zone: f.fp?.zoneSrc, highlight: A.drawsPointHighlight(f.type, f.fp?.zoneSrc),
        kind: A.boundaryKind(f.type, 'geom'), badge, nPts: f.indices.length, previewType: pv.fit.type,
      };
      if (f.type === 'Kegel') {
        const fit = f.measured, c = fit.center, a = fit.normal;
        const ax = (i) => (pos[3 * i] - c[0]) * a[0] + (pos[3 * i + 1] - c[1]) * a[1] + (pos[3 * i + 2] - c[2]) * a[2];
        const ts = [...f.indices].map(ax).sort((x, y) => x - y);
        const mid = ts[ts.length >> 1];
        const thin = Uint32Array.from([...f.indices].filter((i) => Math.abs(ax(i) - mid) < 0.35).slice(0, 80));
        const ring = A.analyticShell(fit, pos, thin.length > 8 ? thin : f.indices);
        const geom = A.coneDisplayShell(fit, pos, thin.length > 8 ? thin : f.indices);
        out.thin = thin.length; out.ptSpan = +(ring.t1 - ring.t0).toFixed(2); out.geomSpan = +(geom.t1 - geom.t0).toFixed(2); out.closed = geom.closed; out.length = fit.length;
      }
      if (f.type === 'Zylinder') {
        const fit = f.measured, c = fit.center, a = fit.normal;
        const half = [];
        for (const i of f.indices) {
          const x = pos[3 * i] - c[0], y = pos[3 * i + 1] - c[1], z = pos[3 * i + 2] - c[2];
          const t = x * a[0] + y * a[1] + z * a[2];
          const rx = x - t * a[0], ry = y - t * a[1];
          if (ry >= 0) half.push(i);
        }
        const sel = Uint32Array.from(half);
        const arc = A.analyticShell(fit, pos, sel);
        const wall = A.cylinderDisplayShell(fit, pos, sel);
        out.half = sel.length; out.arcClosed = arc.closed; out.wallClosed = wall.closed; out.wallSpan = +(wall.a1 - wall.a0).toFixed(3);
      }
      if (f.type === 'Kugel') {
        const s = A.analyticSphere(f.measured);
        let z0 = Infinity, z1 = -Infinity;
        for (let i = 2; i < s.tri.length; i += 3) { z0 = Math.min(z0, s.tri[i]); z1 = Math.max(z1, s.tri[i]); }
        out.span = +(z1 - z0).toFixed(2); out.radius = f.measured.radius;
      }
      if (f.type === 'Torus') out.minor = f.measured.minorRadius;
      S.opts.ex.zoneSrc = 'points';
      out.pointsHighlight = A.drawsPointHighlight(f.type, 'points');
      return out;
    }, { mode, p, n });
    console.log(name, JSON.stringify(r));
    ok(!r.err && r.type === mode, `${name}: created ${mode} (${r.err || r.type})`);
    ok(r.zone === 'geom', `${name}: Boundary from Geometry stored (${r.zone})`);
    ok(r.highlight === false && r.kind === 'analytic', `${name}: display is analytic, not the point highlight`);
    ok(r.pointsHighlight === true, `${name}: Points mode still highlights the selection`);
    if (mode === 'Kegel') ok(r.geomSpan > r.ptSpan + 2 && r.geomSpan < (r.length || 12) + 8 && r.closed, `${name}: fitted frustum (${r.geomSpan} mm) covers the cone, not the thin ring (${r.ptSpan} mm) and not a neighbouring face`);
    if (mode === 'Zylinder') ok(r.wallClosed === true && r.arcClosed === false, `${name}: full turn from half the wall (arc closed=${r.arcClosed}, wall closed=${r.wallClosed})`);
    if (mode === 'Kugel') ok(r.span > r.radius * 1.8, `${name}: complete sphere span ${r.span} mm (R ${r.radius})`);
    if (mode === 'Torus') ok(Math.abs(r.minor - 2) < 0.15, `${name}: tube radius ${r.minor}`);
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
} finally {
  await browser.close();
  srv.kill();
}
if (fail) { console.log(`geom046-check: ${fail} FAILED`); process.exit(1); }
console.log('geom046-check: OK');
