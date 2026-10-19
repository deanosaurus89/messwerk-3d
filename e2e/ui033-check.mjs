// 0.33 (Martin's 0.30–0.32 test feedback), demo part, desktop 1400 px + iPhone 390 px:
// F4 brush in one step (live stats, ✓ creates, no second confirm, no outer-contour option) · aux-plane options only
// after a detected circle/slot · ⚙ menu always fully visible (no Center on origin / ISO; Transparent + amount) ·
// tree: empty click clears the selection; groups Data + Reference, pinnable (sticky at the top).
// Aufruf: node e2e/ui033-check.mjs [URL|-]
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
  await page.evaluate(() => localStorage.removeItem('mw3d-tree-pins'));
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  const r = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    const panel = () => document.querySelector('#ctx-panel');
    // aux options: hidden before the first click (Auto + Circle), visible after a detected circle, hidden for a plane
    for (const t of ['auto', 'Kreis']) { S.preview = null; A.startFitMode(t); await w(150); out['auxBefore_' + t] = !!panel()?.querySelector('[data-aux]'); }
    S.opts.pick = 1.5; await A.previewByClick(A.hitAt([20, 26.84, 20], [0, 0, 1])); await w(300); out.auxAfterCircle = !!panel()?.querySelector('[data-aux]');
    S.preview = null; A.startFitMode('auto'); await w(100); await A.previewByClick(A.hitAt([70, 52, 20], [0, 0, 1])); await w(300); out.auxAfterPlane = !!panel()?.querySelector('[data-aux]'); out.planeType = S.preview?.fit.type;
    S.preview = null; S.mode = null; A.renderAll();
    // F4 brush: paint → live stats → ✓ creates directly
    A.startFitMode('Ebene'); await w(100); A.setMethod('Pinsel'); await w(100); S.opts.brush = 3;
    for (const p of [[60, 45, 20], [64, 45, 20], [68, 45, 20]]) await A.brushAt(A.hitAt(p, [0, 0, 1]));
    A.scheduleBrushFit(); await w(900);
    const pt = panel(); out.brush = { stats: pt?.querySelector('[data-kv="form"]') ? pt.querySelector('[data-kv="pts"]')?.textContent : null, okLabel: pt?.querySelector('.cp-ok')?.textContent.trim(), contour: /outer contour|All inside boundary/i.test(pt?.innerHTML ?? '') };
    const n0 = S.features.length; pt?.querySelector('.cp-ok')?.click(); await w(1200);
    out.brush.created = S.features.length - n0; out.brush.preview = !!S.preview; const bf = S.features[n0]; out.brush.type = bf?.type; out.brush.method = bf?.method; out.brush.n = bf?.indices.length;
    S.mode = null; S.preview = null; A.renderAll(); await w(100);
    // F5: slim panel (no All inside boundary / Outlier removal / Growth limit; Normal angle + doc), islands add/remove
    A.startFitMode('Ebene'); await w(100); S.opts.pick = 1.5; await A.previewByClick(A.hitAt([70, 52, 20], [0, 0, 1])); await w(800);
    { const h = panel()?.innerHTML ?? ''; out.slim = { fill: /All inside boundary|data-ex="contour"/.test(h), outl: /Outlier removal/.test(h), glim: /Growth limit/.test(h), nang: !!panel()?.querySelector('#cp-nang'), doc: !!panel()?.querySelector('[data-doc-sec="nangle"]'), isl: !!panel()?.querySelector('[data-isladd]') }; }
    const n1 = S.preview.indices.length; panel().querySelector('[data-isladd]').click(); await w(100); S.opts.brush = 3;
    await A.previewByClick(A.hitAt([60, 45, 20], [0, 0, 1])); await w(1200); const n2 = S.preview.indices.length, chip = !!panel()?.querySelector('[data-islman]');
    panel()?.querySelector('[data-islman]')?.click(); await w(1500); out.manIsl = { n1, n2, chip, n3: S.preview.indices.length };
    // frozen boundary: Add region, ✓, re-extract ×3 → same count; stored in Ist
    S.opts.multi = true; await A.previewByClick(A.hitAt([40, 52, 20], [0, 0, 1])); await w(600); S.opts.multi = false;
    const nF = S.features.length; await A.commitPreview(); await w(400); const pf = S.features[nF];
    out.frozen = { has: !!pf.ist.frozen, loops: pf.ist.frozen?.loops.length, n0: pf.indices.length, json: JSON.stringify(pf.ist).includes('"frozen"'), runs: [] };
    S.mode = null; S.sel = [pf.id]; A.togglePanel('dialog', true); A.renderAll(); await w(300);
    for (let k = 0; k < 3; k++) { document.querySelector('#rx-run')?.click(); await w(2500); out.frozen.runs.push(pf.indices.length); }
    out.geoLink = document.querySelector('#d-props')?.textContent.trim(); A.togglePanel('dialog', false);
    // ⚙ menu: items, transparency, always fully visible (plain, with dialog, with table, with creation panel)
    const g = document.querySelector('#view-gear'); out.gearItems = [...g.querySelectorAll('[data-vg]')].map((b) => b.dataset.vg);
    const vis = async () => { g.classList.add('open'); A.placeGear(); await w(120); const V = A.viewer.el.getBoundingClientRect(), M = g.querySelector('.vg-menu').getBoundingClientRect(), mm = g.querySelector('.vg-menu');
      const first = mm.querySelector('button').getBoundingClientRect(); const ok = M.top >= V.top - 1 && M.bottom <= V.bottom + 1 && M.left >= V.left - 1 && M.right <= window.innerWidth + 1 && (mm.scrollHeight <= mm.clientHeight + 2 || first.top >= V.top - 1);
      const css = mm.style.cssText, cls = g.className; g.classList.remove('open'); return { ok, top: Math.round(M.top), vTop: Math.round(V.top), h: Math.round(M.height), css, cls }; };
    out.gear = { plain: await vis() };
    S.sel = [bf?.id]; A.togglePanel('dialog', true); A.renderAll(); await w(300); out.gear.dialog = await vis(); A.togglePanel('dialog', false);
    A.togglePanel('table', true); A.renderAll(); await w(300); out.gear.table = await vis(); A.togglePanel('table', false);
    A.startFitMode('Ebene'); await w(100); await A.previewByClick(A.hitAt([70, 52, 20], [0, 0, 1])); await w(300); out.gear.panel = await vis(); S.preview = null; S.mode = null; A.renderAll();
    const tb = g.querySelector('[data-vg="trans"]'); tb.click(); await w(100); out.trans = { on: A.viewTrans.on, amt: A.viewTrans.amt, op: A.viewer.model?.material?.opacity ?? null }; tb.click(); await w(50);
    // tree: groups, empty-space click clears, pin
    const names = [...document.querySelectorAll('#tree .node')].map((n) => n.textContent.trim()); out.groups = { data: names.some((t) => /^▾?Data/.test(t)), ref: names.some((t) => /^▾?Reference/.test(t)) };
    A.selectModel?.(); if (!S.selModel) document.querySelector('#tree .model-node')?.click(); await w(100); const selBefore = S.selModel;
    const tr = document.querySelector('#tree'); const tR = tr.getBoundingClientRect();
    tr.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: tR.left + 5, clientY: tR.bottom - 5 })); await w(100);
    out.deselect = { before: selBefore, after: S.selModel, sel: S.sel.length, cs: S.csSel };
    S.sel = [bf?.id]; A.renderAll(); tr.dispatchEvent(new MouseEvent('click', { bubbles: true })); await w(100); out.deselect.feat = S.sel.length;
    document.querySelector('#tree [data-pin="ref"]')?.click(); await w(100); document.querySelector('#tree [data-pin="data"]')?.click(); await w(100);
    const nodes = [...document.querySelectorAll('#tree .node')]; out.pin = { first: nodes[0]?.textContent.trim().slice(0, 12), sticky: getComputedStyle(nodes[0]).position, stored: localStorage.getItem('mw3d-tree-pins') };
    document.querySelector('#tree [data-pin="data"]')?.click(); document.querySelector('#tree [data-pin="ref"]')?.click(); await w(100);
    out.unpin = [...document.querySelectorAll('#tree .node')][0]?.textContent.trim().slice(0, 8);
    return out; });
  console.log(v.name, JSON.stringify(r));
  if (r.auxBefore_auto || r.auxBefore_Kreis || !r.auxAfterCircle || r.auxAfterPlane) fail(`${v.name}: aux options visibility ${r.auxBefore_auto} ${r.auxBefore_Kreis} ${r.auxAfterCircle} ${r.auxAfterPlane}`);
  if (!r.brush.stats || r.brush.contour || r.brush.created !== 1 || r.brush.preview || r.brush.method !== 'Pinsel' || r.brush.type !== 'Ebene') fail(`${v.name}: brush one step ${JSON.stringify(r.brush)}`);
  if (r.gearItems.includes('wcs') || r.gearItems.includes('iso') || !r.gearItems.includes('trans')) fail(`${v.name}: gear items ${r.gearItems}`);
  for (const [k, x] of Object.entries(r.gear)) if (!x.ok) fail(`${v.name}: gear menu cut off (${k}) ${JSON.stringify(x)}`);
  if (!r.trans.on) fail(`${v.name}: transparent toggle`);
  if (!r.groups.data || !r.groups.ref) fail(`${v.name}: tree groups ${JSON.stringify(r.groups)}`);
  if (!r.deselect.before || r.deselect.after || r.deselect.feat !== 0) fail(`${v.name}: empty tree click does not clear ${JSON.stringify(r.deselect)}`);
  if (!/^▾?Data/.test(r.pin.first) || r.pin.sticky !== 'sticky' || !/data/.test(r.pin.stored ?? '')) fail(`${v.name}: pin ${JSON.stringify(r.pin)}`);
  if (!/^▾?Objects/.test(r.unpin ?? '')) fail(`${v.name}: unpin ${r.unpin}`);
  if (r.slim.fill || r.slim.outl || r.slim.glim || !r.slim.nang || !r.slim.doc || !r.slim.isl) fail(`${v.name}: slim panel ${JSON.stringify(r.slim)}`);
  if (!(r.manIsl.chip && r.manIsl.n2 < r.manIsl.n1 && r.manIsl.n3 === r.manIsl.n1)) fail(`${v.name}: manual island ${JSON.stringify(r.manIsl)}`);
  if (!r.frozen.has || !r.frozen.json || r.frozen.runs.length !== 3 || new Set(r.frozen.runs).size !== 1 || r.frozen.runs[0] !== r.frozen.n0) fail(`${v.name}: frozen boundary ${JSON.stringify(r.frozen)}`);
  if (r.geoLink !== 'Geometric properties ›') fail(`${v.name}: geometric properties link ${r.geoLink}`);
  if (errors.length) fail(`${v.name}: page errors ${errors}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'ui033-check: FEHLER' : 'ui033-check: OK');
