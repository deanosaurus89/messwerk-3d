// Kurvennetz bearbeiten: Hover, Klick-Auswahl (Baum), Kontrollpunkt ziehen, Punkt +/−, Teilen, Verbinden, Rückgängig, Vorschläge.
// Aufruf: node e2e/curves-edit.mjs [URL|-] [desktop|iphone] [key]
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null; const PH = process.argv[3] === 'iphone', KEY = process.argv[4] || 'flansch';
if (!URL) { URL = 'http://localhost:8769/'; srv = spawn('npx', ['serve', '-l', '8769', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const b = PH ? await webkit.launch() : await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await b.newContext(PH ? { ...devices['iPhone 14 Pro'] } : { viewport: { width: 1500, height: 900 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const S = (f, a) => page.evaluate(f, a); const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const idle = () => page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 60000 }).catch(() => {});
await page.goto(URL.includes('nodemo') ? URL : URL + (URL.includes('?') ? '&' : '?') + 'nodemo', { waitUntil: 'networkidle' });
await page.click('#btn-sample');
await page.click(`.sample-card[data-key="${KEY}"]`);
await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 });
await S(() => { document.querySelector('.tab[data-tab="re"]').click(); document.querySelector('#btn-curve-detect').click(); });
await page.waitForFunction(() => window.__app.state.layout, null, { timeout: 120000 }); await sleep(800);
if (PH) await S(() => document.body.classList.remove('show-tree', 'show-dialog'));
// sichtbare Kurvenstelle auf dem Bildschirm finden (pickCurve bestätigt)
const scr = (p) => S((p) => { const v = window.__app.viewer, r = v.renderer.domElement.getBoundingClientRect(); const q = new (v.camera.position.constructor)(...p).project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; }, p);
const target = await S(() => { const a = window.__app, v = a.viewer, r = v.renderer.domElement.getBoundingClientRect();
  for (const c of [...a.state.curves].sort((x, y) => y.length - x.length)) for (const f of [0.5, 0.3, 0.7]) { const p = c.pts[Math.floor(c.pts.length * f)]; const q = new (v.camera.position.constructor)(...p).project(v.camera);
    const x = r.left + (q.x + 1) / 2 * r.width, y = r.top + (1 - q.y) / 2 * r.height; if (y < r.top + 40 || y > r.bottom - 40 || x < r.left + 30 || x > r.right - 30) continue; if (document.elementFromPoint(x, y) !== v.renderer.domElement) continue; const h = v.pickCurve(x, y); if (h?.curveId === c.id) return { id: c.id, x, y, n: c.ctrl.length }; }
  return null; });
ok(!!target, 'sichtbare Kurve gefunden ' + JSON.stringify(target));
if (!PH) { await page.mouse.move(target.x, target.y); await sleep(300); ok(await S(() => window.__app.cv().hover) === target.id, 'Hover hebt Kurve hervor'); }
const visOn = (id) => S((id) => { const a = window.__app, v = a.viewer, r = v.renderer.domElement.getBoundingClientRect(); const c = a.state.curves.find((c) => c.id === id);
  for (let k = 0; k < 40; k++) { const p = c.pts[Math.floor(c.pts.length * (0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) / 42))]; const q = new (v.camera.position.constructor)(...p).project(v.camera); const x = r.left + (q.x + 1) / 2 * r.width, y = r.top + (1 - q.y) / 2 * r.height;
    if (y < r.top + 40 || y > r.bottom - 40 || x < r.left + 30 || x > r.right - 30) continue; if (document.elementFromPoint(x, y) !== v.renderer.domElement) continue; const h = v.pickCurve(x, y); if (h?.curveId === id && h.ctrl == null) return [x, y]; } return [0, 0]; }, id);
const tap = async (x, y) => { if (PH) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await sleep(400); await idle(); };
await tap(target.x, target.y);
ok(await S(() => window.__app.state.curveSel) === target.id, 'Klick wählt Kurve');
ok(await S((id) => !!document.querySelector(`.curve-node.sel[data-cid="${id}"], .curve-node.selected[data-cid="${id}"], .curve-node.active[data-cid="${id}"]`), target.id), 'Baum zeigt Auswahl');
await page.screenshot({ path: `${process.env.SHOT_DIR || 'docs'}/kurve-auswahl${PH ? '-iphone' : ''}.png` });
// Kontrollpunkt ziehen
const cp = await S((id) => { const a = window.__app, v = a.viewer, r = v.renderer.domElement.getBoundingClientRect(), c = a.state.curves.find((c) => c.id === id); const n = c.ctrl.length;
  for (let k = 0; k < n; k++) { const i = (Math.floor(n / 2) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) + n) % n; const q = new (v.camera.position.constructor)(...c.ctrl[i]).project(v.camera); const x = r.left + (q.x + 1) / 2 * r.width, y = r.top + (1 - q.y) / 2 * r.height;
    if (y < r.top + 60 || y > r.bottom - 60 || x < r.left + 60 || x > r.right - 60) continue; if (document.elementFromPoint(x, y) === v.renderer.domElement && v.pickCurve(x, y)?.ctrl === i && v.pick(x + 24, y + 16)) return { i, p: c.ctrl[i], len: c.length }; }
  return { i: 0, p: c.ctrl[0], len: c.length }; }, target.id);
