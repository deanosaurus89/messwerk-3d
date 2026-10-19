// Datums A|B|C (ISO 5459) on the demo part: Position + Perpendicularity of the hole, ISO vs. least-squares datums,
// oblique TED, datum info table, Analyze (zone = table value), Ø/2-planes toggle of the perpendicularity zone.
// Aufruf: node e2e/datums-check.mjs [URL|-] [desk|iphone]   (URL also via APPURL)
import { chromium, devices } from 'playwright';
const a2 = process.argv[2], a3 = process.argv[3];
const isMode = (x) => x === 'desk' || x === 'iphone';
const url = (a2 && a2 !== '-' && !isMode(a2) ? a2 : null) ?? process.env.APPURL ?? 'http://localhost:5175/';
const only = isMode(a2) ? a2 : a3;
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [n, opt] of [['desk', { viewport: { width: 1400, height: 900 } }], ['iphone', devices['iPhone 13']]].filter(([n]) => !only || only === n)) {
  const p = await (await b.newContext(opt)).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url + '?nodemo'); await p.waitForTimeout(2000);
  await p.setInputFiles('#file', 'public/samples/beispielteil.stl');
  await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(5000);
  await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
  const r = await p.evaluate(async () => { const A = window.__app, T = A.TRAIN_FEATS, S = A.state;
    const pl = []; for (const k of ['A', 'B', 'C']) { await A.ensureFeature('Ebene', T[k][1], T[k][2], (f) => f.type === 'Ebene' && !pl.includes(f.id) && Math.abs(f.measured.normal[0] * T[k][2][0] + f.measured.normal[1] * T[k][2][1] + f.measured.normal[2] * T[k][2][2]) > 0.99); const f = S.features.filter((f) => f.type === 'Ebene' && !pl.includes(f.id)).pop(); pl.push(f.id); A.setDatum(f, k); }
    await A.ensureFeature('Zylinder', T.H[1], T.H[2], (f) => f.type === 'Zylinder'); const cy = S.features.find((f) => f.type === 'Zylinder');
    A.addControl('Position', cy.id); const pos = S.controls[S.controls.length - 1]; pos.datumIds = pl.slice();
    A.addControl('Rechtwinkligkeit', cy.id); const per = S.controls[S.controls.length - 1]; per.datumIds = [pl[0]]; A.renderAll();
    const ev = (c) => { const e = A.evaluateControl(c.id); return e.flag ?? +e.measured.toFixed(5); };
    const out = { datums: pl.map((id) => S.features.find((f) => f.id === id).name), cyl: cy.measured.center.map((v) => +v.toFixed(3)) };
    out.posMissing = ev(pos); pos.basic = [20, 20, null]; out.posISO = ev(pos); out.posDetail = A.evaluateControl(pos.id).detail;
    out.perISO = ev(per); per.dia = false; out.perPlanes = ev(per); per.dia = undefined;
    pos.basic = [20, 20, null, 2, 0]; out.posOblique2deg = ev(pos); pos.basic = [20, 20, null];
    S.opts.datumAssoc = 'lsq'; out.posLSQ = ev(pos); out.perLSQ = ev(per); S.opts.datumAssoc = 'iso'; A.renderAll();
    document.querySelector('#btn-datum-info').click(); await new Promise((r) => setTimeout(r, 300));
    out.info = [...document.querySelectorAll('#help-view tbody tr')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()); document.querySelector('#hv-close')?.click();
    await A.analyzeControl(pos.id); await new Promise((r) => setTimeout(r, 2500));
    out.legend = document.querySelector('#dev-legend')?.textContent.replace(/\s+/g, ' ').slice(0, 420);
    out.panel = document.querySelector('.an-ctrl')?.textContent.replace(/\s+/g, ' ');
    out.zoneVsTable = [S.an.res.axes[0].zone, A.evaluateControl(pos.id).measured];
    return out; });
  console.log(n, JSON.stringify(r, null, 1));
  const num = (x) => typeof x === 'number' && isFinite(x);
  if (r.posMissing !== 'Nominal unconfirmed') fail(`${n}: Position without TEDs should be flagged (${r.posMissing})`);
  if (!(num(r.posISO) && r.posISO < 0.1)) fail(`${n}: Position ISO ${r.posISO}`);
  if (!(num(r.posLSQ) && r.posLSQ < r.posISO)) fail(`${n}: Position LSQ datums ${r.posLSQ}`);
  if (!(num(r.posOblique2deg) && r.posOblique2deg > 1)) fail(`${n}: oblique TED 2° should give a large deviation (${r.posOblique2deg})`);
  if (!num(r.perISO) || !num(r.perPlanes) || !num(r.perLSQ)) fail(`${n}: Perpendicularity ${r.perISO} / ${r.perPlanes} / ${r.perLSQ}`);
  if (r.info.length < 3) fail(`${n}: datum info table rows ${r.info.length}`);
  if (!(Math.abs(r.zoneVsTable[0] - r.zoneVsTable[1]) < 1e-9)) fail(`${n}: Analyze zone ${r.zoneVsTable}`);
  await p.screenshot({ path: `/tmp/abc-${n}-pos.png` });
  const per = await p.evaluate(async () => { const A = window.__app, S = A.state, c = S.controls.find((c) => c.kind === 'Rechtwinkligkeit'); await A.analyzeControl(c.id); await new Promise((r) => setTimeout(r, 2000));
    const b = document.querySelector('.an-ctrl .dia-tg'); const before = document.querySelector('#dev-legend')?.textContent.match(/zone[^m]*?\d+\.\d+/)?.[0]; b?.click(); await new Promise((r) => setTimeout(r, 2000));
    return { btn: !!b, before, after: document.querySelector('#dev-legend')?.textContent.match(/zone[^m]*?\d+\.\d+/)?.[0], dia: c.dia }; });
  console.log(n, 'perp Ø toggle', JSON.stringify(per));
  if (!per.btn || per.dia !== false) fail(`${n}: Ø / 2-planes toggle of the perpendicularity zone (${JSON.stringify(per)})`);
  await p.screenshot({ path: `/tmp/abc-${n}-perp.png` });
  // datum rename / remove / reassign (from the retired props-check): controls follow the feature
  const dr = await p.evaluate(() => { const A = window.__app, S = A.state, f = S.features.find((x) => x.datum === 'A'), pos = S.controls.find((c) => c.kind === 'Position');
    const v0 = A.evaluateControl(pos.id).measured; A.setDatum(f, 'D'); const d1 = f.datum, v1 = A.evaluateControl(pos.id).measured;
    A.setDatum(f, null); const d2 = f.datum ?? null; A.setDatum(f, 'A'); const d3 = f.datum, v3 = A.evaluateControl(pos.id).measured; return { d1, d2, d3, v0, v1, v3, ids: pos.datumIds.includes(f.id) }; });
  console.log(n, 'datum rename', JSON.stringify(dr));
  if (dr.d1 !== 'D' || dr.d2 !== null || dr.d3 !== 'A' || dr.v1 !== dr.v0 || dr.v3 !== dr.v0) fail(`${n}: datum rename/remove/reassign (${JSON.stringify(dr)})`);
  console.log(n, 'errors', errs); if (errs.length) fail(`${n}: page errors`);
}
await b.close();
console.log(process.exitCode ? 'datums-check: FEHLER' : 'datums-check: OK');
