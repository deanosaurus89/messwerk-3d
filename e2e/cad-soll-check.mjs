// 2026.0.43 prototype: Feature Builder Nominal/Actual override, and an Ist preview labelled Ist.
// Analytic CAD hit → Soll plane/circle is covered by tests/cadnominal.test.ts (OpenCascade). This check stays light:
// a two-triangle plate, no CAD kernel in the browser.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const stl = `solid plate
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 20 0 0
    vertex 20 20 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 20 20 0
    vertex 0 20 0
  endloop
endfacet
endsolid plate
`;
writeFileSync('/tmp/cad-soll-plate.stl', stl);

const port = 4179;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const srvLog = [];
srv.stdout?.on('data', (d) => srvLog.push(String(d)));
srv.stderr?.on('data', (d) => srvLog.push(String(d)));
for (let i = 0; i < 40 && !srvLog.join('').includes('ready'); i++) await sleep(200);
if (!srvLog.join('').includes('ready')) { console.log(srvLog.join('').slice(-2000)); throw new Error('vite did not start'); }
await sleep(200);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/?nodemo`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.setInputFiles('#file', '/tmp/cad-soll-plate.stl');
  await p.waitForSelector('#unit-dlg', { timeout: 60000 });
  await p.evaluate(() => document.querySelector('#unit-dlg [data-ok]').click());
  try {
    await p.waitForFunction(() => window.__app?.state?.data, null, { timeout: 30000 });
  } catch (e) {
    const info = await p.evaluate(() => ({ status: document.querySelector('#status')?.textContent, dlg: !!document.querySelector('#unit-dlg'), toast: document.querySelector('#toast')?.textContent, data: !!window.__app?.state?.data }));
    console.log('load stalled', JSON.stringify(info), errs.join(' | '));
    throw e;
  }
  await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
  await p.evaluate(() => window.__app.startFitMode('auto'));
  await p.waitForSelector('#cp-side', { state: 'attached', timeout: 10000 });
  await p.evaluate(() => { const d = document.querySelector('details.cp-params'); if (d) d.open = true; });
  const sel = await p.evaluate(() => {
    const s = document.querySelector('#cp-side');
    return { values: [...s.options].map((o) => o.value), side: window.__app.state.opts.side, inAdv: !!s.closest('details.cp-params') };
  });
  ok(sel.values.join(',') === 'auto,soll,ist' && sel.side === 'auto' && sel.inAdv, 'Advanced Nominal/Actual is Auto, Soll, Ist — default Auto');
  await p.selectOption('#cp-side', 'soll');
  ok(await p.evaluate(() => window.__app.state.opts.side === 'soll'), 'override Soll is stored');
  await p.selectOption('#cp-side', 'ist');
  ok(await p.evaluate(() => window.__app.state.opts.side === 'ist'), 'override Ist is stored');
  await p.selectOption('#cp-side', 'auto');
  // a mesh click (Ist) must label the pending feature Ist
  const labelled = await p.evaluate(async () => {
    const app = window.__app;
    app.state.opts.side = 'auto';
    const h = app.hitAt([10, 10, 0], [0, 0, 1]);
    if (!h) return { err: 'no hit' };
    await app.previewByClick(h);
    const badge = document.querySelector('#ctx-panel [data-side]');
    const f = app.state.preview;
    return { side: badge?.dataset.side ?? badge?.textContent ?? '', type: f?.fit?.type, role: f?.role ?? 'ist' };
  });
  ok(labelled.role === 'ist' && labelled.side === 'ist' && labelled.type, 'mesh preview is labelled Ist (' + JSON.stringify(labelled) + ')');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
} finally {
  await b.close();
  srv.kill('SIGTERM');
}
process.exit(fail ? 1 : 0);
