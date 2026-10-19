// 0.35 regression (Martin 19.10. 18:32): re-extraction with the frozen boundary of the demo top plane gives EXACTLY the
// creation point set at exclusion 0 (twice, also after save/load), and at exclusion 1 mm a strict subset with every
// point ≥ 1 mm inside the frozen boundary. Desktop 1400 px + iPhone 390 px.  Aufruf: node e2e/frozen035-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8773/'; srv = spawn('npx', ['serve', '-l', '8773', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  const r = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    S.preview = null; S.opts.pick = 1.5; S.opts.multi = false; A.startFitMode('Ebene'); await w(100); await A.previewByClick(A.hitAt([70, 52, 20], [0, 0, 1])); await w(800);
    const nF = S.features.length; await A.commitPreview(); await w(400); let f = S.features[nF]; const id = f.id;
    const c0 = Array.from(f.indices).sort((a, b) => a - b); out.n0 = c0.length; out.hasSet = !!f.frozenIdx && f.frozenIdx.length === c0.length;
    const open = async () => { S.mode = null; S.sel = [id]; A.togglePanel('dialog', true); A.renderAll(); await w(400); const d = document.querySelector('details.reex'); if (d) d.open = true; await w(100); };
    const run = async () => { document.querySelector('#rx-run')?.click(); for (let i = 0; i < 40; i++) { await w(250); if (!document.querySelector('#busy:not(.hidden)')) break; } await w(800); f = S.features.find((x) => x.id === id); return Array.from(f.indices).sort((a, b) => a - b); };
    await open(); const c1 = await run(), c2 = await run(); out.runs = [c1.length, c2.length]; out.equal = same(c0, c1) && same(c0, c2);
    await A.roundtrip(); await w(800); f = S.features.find((x) => x.id === id); out.rtSet = !!f?.frozenIdx && same(Array.from(f.frozenIdx).sort((a, b) => a - b), c0);
    await open(); const c3 = await run(); out.equalAfterLoad = same(c0, c3);
    const inp = document.querySelector('details.reex [data-rx="inset"]'); inp.value = '1'; inp.dispatchEvent(new Event('change')); await w(1500);
    const c4 = await run(); const s0 = new Set(c0); out.n1 = c4.length; out.subset = c4.length < c0.length && c4.every((x) => s0.has(x));
    const F = f.frozen ?? f.ist?.frozen, segs = []; for (const l of F.loops) for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; segs.push(l[i], l[i + 1], l[j], l[j + 1]); }
    const P = A.viewer.model.geometry.getAttribute('position').array; let minD = Infinity;
    for (let k = 0; k < c4.length; k += 40) { const q = c4[k], w0 = P[3 * q] - F.o[0], w1 = P[3 * q + 1] - F.o[1], w2 = P[3 * q + 2] - F.o[2];
      const x = w0 * F.u[0] + w1 * F.u[1] + w2 * F.u[2], y = w0 * F.v[0] + w1 * F.v[1] + w2 * F.v[2];
      for (let s = 0; s < segs.length; s += 4) { const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2] - ax, by = segs[s + 3] - ay, L = bx * bx + by * by; const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / L)) : 0; minD = Math.min(minD, Math.hypot(x - ax - t * bx, y - ay - t * by)); } }
    out.minD = minD; return out; });
  console.log(v.name, JSON.stringify(r));
  if (!r.hasSet || !r.equal) fail(`${v.name}: exclusion 0 not identical to the creation set ${JSON.stringify([r.n0, r.runs])}`);
  if (!r.rtSet || !r.equalAfterLoad) fail(`${v.name}: frozen point set lost on save/load`);
  if (!r.subset || !(r.minD >= 1 - 1e-6)) fail(`${v.name}: exclusion 1 mm: subset ${r.subset}, min distance ${r.minD}`);
  if (errors.length) fail(`${v.name}: page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'frozen035-check: FEHLER' : 'frozen035-check: OK');
