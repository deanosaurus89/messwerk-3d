// 0.38 F13 + F15 (Martin 19.10. 23:57): ⚙ above the nav cube stays visible/clickable during feature creation (desktop + iPhone);
// data object opaque by default (also with a stored Analyze “Transparent” flag) and ⚙ › Transparent toggles it.
// Aufruf: node e2e/view-check.mjs [URL|-]
import { chromium, devices } from 'playwright';
const url = (process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null) ?? process.env.APPURL ?? null;
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
let srv = null; let base = url;
if (!base) { const { spawn } = await import('node:child_process'); srv = spawn('npx', ['serve', '-l', '8795', 'dist'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 2500)); base = 'http://localhost:8795/'; }
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [n, opt] of [['desktop', { viewport: { width: 1400, height: 900 } }], ['iphone', devices['iPhone 13']]]) {
  const ctx = await b.newContext(opt); await ctx.addInitScript(() => { if (!sessionStorage.getItem('x')) { localStorage.setItem('mw3d-trans', '1'); sessionStorage.setItem('x', '1'); } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '?nodemo'); await p.waitForTimeout(2000);
  await p.setInputFiles('#file', 'public/samples/beispielteil.stl');
  await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(4000);
  await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
  const op = () => p.evaluate(() => { const m = window.__app.viewer.model.material; return +(Array.isArray(m) ? m[0] : m).opacity.toFixed(2); });
  const o0 = await op(); if (o0 !== 1) fail(`${n}: data object not opaque by default (opacity ${o0})`);
  const gearOk = () => p.evaluate(() => { const g = document.querySelector('#view-gear .vg-btn'); if (!g) return 'missing'; const r = g.getBoundingClientRect(); if (!r.width) return 'hidden';
    const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return g.contains(e) || e === g ? 'ok' : 'covered by ' + (e?.id || e?.className || e?.tagName); });
  const g0 = await gearOk(); if (g0 !== 'ok') fail(`${n}: gear not visible without tool: ${g0}`);
  for (const t of ['auto', 'Ebene']) { await p.evaluate((t) => window.__app.startFitMode(t), t); await p.waitForTimeout(700); await p.evaluate(() => document.querySelectorAll('#ctx-panel details').forEach((d) => (d.open = true))); await p.waitForTimeout(300); const g = await gearOk(); if (g !== 'ok') fail(`${n}: gear during feature creation (${t}): ${g}`); }
  // toggle transparent via gear menu (programmatic click on the menu entry)
  await p.evaluate(() => document.querySelector('#view-gear [data-vg="trans"]').click()); await p.waitForTimeout(400); const o1 = await op();
  await p.evaluate(() => document.querySelector('#view-gear [data-vg="trans"]').click()); await p.waitForTimeout(400); const o2 = await op();
  if (!(o1 < 1)) fail(`${n}: ⚙ › Transparent had no effect (${o1})`); if (o2 !== 1) fail(`${n}: ⚙ › Transparent off did not restore opaque (${o2})`);
  console.log(n, 'opacity', o0, o1, o2, 'gear', g0); await p.screenshot({ path: `/tmp/view-${n}.png` });
  if (errs.length) fail(`${n}: page errors ${errs}`); await ctx.close();
}
await b.close(); srv?.kill(); console.log('view-check:', process.exitCode ? 'FEHLER' : 'OK');
