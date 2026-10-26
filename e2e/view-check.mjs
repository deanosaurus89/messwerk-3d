// 0.38 F13 + 0.41: ⚙ above the nav cube stays visible/clickable during feature creation (desktop + iPhone).
// At 390 px the gear button, the nav cube and the context window do not overlap.
// Transparency is one stored setting: with nothing stored the data object is opaque, and ⚙ › Transparent toggles it.
// Aufruf: node e2e/view-check.mjs [URL|-]
import { chromium, devices } from 'playwright';
const url = (process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null) ?? process.env.APPURL ?? null;
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
let srv = null; let base = url;
if (!base) { const { spawn } = await import('node:child_process'); srv = spawn('npx', ['serve', '-l', '8795', 'dist'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 2500)); base = 'http://localhost:8795/'; }
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [n, opt] of [['desktop', { viewport: { width: 1400, height: 900 } }], ['iphone', devices['iPhone 13']]]) {
  const ctx = await b.newContext(opt); await ctx.addInitScript(() => { localStorage.removeItem('mw3d-trans'); });
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
  for (const t of ['auto', 'Ebene']) {
    await p.evaluate((t) => window.__app.startFitMode(t), t); await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelectorAll('#ctx-panel details').forEach((d) => (d.open = true))); await p.waitForTimeout(300);
    const g = await gearOk(); if (g !== 'ok') fail(`${n}: gear during feature creation (${t}): ${g}`);
    const boxes = await p.evaluate(() => {
      window.__app.placeFloaters();
      const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      return { gear: box('#view-gear .vg-btn'), cube: box('#navcube'), panel: box('#ctx-panel') };
    });
    const hit = (a, c) => a && c && a.w > 2 && c.w > 2 && a.l < c.r - 1 && a.r > c.l + 1 && a.t < c.b - 1 && a.b > c.t + 1;
    if (n === 'iphone') {
      if (hit(boxes.gear, boxes.panel)) fail(`${n}: view gear overlaps the context window (${t}) ${JSON.stringify(boxes)}`);
      if (hit(boxes.cube, boxes.panel)) fail(`${n}: nav cube overlaps the context window (${t}) ${JSON.stringify(boxes)}`);
      if (hit(boxes.gear, boxes.cube)) fail(`${n}: view gear overlaps the nav cube (${t}) ${JSON.stringify(boxes)}`);
    }
  }
  // toggle transparent via gear menu (programmatic click on the menu entry)
  await p.evaluate(() => document.querySelector('#view-gear [data-vg="trans"]').click()); await p.waitForTimeout(400); const o1 = await op();
  await p.evaluate(() => document.querySelector('#view-gear [data-vg="trans"]').click()); await p.waitForTimeout(400); const o2 = await op();
  if (!(o1 < 1)) fail(`${n}: ⚙ › Transparent had no effect (${o1})`); if (o2 !== 1) fail(`${n}: ⚙ › Transparent off did not restore opaque (${o2})`);
  console.log(n, 'opacity', o0, o1, o2, 'gear', g0); await p.screenshot({ path: `/tmp/view-${n}.png` });
  if (errs.length) fail(`${n}: page errors ${errs}`); await ctx.close();
}
await b.close(); srv?.kill(); console.log('view-check:', process.exitCode ? 'FEHLER' : 'OK');
