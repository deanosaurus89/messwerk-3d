// 0.37 BLOCKER (Martin 19.10. 21:54, t106u): Analyze › 🔗 Derive › median line / zone planes / MZ axis – the confirm
// button (＋ Add to tree) and ✕ must show visible text at 390 px (iPhone) and desktop, and adding must work.
// Aufruf: node e2e/derive-check.mjs [URL|-]
import { chromium, devices } from 'playwright';
const url = (process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null) ?? process.env.APPURL ?? null;
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
let srv = null; let base = url;
if (!base) { const { spawn } = await import('node:child_process'); srv = spawn('npx', ['serve', '-l', '8793', 'dist'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 2500)); base = 'http://localhost:8793/'; }
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [n, opt] of [['desktop', { viewport: { width: 1400, height: 900 } }], ['iphone', devices['iPhone 13']]]) {
  const p = await (await b.newContext(opt)).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '?nodemo'); await p.waitForTimeout(2000);
  await p.setInputFiles('#file', 'public/samples/beispielteil.stl');
  await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(5000);
  await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
  const r = await p.evaluate(async () => { const A = window.__app, T = A.TRAIN_FEATS, S = A.state; const w = (ms) => new Promise((r) => setTimeout(r, ms));
    await A.ensureFeature('Ebene', T.A[1], T.A[2], (f) => f.type === 'Ebene');
    await A.ensureFeature('Zylinder', T.H[1], T.H[2], (f) => f.type === 'Zylinder'); const cy = S.features.find((f) => f.type === 'Zylinder');
    A.addControl('Rechtwinkligkeit', cy.id); const per = S.controls[S.controls.length - 1]; per.datumIds = [S.features.find((f) => f.type === 'Ebene').id]; A.renderAll();
    await A.analyzeControl(per.id); await w(2500);
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); const txt = el.innerText.trim();
      return { txt, w: Math.round(r.width), h: Math.round(r.height), fs: cs.fontSize, color: cs.color, bg: cs.backgroundColor, bgi: cs.backgroundImage.slice(0, 60), op: cs.opacity, vis: cs.visibility, inView: r.width > 0 && r.right <= innerWidth + 1 && r.left >= -1 }; };
    const menu = document.querySelector('[data-dv="menu"]'); const out = { menu: vis(menu), items: [] };
    if (!menu) return out;
    menu.click(); await w(300); const items = [...document.querySelectorAll('.ctx-menu button, #ctx-menu button, .menu button')].map((x) => x.textContent.trim()); out.menuItems = items;
    const mi = [...document.querySelectorAll('.ctx-menu button, #ctx-menu button, .menu button')].find((x) => /median line/.test(x.textContent)); mi?.click(); await w(1500);
    out.add = vis(document.querySelector('[data-dv="add"]')); out.x = vis(document.querySelector('[data-dv="x"]'));
    const n0 = S.features.length; document.querySelector('[data-dv="add"]')?.click(); await w(800); out.added = S.features.length - n0;
    return out; });
  console.log(n, JSON.stringify(r));
  await p.screenshot({ path: `/tmp/derive-${n}.png` });
  if (!r.menu?.txt) fail(`${n}: Derive button empty`);
  const lum = (c) => { const m = (c ?? '').match(/\d+/g)?.map(Number) ?? [0, 0, 0]; return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]; };
  if (r.add && Math.abs(lum(r.add.color) - lum(r.add.bg)) < 80) fail(`${n}: confirm button text has no contrast to its background (${r.add.color} on ${r.add.bg}) – looks empty`);
  if (!r.add || !/Add to tree/.test(r.add.txt) || r.add.w < 30 || parseFloat(r.add.fs) < 9 || !r.add.inView) fail(`${n}: confirm button not visible/empty ${JSON.stringify(r.add)}`);
  if (!r.x?.txt) fail(`${n}: discard button empty`);
  if (r.added !== 1) fail(`${n}: Add to tree did not add the derived feature (${r.added})`);
  if (errs.length) fail(`${n}: page errors ${errs}`);
}
await b.close(); srv?.kill(); console.log('derive-check:', process.exitCode ? 'FEHLER' : 'OK');
