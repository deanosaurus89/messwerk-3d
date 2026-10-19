// Phase 1 steps 5 + 6 (0.32) on the demo part (beispielteil.stl), desktop 1400 px + iPhone 390 px:
// aux plane ▱ Auto | ◎ Ring / ⊂⊃ Band (offset + width, shown live) | ▭ assigned plane (projection); no implicit
// “Auto + existing plane” switch; one display (no Trimmed toggle); Used points (View ribbon + tree right-click).
// Aufruf: node e2e/aux-check.mjs [URL|-]
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
  const r = await page.evaluate(async () => { const A = window.__app, S = A.state, V = A.viewer, w = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {}; const prims = () => V.prims.children.length;
    const prev = async (mode, p, n) => { S.preview = null; S.opts.pick = 1.5; S.opts.multi = false; A.startFitMode(mode); await w(100); await A.previewByClick(A.hitAt(p, n)); await w(300); return S.preview; };
    const btn = async (a) => { document.querySelector(`#ctx-panel button[data-aux="${a}"]`)?.click(); await w(1500); };
    // circle: Auto → Ring (offset/width, live zone) → back
    S.opts.aux = 'auto'; let p = await prev('Kreis', [20, 26.84, 20], [0, 0, 1]); const nAuto = p.aux.indices.length, k0 = prims();
    const labels = [...document.querySelectorAll('#ctx-panel button[data-aux]')].map((b) => b.dataset.aux + ':' + b.textContent.trim());
    await btn('ring'); p = S.preview; out.ring = { n: p.aux.indices.length, d: p.fit.diameter ?? 2 * p.fit.radius, src: p.aux.source, inputs: !!document.querySelector('#cp-rg') && !!document.querySelector('#cp-rw'), zone: prims() - k0 };
    const rw = document.querySelector('#cp-rw'); rw.value = '1.5'; rw.dispatchEvent(new Event('change')); await w(1500); out.ring.n2 = S.preview.aux.indices.length;
    out.circle = { nAuto, labels };
    // slot: the zone button reads Band
    S.opts.aux = 'auto'; p = await prev('Langloch', [20, 39.2, 20], [0, 0, 1]); out.slotLabel = document.querySelector('#ctx-panel button[data-aux="ring"]')?.textContent.trim();
    await btn('ring'); out.slot = { n: S.preview.aux.indices.length, w: S.preview.fit.width, L: S.preview.fit.length };
    // assigned plane: create the top plane, then circle by a tap on the hole wall, projected onto that plane
    S.opts.aux = 'auto'; await prev('Ebene', [70, 52, 20], [0, 0, 1]); const n0 = S.features.length; await A.commitPreview(); await w(300); const pl = S.features[n0];
    S.opts.aux = 'auto'; p = await prev('Kreis', [20, 26.84, 20], [0, 0, 1]); await btn('plane');
    S.preview = null; await A.previewByClick(A.hitAt([20, 26.04, 15], [0, -1, 0])); await w(300); p = S.preview;
    out.assigned = { aux: S.opts.aux === pl.id, refId: p?.aux?.refId === pl.id, d: p?.fit.diameter ?? 2 * p?.fit.radius, type: p?.fit.type, sel: !!document.querySelector('#cp-auxpl') };
    // magic dropped: Auto with a plane assigned → Auto keeps its own detected aux plane
    p = await prev('auto', [20, 26.04, 15], [0, -1, 0]); out.autoRef = p?.aux?.refId ?? null; out.autoSrc = p?.aux?.source ?? '';
    S.opts.aux = 'auto'; S.preview = null; S.mode = null; A.renderAll(); await w(200);
    // display: no Trimmed toggle; used points
    out.trimBtn = !!document.querySelector('#btn-toggle-trim'); out.ptsBtn = document.querySelector('#btn-toggle-pts')?.textContent.trim(); out.colorDefault = S.colorPts;
    A.openContext(100, 100, pl.id); await w(100); const it = [...document.querySelectorAll('.ctx-menu button')].find((b) => /used points/.test(b.textContent)); out.menu = it?.textContent.trim(); it?.click(); await w(200);
    out.used = S.usedPts.has(pl.id);
    // 0.32: dialog top row – Used points + Aux-plane points (separate colour); ribbon aux button
    S.sel = [pl.id]; A.togglePanel('dialog', true); await w(200); out.dlg = { pts: !!document.querySelector('#d-pts'), aux: !!document.querySelector('#d-auxpts'), ptsOn: document.querySelector('#d-pts')?.checked };
    out.auxBtn = document.querySelector('#btn-toggle-aux')?.textContent.trim(); document.querySelector('#btn-toggle-aux')?.click(); await w(100); out.auxAll = S.colorAux; document.querySelector('#btn-toggle-aux')?.click();
    // panel order + compactness: Datum before the method buttons, Boundary from visible, Search distance under Advanced
    // Remove region: grow the top plane, tap the plane itself (0.33: plane always inside contour → disc removal), selection shrinks, ↶ restores
    S.preview = null; S.mode = null; S.opts.multi = false; S.opts.sub = false; A.renderAll();
    p = await prev('Ebene', [70, 52, 20], [0, 0, 1]); const nBefore = p.indices.length; const cp = document.querySelector('#ctx-panel .cp-main')?.textContent ?? ''; const iT = cp.indexOf('Freeform surface'), iD = cp.indexOf('Datum'), iR = cp.indexOf('Remove region'), iA = cp.indexOf('Advanced parameters');
    document.querySelector('#ctx-panel button[data-a="fill"]')?.click(); await w(1500); const cp2 = document.querySelector('#ctx-panel .cp-main')?.innerText ?? ''; const det = document.querySelector('#ctx-panel details.cp-params'); 
    out.order = { datumAfterType: iT >= 0 && iD > iT && iD < iR, boundaryVisible: null, advancedAfter: iA > iR, searchInAdv: !!det && /Search distance/.test(det.textContent) };
    document.querySelector('#ctx-panel button[data-a="fill"]')?.click(); await w(1500);
    { const pr = document.querySelector('#ctx-panel').getBoundingClientRect(), sc = document.querySelector('#ctx-panel').parentElement.getBoundingClientRect(); out.width = pr.width; out.avail = sc.width; out.h = pr.height; }
    document.querySelector('#ctx-panel button[data-a="subreg"]')?.click(); await w(100);
    out.subOn = S.opts.sub; await A.previewByClick(A.hitAt([60, 52, 20], [0, 0, 1])); await w(600);
    const nAfter = S.preview?.indices.length ?? nBefore; out.subHint = document.querySelector('#ctx-panel')?.textContent.includes('1 removed');
    document.querySelector('#ctx-panel button[data-a="unregion"]')?.click(); await w(600); out.remove = { nBefore, nAfter, restored: S.preview?.indices.length, hint: out.subHint, btn: !!document.querySelector('#ctx-panel button[data-a="subreg"]') };
    // Boundary from (cylinder/cone/sphere/torus) directly visible, not inside Advanced parameters
    S.preview = null; S.mode = null; S.opts.sub = false; await prev('Zylinder', [20, 26.04, 15], [0, -1, 0]);
    { const lb = [...document.querySelectorAll('#ctx-panel label')].find((l) => /Boundary from/.test(l.textContent)); out.order.boundaryVisible = !!lb && !lb.closest('details'); }
    S.preview = null; S.mode = null; A.renderAll();
    return out; });
  console.log(v.name, JSON.stringify(r));
  if (!(r.circle.labels.join() === 'auto:▱ Auto,ring:◎ Ring,plane:▭ Plane')) fail(`${v.name}: aux options ${r.circle.labels}`);
  if (!(r.ring.n > 100 && r.ring.n < r.circle.nAuto && r.ring.inputs && /ring zone/.test(r.ring.src) && Math.abs(r.ring.d - 12.08) < 0.01)) fail(`${v.name}: ring zone ${JSON.stringify(r.ring)}`);
  if (!(r.ring.zone >= 2)) fail(`${v.name}: ring zone not visualised`);
  if (!(r.ring.n2 < r.ring.n)) fail(`${v.name}: width change not applied live (${r.ring.n} → ${r.ring.n2})`);
  if (!/Band/.test(r.slotLabel ?? '') || !(r.slot.n > 100 && Math.abs(r.slot.w - 10) < 0.01 && Math.abs(r.slot.L - 30) < 0.02)) fail(`${v.name}: slot band ${r.slotLabel} ${JSON.stringify(r.slot)}`);
  if (!(r.assigned.aux && r.assigned.refId && r.assigned.type === 'Kreis' && Math.abs(r.assigned.d - 12.08) < 0.01 && r.assigned.sel)) fail(`${v.name}: assigned plane ${JSON.stringify(r.assigned)}`);
  // (0.36: a wall tap 5 mm below the rim is a plain cylinder in Auto – no aux plane at all is fine; it must just not be the assigned one)
  if (r.autoRef !== null || (r.autoSrc && !/automatic/.test(r.autoSrc))) fail(`${v.name}: Auto used the assigned plane (${r.autoRef}, ${r.autoSrc}) – implicit switch should be gone`);
  if (r.trimBtn || r.ptsBtn !== '⁘Used points' && r.ptsBtn !== '⁘ Used points' || r.colorDefault !== false) fail(`${v.name}: display buttons ${r.trimBtn} ${r.ptsBtn} ${r.colorDefault}`);
  if (r.menu !== '⁘ Show used points' || !r.used) fail(`${v.name}: tree right-click Show used points (${r.menu}, ${r.used})`);
  if (!r.dlg.pts || r.dlg.aux || !r.dlg.ptsOn) fail(`${v.name}: dialog top row (plane has no aux) ${JSON.stringify(r.dlg)}`);
  if (!/Aux-plane/.test(r.auxBtn ?? '') || !r.auxAll) fail(`${v.name}: aux-plane ribbon button ${r.auxBtn} ${r.auxAll}`);
  if (!r.order.datumAfterType || !r.order.boundaryVisible || !r.order.advancedAfter || !r.order.searchInAdv) fail(`${v.name}: panel order ${JSON.stringify(r.order)}`);
  if (v.name === 'desktop' && !(r.width >= Math.min(600, r.avail - 152) && r.h < 150)) fail(`${v.name}: panel not widened/compact (${r.width} of ${r.avail}, h ${r.h})`);
  if (!r.remove.btn || !(r.remove.nAfter < r.remove.nBefore) || r.remove.restored !== r.remove.nBefore) fail(`${v.name}: remove region ${JSON.stringify(r.remove)}`);
  if (errors.length) fail(`${v.name}: page errors ${errors}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'aux-check: FEHLER' : 'aux-check: OK');
