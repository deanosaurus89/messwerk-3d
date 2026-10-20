// 0.39 (Martin 10:39): in Analyze every label (zone, envelope/Hülle, nominal, geometry values) is draggable like the
// feature labels – mouse and touch – and its position stays (re-render and project state).
// Aufruf: node e2e/anlabels-check.mjs [URL|-]
import { chromium, devices } from 'playwright';
const url = (process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null) ?? process.env.APPURL ?? null;
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
let srv = null; let base = url;
if (!base) { const { spawn } = await import('node:child_process'); srv = spawn('npx', ['serve', '-l', '8794', 'dist'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 2500)); base = 'http://localhost:8794/'; }
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [n, opt] of [['desktop', { viewport: { width: 1400, height: 900 } }], ['iphone', devices['iPhone 13']]]) {
  const p = await (await b.newContext(opt)).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '?nodemo'); await p.waitForTimeout(2000);
  await p.setInputFiles('#file', 'public/samples/beispielteil.stl');
  await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(5000);
  await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
  const r0 = await p.evaluate(async () => { const A = window.__app, T = A.TRAIN_FEATS, S = A.state; const w = (ms) => new Promise((r) => setTimeout(r, ms));
    await A.ensureFeature('Ebene', T.A[1], T.A[2], (f) => f.type === 'Ebene');
    await A.ensureFeature('Zylinder', T.H[1], T.H[2], (f) => f.type === 'Zylinder'); const cy = S.features.find((f) => f.type === 'Zylinder');
    A.addControl('Rechtwinkligkeit', cy.id); const per = S.controls[S.controls.length - 1]; per.datumIds = [S.features.find((f) => f.type === 'Ebene').id]; A.renderAll();
    await A.analyzeControl(per.id); await w(2000);
    for (const k of Object.keys(S.an.axLab)) S.an.axLab[k] = true; S.an.axEnv = true; A.renderAll(); await w(800);
    const L = [...document.querySelectorAll('#labels .lbl')].filter((e) => +e.dataset.fid <= -1000 && e.offsetParent !== null);
    return { n: L.length, texts: L.map((e) => e.innerText.trim()), env: L.some((e) => /envelope|Hülle/i.test(e.innerText)) }; });
  console.log(n, JSON.stringify(r0));
  if (r0.n < 2 || !r0.env) { fail(`${n}: analysis labels (incl. envelope) not shown as draggable labels ${JSON.stringify(r0)}`); continue; }
  // drag the envelope label by 80/60 px
  // ein Analyse-Label, das sichtbar (nicht von Panel/Toast verdeckt) ist – bevorzugt die Hülle
  await p.waitForTimeout(3500); await p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const fid = await p.evaluate(() => { const L = [...document.querySelectorAll('#labels .lbl')].filter((e) => +e.dataset.fid <= -1000);
    const hit = (e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t === e || e.contains(t); };
    const ok = L.filter(hit); return (ok.find((e) => /envelope|Hülle/i.test(e.innerText)) ?? ok[0])?.dataset.fid ?? null; });
  if (!fid) { fail(`${n}: no analysis label is reachable (all covered)`); continue; }
  const L = p.locator(`#labels .lbl[data-fid="${fid}"]`); const bb = await L.boundingBox();
  const sx = bb.x + bb.width / 2, sy = bb.y + bb.height / 2;
  if (n === 'iphone') { // echter Touch (CDP), wie ein Finger
    const c = await p.context().newCDPSession(p); const t = (type, x, y) => c.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await t('touchStart', sx, sy); for (let i = 1; i <= 8; i++) { await t('touchMove', sx + 10 * i, sy + 7.5 * i); await p.waitForTimeout(20); } await t('touchEnd'); await p.waitForTimeout(500);
  } else { await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(sx + 40, sy + 30, { steps: 4 }); await p.mouse.move(sx + 80, sy + 60, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500); }
  const bb2 = await L.boundingBox();
  const r1 = await p.evaluate(async () => { const A = window.__app, S = A.state; const ids = [...S.labelOffsets.keys()].filter((k) => k <= -1000); A.renderAll(); await new Promise((r) => setTimeout(r, 600)); return { ids }; });
  const bb3 = await L.boundingBox();
  console.log(n, 'moved', Math.round(bb2.x - bb.x), Math.round(bb2.y - bb.y), 'after re-render', Math.round(bb3.x - bb.x), Math.round(bb3.y - bb.y), JSON.stringify(r1));
  if (Math.hypot(bb2.x - bb.x - 80, bb2.y - bb.y - 60) > 15) fail(`${n}: envelope label did not follow the drag`);
  if (!r1.ids.length) fail(`${n}: dragged analysis label position not stored`);
  if (Math.hypot(bb3.x - bb2.x, bb3.y - bb2.y) > 3) fail(`${n}: position lost after re-render`);
  if (errs.length) fail(`${n}: page errors ${errs}`);
}
await b.close(); srv?.kill(); console.log('anlabels-check:', process.exitCode ? 'FEHLER' : 'OK');
