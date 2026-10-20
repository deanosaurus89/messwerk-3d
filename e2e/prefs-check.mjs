// 0.27 preferences: Decimal places (Options ⇄ View ▸ Decimals, persistent, display only) and the optional general
// tolerance tables (off by default = no auto-fill / badge / fit field / ribbon group / report column).
// Aufruf: node e2e/prefs-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8769/'; srv = spawn('npx', ['serve', '-l', '8769', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
const load = async () => { await page.goto(BASE + '?nodemo'); await sleep(2500); await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(4000); };
await load();
const r = await page.evaluate(async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms)), T = A.TRAIN_FEATS, r = {};
  r.dec0 = document.getElementById('dec-val').textContent;
  await A.ensureFeature('Zylinder', T.H[1], T.H[2], (f) => f.type === 'Zylinder'); S.mode = null; S.preview = null; const f = S.features.find((x) => x.type === 'Zylinder');
  A.addControl('Durchmesser', f.id); const c = S.controls.at(-1); r.tolOff = { up: c.tolUp, lo: c.tolLo, src: c.tolSrc ?? null };
  S.sel = [f.id]; A.renderAll(); await w(500);
  r.gentolVisible = getComputedStyle(document.querySelector('.gentol')).display !== 'none';
  r.badge = !!document.querySelector('.tsrc'); r.fitField = !!document.querySelector('.fitcode');
  const lbl = () => [...document.querySelectorAll('.lbl')].map((e) => e.textContent).join(' ');
  r.lbl2 = (lbl().match(/\d+\.\d+/g) ?? []).slice(0, 4);
  document.getElementById('dec-plus').click(); await w(400); r.dec1 = document.getElementById('dec-val').textContent;
  r.lbl3 = (lbl().match(/\d+\.\d+/g) ?? []).slice(0, 4);
  document.getElementById('btn-options').click(); await w(300); r.optDec = document.getElementById('od-dec').value; r.optTol = document.getElementById('od-tol').checked;
  const o = document.getElementById('od-tol'); o.checked = true; o.dispatchEvent(new Event('change')); await w(300);
  document.querySelector('#opts-dlg [data-ok]').click();
  A.addControl('Durchmesser', f.id); const c2 = S.controls.at(-1); r.tolOn = { up: c2.tolUp, lo: c2.tolLo, src: c2.tolSrc ?? null };
  A.renderAll(); await w(300); r.badgeOn = !!document.querySelector('.tsrc'); r.gentolOn = getComputedStyle(document.querySelector('.gentol')).display !== 'none';
  document.getElementById('btn-annot-pts').click(); await w(300); r.apts = [S.annot.pts, document.getElementById('btn-annot-pts').classList.contains('on'), /pts/.test(lbl())];
  document.getElementById('btn-options').click(); await w(300); r.optPts = document.getElementById('od-pts').checked; document.querySelector('#opts-dlg [data-ok]').click();
  // 0.39: Options › Extraction › Search distance (default 1 mm, persistent)
  document.getElementById('btn-options').click(); await w(300); const sd = document.getElementById('od-sdist'); r.sdist0 = sd?.value; r.extrHead = [...document.querySelectorAll('#opts-dlg h4')].some((h) => /Extraction|Extraktion/.test(h.textContent));
  if (sd) { sd.value = '2.5'; sd.dispatchEvent(new Event('change')); } document.querySelector('#opts-dlg [data-ok]').click();
  r.exact = f.measured.diameter; return r; });
await page.reload(); await sleep(2500);
const r2 = await page.evaluate(async () => { document.getElementById('btn-options').click(); await new Promise((z) => setTimeout(z, 300)); const v = document.getElementById('od-sdist')?.value; document.querySelector('#opts-dlg [data-ok]').click(); return { sdist: v, apts: document.getElementById('btn-annot-pts').classList.contains('on'), dec: document.getElementById('dec-val').textContent, tol: document.body.classList.contains('tol-tables') }; }));
console.log(JSON.stringify({ r, r2 }));
if (r.dec0 !== '2') fail(`default decimals ${r.dec0} ≠ 2`);
if (r.tolOff.src || r.badge || r.fitField || r.gentolVisible) fail(`tolerance tables off but active: ${JSON.stringify(r)}`);
if (!r.lbl2.length || r.lbl2.some((x) => x.split('.')[1].length !== 2)) fail(`annotations not with 2 decimals: ${r.lbl2}`);
if (r.dec1 !== '3' || r.lbl3.some((x) => x.split('.')[1].length !== 3)) fail(`View ▸ Decimals + did not apply: ${r.dec1} ${r.lbl3}`);
if (r.optDec !== '3') fail(`Options not synced with the ribbon (${r.optDec})`);
if (r.optTol) fail('tolerance tables on by default');
if (!r.tolOn.src || !r.badgeOn || !r.gentolOn) fail(`tolerance tables on but inactive: ${JSON.stringify(r.tolOn)}`);
if (r2.dec !== '3' || !r2.tol) fail(`preferences not persistent: ${JSON.stringify(r2)}`);
if (!r.apts.every(Boolean) || !r.optPts || !r2.apts) fail(`View ▸ Annotations ▸ Point count not synced/persistent: ${JSON.stringify([r.apts, r.optPts, r2.apts])}`);
if (r.sdist0 !== '1' || !r.extrHead || r2.sdist !== '2.5') fail(`Options › Extraction › Search distance: default ${r.sdist0}, heading ${r.extrHead}, after reload ${r2.sdist}`);
if (errors.length) fail(`page errors ${errors.join(' | ')}`);
await browser.close(); srv?.kill();
if (!process.exitCode) console.log('OK: decimal places, annotation content toggles + optional tolerance tables');
