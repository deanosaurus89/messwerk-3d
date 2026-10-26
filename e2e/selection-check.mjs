// 0.28 (Phase 1 step 1 – selection), desktop + iPhone viewport:
//  1. Creation Panel offers the selection choice Click & grow | Add region | Brush; Add region = every click adds a region.
//  2. Typed Circle via a REAL tap/click roughly at the rim (plane side and wall side, pick radius set) → hole wall AND
//     aux-plane points (was unreliable on iPhone).
//  3. Seed feedback: after the tap the triangles inside the pick circle are highlighted (incl. the wall next to the plane).
// Aufruf: node e2e/selection-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8769/'; srv = spawn('npx', ['serve', '-l', '8769', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
// small hole Ø6 at (85,10), top face z = 20: taps on the plane 0.8 mm outside the rim and on the wall 0.8 mm below it
const TAPS = [['plane', [85 + 3.8 * Math.cos(3.5), 10 + 3.8 * Math.sin(3.5), 20], [0, 0, 1]], ['wall', [85 + 3 * Math.cos(-1), 10 + 3 * Math.sin(-1), 19.2], [-Math.cos(-1), -Math.sin(-1), 0]]];
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  // 1. selection choice
  const seg = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    A.startFitMode('Ebene'); A.renderAll(); await w(300); const before = [...document.querySelectorAll('.cp-selm button')].map((x) => x.dataset.a);
    await A.previewByClick(A.hitAt([70, 52, 20], [0, 0, 1])); await w(400);
    const after = [...document.querySelectorAll('.cp-selm button')].map((x) => x.dataset.a);
    document.querySelector('.cp-selm [data-a="addreg"]').click(); await w(200); const multi = S.opts.multi, on = document.querySelector('.cp-selm .on')?.dataset.a;
    document.querySelector('.cp-selm [data-a="click"]').click(); await w(200); S.preview = null; return { before, after, multi, on, back: S.opts.multi }; });
  console.log(v.name, 'selection', JSON.stringify(seg));
  if (seg.before.join() !== 'click') fail(`${v.name}: before the first click only Smart Detect ${seg.before}`);
  if (!seg.after.includes('addreg') || seg.after.includes('brush')) fail(`${v.name}: after detection ${seg.after}`);
  if (!seg.multi || seg.on !== 'addreg' || seg.back) fail(`${v.name}: Add region toggle`);
  for (const [k, p, n] of TAPS) {
    // view straight at the tap (wall taps obliquely from above), then a real tap/click at its screen position
    const xy = await page.evaluate(async ({ p, n }) => { const A = window.__app, S = A.state, V = A.viewer, w = (ms) => new Promise((r) => setTimeout(r, ms));
      S.preview = null; A.startFitMode('Kreis'); S.opts.pick = 1.5; A.renderAll(); if (A.togglePanel && innerWidth < 900) { A.togglePanel('dialog', false); A.togglePanel('tree', false); }
      const P = V.camera.position.constructor, d = new P(n[0] + 0, n[1] + 0, n[2] + 0.8).normalize();
      V.controls.target.set(...p); V.camera.position.copy(new P(...p).addScaledVector(d, 60)); V.camera.up.set(0, 0, 1); V.camera.lookAt(...p); V.controls.update?.(); await w(400);
      const r = V.renderer.domElement.getBoundingClientRect(), q = new P(...p).project(V.camera);
      return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height }; }, { p, n });
    if (v.name === 'iphone') await page.touchscreen.tap(xy.x, xy.y); else await page.mouse.click(xy.x, xy.y);
    await sleep(4000);
    const r = await page.evaluate(() => { const A = window.__app, S = A.state, pv = S.preview, hi = A.viewer.brushHi;
      let wallTri = 0, nTri = 0; if (hi) { const a = hi.geometry.attributes.position.array; nTri = a.length / 9;
        for (let i = 0; i < a.length; i += 9) { const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2], vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
          const nz = ux * vy - uy * vx, l = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz); if (Math.abs(nz) < 0.3 * l) wallTri++; } }
      return { type: pv?.fit.type, R: pv?.fit.radius, wall: pv?.indices.length ?? 0, aux: pv?.aux?.indices.length ?? 0, seedTri: nTri, seedWallTri: wallTri, cursor: A.viewer.cursor.visible }; });
    console.log(v.name, k, JSON.stringify(r));
    if (r.type !== 'Kreis' || Math.abs(r.R - 3) > 0.05) fail(`${v.name} ${k}: no circle R3 (${r.type} ${r.R})`);
    if (r.wall < 500 || r.aux < 100) fail(`${v.name} ${k}: wall ${r.wall} / aux-plane ${r.aux} points`);
    if (!r.seedTri || !r.cursor) fail(`${v.name} ${k}: no seed area feedback after the tap`);
    if (!r.seedWallTri) fail(`${v.name} ${k}: seed area does not include the hole wall`);
  }
  // Add region: cylinder from two partial wall regions (growth limit r = 3) on opposite sides of the hole
  const ar = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    S.preview = null; A.startFitMode('Zylinder'); S.opts.radius = 3; S.opts.multi = false; S.opts.ex.zoneSrc = 'points'; A.renderAll(); await w(100);
    await A.previewByClick(A.hitAt([20, 26.04, 10], [0, -1, 0])); await w(300); const n1 = S.preview?.indices.length;
    document.querySelector('.cp-selm [data-a="addreg"]').click(); await w(100);
    await A.previewByClick(A.hitAt([20, 13.96, 10], [0, 1, 0])); await w(300); const p = S.preview;
    const r = { n1, n2: p?.indices.length, regions: p?.regions?.length, d: p?.fit.diameter ?? 2 * p?.fit.radius, label: document.querySelector('.cp-hint')?.textContent };
    S.opts.radius = 0; S.opts.multi = false; S.preview = null; A.startFitMode('Kreis'); return r; });
  console.log(v.name, 'add region', JSON.stringify(ar));
  if (!(ar.regions === 2 && ar.n2 > 1.5 * ar.n1 && Math.abs(ar.d - 12.08) < 0.02)) fail(`${v.name}: Add region (${JSON.stringify(ar)})`);
  await page.evaluate(async () => { const A = window.__app; await A.previewByClick(A.hitAt([85 + 3.8 * Math.cos(3.5), 10 + 3.8 * Math.sin(3.5), 20], [0, 0, 1])); });
  // feature dialog: re-extraction only behind the collapsed "Advanced" section
  const dlg = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    await A.commitPreview(); await w(300); const f = S.features.at(-1); S.mode = null; S.sel = [f.id]; A.togglePanel('dialog', true); A.renderAll(); await w(500);
    const adv = document.querySelector('#dialog details[data-dsec="adv"]'); return { adv: !!adv, open: !!adv?.open, reexInside: !!adv?.querySelector('details.reex'), flt: !!document.querySelector('#dialog details[data-dsec="flt"]') }; });
  console.log(v.name, 'dialog', JSON.stringify(dlg));
  if (!dlg.adv || dlg.open || !dlg.reexInside || dlg.flt) fail(`${v.name}: re-extraction not behind a collapsed Advanced section`);
  if (errors.length) fail(`${v.name}: page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'selection-check: FEHLER' : 'selection-check: OK');
