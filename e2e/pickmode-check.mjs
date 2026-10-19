// 0.38 Regression (Martin 19.10. 23:35): Pick-Modus auf dem Desktop – in Auto/typisiertem Klick & Wachsen ändert die Maus
// die Ansicht nicht (Ziehen dreht nicht, Rad zoomt nicht), das Rad ändert den Pick-Radius; Leertaste = Navigation, wieder Leertaste = Pick.
// Aufruf: node e2e/pickmode-check.mjs [URL|-]
import { chromium } from 'playwright';
const url = (process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null) ?? process.env.APPURL ?? null;
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
let srv = null; let base = url;
if (!base) { const { spawn } = await import('node:child_process'); srv = spawn('npx', ['serve', '-l', '8794', 'dist'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 2500)); base = 'http://localhost:8794/'; }
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(base + '?nodemo'); await p.waitForTimeout(2000);
await p.setInputFiles('#file', 'public/samples/beispielteil.stl');
await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(4000);
await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
const cam = () => p.evaluate(() => { const v = window.__app.viewer, c = v.camera, t = v.controls.target; return [c.position.x, c.position.y, c.position.z, c.zoom, t.x, t.y, t.z].map((x) => +x.toFixed(4)).join(','); });
const pick = () => p.evaluate(() => String(window.__app.state.opts.pick));
const box = await p.locator('canvas').first().boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const drag = async () => { await p.mouse.move(cx, cy); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(cx + i * 15, cy + i * 6); await p.mouse.up(); await p.waitForTimeout(500); };
const wheel = async () => { await p.mouse.move(cx - 100, cy); await p.mouse.wheel(0, -300); await p.waitForTimeout(500); };
for (const t of ['auto', 'Zylinder']) {
  await p.evaluate((t) => window.__app.startFitMode(t), t); await p.waitForTimeout(500);
  const c0 = await cam(); await drag(); const c1 = await cam(); if (c1 !== c0) fail(`${t}: drag in pick mode changed the view`);
  const r0 = await pick(); await wheel(); const c2 = await cam(); const r1 = await pick();
  if (c2 !== c1) fail(`${t}: wheel in pick mode zoomed`); if (r1 === r0) fail(`${t}: wheel did not change the pick radius (${r0})`);
  console.log(t, 'pick', r0, '->', r1);
  await p.keyboard.press('Space'); await p.waitForTimeout(300); await drag(); const c3 = await cam(); if (c3 === c2) fail(`${t}: Space navigation – drag did not rotate`);
  await wheel(); const c4 = await cam(); if (c4 === c3) fail(`${t}: Space navigation – wheel did not zoom`);
  await p.keyboard.press('Space'); await p.waitForTimeout(300); await drag(); if ((await cam()) !== c4) fail(`${t}: back in pick mode the drag changed the view`);
  await p.evaluate(() => { const A = window.__app; A.state.mode = null; A.viewer.controls.enabled = true; }); await p.waitForTimeout(200);
}
const n0 = await cam(); await drag(); if ((await cam()) === n0) fail('no tool: drag does not rotate');
if (errs.length) fail('page errors ' + errs);
await b.close(); srv?.kill(); console.log('pickmode-check:', process.exitCode ? 'FEHLER' : 'OK');