const [cx, cy] = await scr(cp.p);
await page.mouse.move(cx, cy); await page.mouse.down(); for (let k = 1; k <= 8; k++) { await page.mouse.move(cx + k * 3, cy + k * 2); await sleep(30); } await page.mouse.up(); await sleep(600); await idle();
const after = await S(([id, i]) => { const a = window.__app, c = a.state.curves.find((c) => c.id === id); return { p: c.ctrl[i], len: c.length, undo: a.cv().undo.length }; }, [target.id, cp.i]);
ok(Math.hypot(after.p[0] - cp.p[0], after.p[1] - cp.p[1], after.p[2] - cp.p[2]) > 0.1 && after.undo >= 1, `Kontrollpunkt gezogen (Länge ${cp.len.toFixed(1)} → ${after.len.toFixed(1)} mm)`);
await page.screenshot({ path: `${process.env.SHOT_DIR || 'docs'}/kurve-ziehen${PH ? '-iphone' : ''}.png` });
const open = async () => { if (PH) await S(() => window.__app.togglePanel('dialog', true)); await sleep(300); };
const close = async () => { if (PH) { await S(() => window.__app.togglePanel('dialog', false)); await sleep(700); } };
// Punkt einfügen
await open(); await page.click('[data-ce="insert"]'); await close();
let [mx, my] = await visOn(target.id); await tap(mx, my);
const n1 = await S((id) => window.__app.state.curves.find((c) => c.id === id).ctrl.length, target.id); ok(n1 === target.n + 1, `Punkt eingefügt (${target.n} → ${n1})`);
// Punkt löschen
await open(); await page.click('[data-ce="delpt"]'); await close();
const c0 = await S((id) => window.__app.state.curves.find((c) => c.id === id).ctrl[Math.floor(window.__app.state.curves.find((c) => c.id === id).ctrl.length / 2)], target.id); [mx, my] = await scr(c0); await tap(mx, my);
const n2 = await S((id) => window.__app.state.curves.find((c) => c.id === id).ctrl.length, target.id); ok(n2 === n1 - 1, `Punkt gelöscht (${n1} → ${n2})`);
// Teilen
const nc = await S(() => window.__app.state.curves.length);
await open(); await page.click('[data-ce="split"]'); await close();
[mx, my] = await visOn(target.id); await tap(mx, my);
ok(await S(() => window.__app.state.curves.length) === nc + 1, 'Kurve geteilt');
// Verbinden (mit dem abgeteilten Stück)
const other = await S(() => { const s = window.__app.state; return s.curves[s.curves.findIndex((c) => c.id === s.curveSel) + 1]; });
await open(); await page.click('[data-ce="join"]'); await close();
[mx, my] = await visOn(other.id); await tap(mx, my);
ok(await S(() => window.__app.state.curves.length) === nc, 'Kurven verbunden');
// Rückgängig (Verbinden zurück)
await S(() => window.__app.curveUndo()); await idle(); await sleep(300);
ok(await S(() => window.__app.state.curves.length) === nc + 1, 'Rückgängig stellt Teilung wieder her');
// Löschen + Rückgängig
await open(); await page.click('#cv-del'); await idle(); await sleep(300);
ok(await S(() => window.__app.state.curves.length) === nc, 'Kurve gelöscht'); await S(() => window.__app.curveUndo()); await idle(); await sleep(300);
ok(await S(() => window.__app.state.curves.length) === nc + 1, 'Löschen rückgängig'); await close();
// Layout + Vorschläge
await S(() => { window.__app.state.curveSel = null; document.querySelector('#btn-curve-layout').click(); }); await sleep(800); await idle();
const L0 = await S(() => ({ p: window.__app.state.layout.regions.length, v: window.__app.state.layout.foursided, s: window.__app.state.layout.suggestions.length }));
await page.screenshot({ path: `${process.env.SHOT_DIR || 'docs'}/kurvennetz-${KEY}-seiten${PH ? '-iphone' : ''}.png` });
await S(() => document.querySelector('#btn-curve-accept').click()); await sleep(800); await idle();
const L1 = await S(() => ({ p: window.__app.state.layout.regions.length, v: window.__app.state.layout.foursided }));
ok(L1.v >= L0.v, `Vorschläge: ${L0.s} übernommen, Patches ${L0.p}→${L1.p}, 4-seitig ${L0.v}→${L1.v}`);
await page.screenshot({ path: `${process.env.SHOT_DIR || 'docs'}/kurvennetz-${KEY}-vorschlaege${PH ? '-iphone' : ''}.png` });
const vis = await S(() => { const r = window.__app.viewer.renderer.domElement.getBoundingClientRect(); return r.width * r.height / (innerWidth * innerHeight); });
ok(vis > 0.3, `3D-Ansicht sichtbar (${(vis * 100).toFixed(0)} %)`);
ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
await b.close(); srv?.kill();
