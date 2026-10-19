// Help/info overlays on the iPhone viewport (390 px): every overlay has a close ✕ that is visible and tappable
// (inside the screen, not under the ribbon, still visible after scrolling the content), it does not cover the whole
// 3D view, and ✕ / Esc / tap outside / swipe down close it.
// Aufruf: node e2e/overlay-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!URL) { URL = 'http://localhost:8767/'; srv = spawn('npx', ['serve', '-l', '8767', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL + '?nodemo'); await sleep(2500);
// load the sample part (also exercises the sample dialog)
await page.evaluate(() => document.querySelector('#btn-sample').click()); await sleep(800);
const OV = {
  help: { box: '#help-view', x: '#hv-close', scroll: '#help-view .rv-body', scene: true },
  sample: { box: '#sample-dialog', x: '#sd-close', scroll: '#sample-dialog .sd-grid' },
  whatsnew: { box: '#whatsnew .wn-box', x: '#whatsnew .ov-x', scroll: '#whatsnew .wn-box', gone: '#whatsnew' },
  props: { box: '#props-dlg .wn-box', x: '#props-dlg .ov-x', scroll: '#props-dlg .wn-box', gone: '#props-dlg' },
};
const isOpen = (o) => page.evaluate((o) => { const e = document.querySelector(o.gone ?? o.box); return !!e && !e.classList.contains('hidden') && e.getClientRects().length > 0; }, o);
async function check(name, o) {
  await sleep(500);
  if (!(await isOpen(o))) { fail(`${name}: overlay did not open`); return; }
  for (const where of ['top', 'bottom']) {
    if (where === 'bottom') { await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollTop = e.scrollHeight; }, o.scroll); await sleep(300); }
    const m = await page.evaluate((o) => {
      const x = document.querySelector(o.x), b = document.querySelector(o.box), sc = document.querySelector('#scene').getBoundingClientRect(), rb = document.querySelector('#ribbon').getBoundingClientRect();
      if (!x) return { err: 'no close button' };
      const r = x.getBoundingClientRect(), br = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      // uncovered part of the 3D view
      const ov = Math.max(0, Math.min(sc.right, br.right) - Math.max(sc.left, br.left)) * Math.max(0, Math.min(sc.bottom, br.bottom) - Math.max(sc.top, br.top));
      return { r: [r.left, r.top, r.right, r.bottom].map(Math.round), w: r.width, h: r.height, hitOk: !!hit && (hit === x || x.contains(hit)), hit: hit?.id || hit?.className,
        ribbonBottom: Math.round(rb.bottom), free: 1 - ov / (sc.width * sc.height), title: x.title, layoutScroll: ['#app', '#workspace', '#scene'].map((s) => document.querySelector(s)?.scrollTop ?? 0).reduce((a, c) => a + c, 0) };
    }, o);
    const id = `${name} (${where})`;
    if (m.err) { fail(`${id}: ${m.err}`); continue; }
    if (m.r[0] < 0 || m.r[1] < 0 || m.r[2] > 390 || m.r[3] > 844) fail(`${id}: ✕ outside the screen ${m.r}`);
    if (!m.hitOk) fail(`${id}: ✕ covered by ${m.hit}`);
    if (m.w < 36 || m.h < 36) fail(`${id}: ✕ too small ${m.w}×${m.h}`);
    if (o.scene && m.r[1] < m.ribbonBottom) fail(`${id}: ✕ under the ribbon (${m.r[1]} < ${m.ribbonBottom})`);
    if (m.layoutScroll) fail(`${id}: layout container scrolled (${m.layoutScroll}px)`);
    if (m.free < 0.15) fail(`${id}: covers ${(100 - m.free * 100).toFixed(0)} % of the 3D view`);
    if (!m.title) fail(`${id}: ✕ without tooltip`);
    console.log(`${id}: ✕ ${m.r.join(',')} free3D ${(m.free * 100).toFixed(0)}%`);
  }
}
async function closeBy(name, o, how) {
  if (how === 'x') await page.tap(o.x);
  if (how === 'esc') await page.keyboard.press('Escape');
  if (how === 'outside') await page.touchscreen.tap(195, await page.evaluate(() => document.querySelector('#scene').getBoundingClientRect().top + 30));
  if (how === 'swipe') await page.evaluate((o) => {
    const b = document.querySelector(o.box), h = b.querySelector('.rv-head, .ov-top') ?? b, r = h.getBoundingClientRect(), x = r.left + r.width / 3, y = r.top + 12;
    const t = (yy) => new Touch({ identifier: 1, target: h, clientX: x, clientY: yy });
    h.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(y)], changedTouches: [t(y)] }));
    h.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(y + 160)] }));
  }, o);
  await sleep(400);
  if (await isOpen(o)) fail(`${name}: not closed by ${how}`); else console.log(`${name}: closed by ${how} ✓`);
}
const tab = (t) => page.evaluate((t) => document.querySelector(`#ribbon-tabs [data-tab="${t}"]`).click(), t);
// sample dialog was opened above
await check('sample dialog', OV.sample); await page.evaluate(() => document.querySelector('.sample-card').click()); await sleep(4000);
await page.evaluate(() => document.querySelector('#unit-dlg [data-ok]')?.click()); await sleep(500);
await page.evaluate(() => document.querySelector('#btn-sample').click()); await check('sample dialog 2', OV.sample); await closeBy('sample dialog', OV.sample, 'swipe');
// docs (Help tab)
await tab('hilfe'); await page.evaluate(() => document.querySelector('#btn-docs').click()); await check('documentation', OV.help); await closeBy('documentation', OV.help, 'x');
await page.evaluate(() => document.querySelector('#btn-docs').click()); await sleep(300); await closeBy('documentation', OV.help, 'esc');
await page.evaluate(() => document.querySelector('#btn-docs').click()); await sleep(300); await closeBy('documentation', OV.help, 'outside');
await page.evaluate(() => document.querySelector('#btn-docs').click()); await sleep(300); await closeBy('documentation', OV.help, 'swipe');
await page.evaluate(() => document.querySelector('#btn-help').click()); await check('help', OV.help); await closeBy('help', OV.help, 'x');
// Martin's case: feature creation (Start ▸ Plane) with the Dialog sheet open, then a "?" help that jumps into the docs
await tab('merkmale'); await page.evaluate(() => [...document.querySelectorAll('#ribbon .panel[data-tab="merkmale"] button')].find((b) => /Plane/.test(b.textContent)).click()); await sleep(400);
await page.evaluate(() => document.querySelector('#mobilebar [data-panel="dialog"], [data-panel="dialog"]')?.click()); await sleep(400);
for (const sec of ['drf', 'fitcrit', 'gentol', 'fill']) {
  await page.evaluate((sec) => { const b = document.createElement('button'); b.dataset.docSec = sec; document.body.appendChild(b); b.click(); b.remove(); }, sec);
  await check(`doc "?" ${sec} during creation`, OV.help); await closeBy(`doc ${sec}`, OV.help, sec === 'drf' ? 'x' : 'swipe');
}
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
await page.evaluate(() => window.__app.showDatumInfo()); await check('datum info', OV.help); await closeBy('datum info', OV.help, 'esc');
await tab('hilfe'); await page.evaluate(() => document.querySelector('#btn-whatsnew').click()); await check("what's new", OV.whatsnew); await closeBy("what's new", OV.whatsnew, 'swipe');
await page.evaluate(() => document.querySelector('#btn-whatsnew').click()); await sleep(300); await closeBy("what's new", OV.whatsnew, 'esc');
await page.evaluate(async () => { const A = window.__app; if (!A.state.features.length) { await A.ensurePosition(); A.state.mode = null; A.state.preview = null; A.renderAll(); } });
await page.waitForFunction(() => window.__app.state.features.length > 0, null, { timeout: 60000 }).catch(() => {});
const hasF = await page.evaluate(() => { const a = window.__app, f = a.state.features.find((x) => x.measured) ?? a.state.features[0]; if (f) a.showProperties(f); return !!f; });
if (hasF) { await check('properties', OV.props); await closeBy('properties', OV.props, 'x'); } else fail('no feature for the properties dialog');
if (errors.length) fail(`page errors ${errors.join(' | ')}`);
await browser.close(); srv?.kill();
if (!process.exitCode) console.log('OK: every help/info overlay has a visible ✕ at 390 px and closes by ✕ / Esc / outside / swipe');
