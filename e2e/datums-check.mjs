import { chromium, devices } from 'playwright';
const url = process.env.APPURL ?? 'http://localhost:5173/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [n, opt] of [['desk', { viewport: { width: 1400, height: 900 } }], ['iphone', devices['iPhone 13']]].filter(([n]) => !process.argv[2] || process.argv[2] === n)) {
  const p = await (await b.newContext(opt)).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url + '?nodemo'); await p.waitForTimeout(2000);
  await p.setInputFiles('#file', 'public/samples/beispielteil.stl');
  await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(5000);
  await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
  const r = await p.evaluate(async () => { const A = window.__app, T = A.TRAIN_FEATS, S = A.state;
    const pl = []; for (const k of ['A', 'B', 'C']) { await A.ensureFeature('Ebene', T[k][1], T[k][2], (f) => f.type === 'Ebene' && !pl.includes(f.id) && Math.abs(f.measured.normal[0] * T[k][2][0] + f.measured.normal[1] * T[k][2][1] + f.measured.normal[2] * T[k][2][2]) > 0.99); const f = S.features.filter((f) => f.type === 'Ebene' && !pl.includes(f.id)).pop(); pl.push(f.id); A.setDatum(f, k); }
    await A.ensureFeature('Zylinder', T.H[1], T.H[2], (f) => f.type === 'Zylinder'); const cy = S.features.find((f) => f.type === 'Zylinder');
    A.addControl('Position', cy.id); const pos = S.controls[S.controls.length - 1]; pos.datumIds = pl.slice();
    A.addControl('Rechtwinkligkeit', cy.id); const per = S.controls[S.controls.length - 1]; A.renderAll();
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
  await p.screenshot({ path: `/tmp/abc-${n}-pos.png` });
  const per = await p.evaluate(async () => { const A = window.__app, S = A.state, c = S.controls.find((c) => c.kind === 'Rechtwinkligkeit'); await A.analyzeControl(c.id); await new Promise((r) => setTimeout(r, 2000));
    const b = document.querySelector('.an-ctrl .dia-tg'); const before = document.querySelector('#dev-legend')?.textContent.match(/zone[^m]*?\d+\.\d+/)?.[0]; b?.click(); await new Promise((r) => setTimeout(r, 2000));
    return { btn: !!b, before, after: document.querySelector('#dev-legend')?.textContent.match(/zone[^m]*?\d+\.\d+/)?.[0], dia: c.dia }; });
  console.log(n, 'perp Ø toggle', JSON.stringify(per));
  await p.screenshot({ path: `/tmp/abc-${n}-perp.png` });
  console.log(n, 'errors', errs);
}
await b.close();
