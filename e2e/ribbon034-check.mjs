// 0.34 Start ribbon regression: ONE Properties and ONE Delete act on the current selection – a selected coordinate
// system (Properties → edit, Delete → deletes only the CS) and a selected feature (Properties → feature dialog,
// Delete → deletes the feature); Global (WCS) can be neither; CS group = New 3-2-1 + Activate only; QAT ↶ (mesh undo)
// and ↷ (disabled). Desktop 1400 px + iPhone 390 px.  Aufruf: node e2e/ribbon034-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8772/'; srv = spawn('npx', ['serve', '-l', '8772', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  await page.evaluate(() => document.querySelector('#ribbon-tabs [data-tab="merkmale"]').click()); await sleep(200);
  const r = await page.evaluate(async (phone) => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    const q = (s) => document.querySelector(s), vis = (s) => { const e = q(s); return !!e && !!e.offsetParent; };
    const sec = (k) => { if (phone) document.querySelectorAll('#ribbon .panel[data-tab="merkmale"] .rsec-nav > button')[k].click(); };
    const mk = async (mode, p, n) => { S.preview = null; S.opts.pick = 1.5; A.startFitMode(mode); await w(50); await A.previewByClick(A.hitAt(p, n)); await w(100); const k = S.features.length; await A.commitPreview(); await w(100); S.mode = null; S.preview = null; return S.features[k]; };
    const T = A.TRAIN_FEATS; const a = await mk('Ebene', T.A[1], T.A[2]), b = await mk('Ebene', T.B[1], T.B[2]), c = await mk('Ebene', T.C[1], T.C[2]);
    const circ = await mk('Kreis', [20, 26.84, 20], [0, 0, 1]);
    S.sel = []; A.csNew(); A.csPick(a.id); A.csPick(b.id); A.csPick(c.id); A.csOk(); await w(200); const cs = S.csys.at(-1); A.renderAll(); await w(100);
    // ribbon content: CS group only New 3-2-1 + Activate; no From datums / Global / Show all / View along Z / second Edit+Delete
    sec(1); await w(100);
    out.csGroup = [...q('#btn-cs-new').closest('.group').querySelectorAll('button')].map((b) => (b.querySelector('span:not(.ico)')?.textContent ?? b.textContent).trim());
    out.gone = ['#btn-cs-datum', '#btn-cs-global', '#btn-cs-show', '#btn-cs-view', '#btn-cs-edit', '#btn-cs-del', '#btn-pe-undo'].filter((s) => q(s));
    out.propsN = document.querySelectorAll('#ribbon .panel[data-tab="merkmale"] #btn-props').length; out.delN = [...document.querySelectorAll('#ribbon .panel[data-tab="merkmale"] button')].filter((b) => /Delete/.test(b.textContent)).length;
    sec(0); await w(100);
    // 1) selected CS → Properties edits it
    A.csSelect(cs.id); await w(100); out.csPropsEnabled = !q('#btn-props').disabled; out.csPropsVis = vis('#btn-props');
    q('#btn-props').click(); await w(200); out.csEdit = S.csEdit?.draft?.id === cs.id; A.csCancel(); await w(100);
    // 2) Global (WCS) selected → both disabled
    A.csSelect(0); await w(100); out.globalDisabled = q('#btn-props').disabled && q('#btn-delete-feat').disabled;
    // 3) selected feature → Properties opens its dialog (Geometric properties link visible)
    A.selectFeature(circ.id); await w(200); out.featPropsEnabled = !q('#btn-props').disabled; q('#btn-props').click(); await w(300);
    out.featDlg = S.sel.length === 1 && S.sel[0] === circ.id && !!q('#d-props') && S.csEdit == null;
    // 4) selected feature → Delete deletes only that feature
    const nf = S.features.length, ncs = S.csys.length; A.selectFeature(circ.id); await w(100); q('#btn-delete-feat').click(); await w(200);
    out.featDel = S.features.length === nf - 1 && !S.features.some((f) => f.id === circ.id) && S.csys.length === ncs;
    // 5) selected CS → Delete deletes only the CS (features stay)
    const nf2 = S.features.length; A.csSelect(cs.id); await w(100); out.csDelEnabled = !q('#btn-delete-feat').disabled; q('#btn-delete-feat').click(); await w(200);
    out.csDel = !S.csys.some((x) => x.id === cs.id) && S.features.length === nf2;
    // 6) nothing selected → both disabled
    A.clearSelection(); await w(100); out.noneDisabled = q('#btn-props').disabled && q('#btn-delete-feat').disabled;
    // QAT: ↶ in the title bar (desktop) / at the end of the chip row (iPhone); ↷ disabled
    const u = phone ? '#q-undo-p' : '#q-undo', rd = phone ? '#q-redo-p' : '#q-redo';
    out.qat = { undoVis: vis(u), redoDisabled: q(rd)?.disabled === true, undoDisabled: q(u)?.disabled === true, other: vis(phone ? '#q-undo' : '#q-undo-p') };
    if (phone) { const nav = q('#ribbon .panel[data-tab="merkmale"] .rsec-nav'), pq = nav.querySelector('.pqat'); out.qat.inRow = Math.abs(pq.getBoundingClientRect().top - nav.querySelector('button').getBoundingClientRect().top) < 6 && pq.getBoundingClientRect().right <= innerWidth; out.qat.navH = nav.getBoundingClientRect().height; }
    // mesh group: ⋯ More › Subdivide starts the tool; a Reduce run enables ↶, the group label shows the edit; ↶ restores
    sec(2); await w(100); q('#btn-mesh-more').click(); await w(100); const pop = q('#mesh-more-pop'); out.meshPop = !pop.classList.contains('hidden');
    pop.querySelector('[data-pe="subdiv"]').click(); await w(150); out.subdiv = A.pe.tool === 'subdiv' && pop.classList.contains('hidden');
    q('[data-pe="reduce"]').click(); await w(150); const t0 = S.data.triCount; out.reduceTool = A.pe.tool === 'reduce';
    await A.peRun(); for (let i = 0; i < 300 && (A.pe.running || !A.pe.undo.length); i++) await w(200);
    out.meshSt = [t0, S.data.triCount, A.pe.undo.length, document.querySelector('#status')?.textContent]; out.edited = S.data.triCount < t0 && !q(u).disabled && /edit/.test(q('#pe-info').textContent);
    q(u).click(); for (let i = 0; i < 150 && S.data.triCount !== t0; i++) await w(200); out.undone = S.data.triCount === t0 && q(u).disabled;
    return out; }, v.name === 'iphone');
  console.log(v.name, JSON.stringify(r));
  const ok = (c, m) => { if (!c) fail(`${v.name}: ${m}`); };
  ok(JSON.stringify(r.csGroup) === JSON.stringify(['New 3-2-1', 'Activate']), `CS group ${JSON.stringify(r.csGroup)}`);
  ok(!r.gone.length, `removed buttons still there: ${r.gone}`); ok(r.propsN === 1 && r.delN === 1, `Properties ${r.propsN} / Delete ${r.delN} (expected 1/1)`);
  ok(r.csPropsEnabled && r.csPropsVis && r.csEdit, 'Properties on a selected CS does not edit it'); ok(r.globalDisabled, 'Global (WCS): Properties/Delete not disabled');
  ok(r.featPropsEnabled && r.featDlg, 'Properties on a selected feature'); ok(r.featDel, 'Delete on a selected feature'); ok(r.csDelEnabled && r.csDel, 'Delete on a selected CS');
  ok(r.noneDisabled, 'no selection: Properties/Delete not disabled');
  ok(r.qat.undoVis && r.qat.redoDisabled && r.qat.undoDisabled && !r.qat.other, `QAT ${JSON.stringify(r.qat)}`); if (v.name === 'iphone') ok(r.qat.inRow && r.qat.navH < 34, `QAT not in the chip row ${JSON.stringify(r.qat)}`);
  ok(r.meshPop && r.subdiv, 'mesh ⋯ More › Subdivide'); ok(r.reduceTool && r.edited && r.undone, `mesh edit + QAT ↶ (${r.reduceTool}/${r.edited}/${r.undone})`);
  if (errors.length) fail(`${v.name}: page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
if (!process.exitCode) console.log('ribbon034-check: OK'); else console.log('ribbon034-check: FEHLER');
