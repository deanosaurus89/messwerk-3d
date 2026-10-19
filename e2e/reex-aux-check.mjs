// 0.32 blocker fix (regression): Re-extract / refit of aux-plane features (circle, slot) on the demo part keeps the
// feature's aux plane (origin + normal unchanged); centre/diameter stay within acceptance tolerances. Desktop + iPhone.
// Aufruf: node e2e/reex-aux-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8771/'; srv = spawn('npx', ['serve', '-l', '8771', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  const r = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
    const make = async (type, p, ring) => { S.preview = null; S.opts.pick = 1.5; S.opts.multi = false; S.opts.aux = ring ? 'ring' : 'auto'; A.startFitMode(type); await w(100);
      await A.previewByClick(A.hitAt(p, [0, 0, 1])); await w(300); const n = S.features.length; await A.commitPreview(); await w(300); S.opts.aux = 'auto'; S.mode = null; return S.features[n]; };
    const snap = (f) => ({ o: [...f.aux.plane.center], n: [...f.aux.plane.normal], c: [...f.measured.center], d: f.measured.diameter ?? 2 * f.measured.radius, w: f.measured.width, L: f.measured.length, type: f.type });
    const out = [];
    for (const [type, p, ring] of [['Kreis', [20, 26.84, 20]], ['Langloch', [20, 39.2, 20]], ['Kreis', [20, 26.84, 20], true]]) {
      const f = await make(type, p, ring); const s0 = snap(f);
      await A.refitFeature(f); await w(200); const s1 = snap(f);
      S.sel = [f.id]; A.togglePanel('dialog', true); A.renderAll(); await w(300);
      const rx = document.querySelector('#rx-run'); rx?.click(); await w(2500); const s2 = snap(f);
      // a second re-extraction (Martin: repeated runs flipped the plane)
      document.querySelector('#rx-run')?.click(); await w(2500); const s3 = snap(f);
      out.push({ type, ring: !!ring, rx: !!rx, s0, s1, s2, s3 });
    }
    return out; });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const x of r) {
    for (const k of ['s1', 's2', 's3']) { const s = x[k], s0 = x.s0, tag = `${v.name} ${x.type}${x.ring ? ' (ring)' : ''} ${k === 's1' ? 'refit' : k === 's2' ? 're-extract' : 're-extract ×2'}`;
      if (!x.rx) fail(`${tag}: no Apply extraction button`);
      if (dist(s.o, s0.o) > 1e-6 || dist(s.n, s0.n) > 1e-6) fail(`${tag}: aux plane moved ${JSON.stringify([s0.o, s0.n])} → ${JSON.stringify([s.o, s.n])}`);
      if (dist(s.c, s0.c) > 0.02) fail(`${tag}: centre moved ${dist(s.c, s0.c).toFixed(4)} mm`);
      if (x.type === 'Kreis' && Math.abs(s.d - s0.d) > 0.01) fail(`${tag}: diameter ${s0.d} → ${s.d}`);
      if (x.type === 'Langloch' && (Math.abs(s.w - s0.w) > 0.01 || Math.abs(s.L - s0.L) > 0.02)) fail(`${tag}: slot ${s0.w}×${s0.L} → ${s.w}×${s.L}`);
      if (s.type !== s0.type) fail(`${tag}: type changed`); }
    console.log(v.name, x.type, x.ring ? 'ring' : 'auto', 'd/w', x.s0.d ?? x.s0.w, '→', x.s2.d ?? x.s2.w, 'centre Δ', dist(x.s2.c, x.s0.c).toFixed(4));
  }
  if (errors.length) fail(`${v.name}: page errors ${errors}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'reex-aux-check: FEHLER' : 'reex-aux-check: OK');
