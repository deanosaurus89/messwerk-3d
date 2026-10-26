// test.html (phase structure): Phase-1 items available by version, archive/tolerances collapsed, result = phase items +
// changed archive items, severity per item (required for ❌). 0.33: one feature per item, grouped by release (h3.rel). Aufruf: node e2e/testpage-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8770/'; srv = spawn('npx', ['serve', '-l', '8770', 'public'], { stdio: 'ignore' }); await sleep(2500); }
const browser = await chromium.launch({ channel: 'chrome' });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/version.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '2026.0.40', rev: 'test' }) }));
  await page.goto(BASE + 'test.html'); await sleep(800);
  const r = await page.evaluate(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); localStorage.clear();
    const p1 = [...document.querySelectorAll('.it[data-grp="p1"]')], av = p1.filter((e) => !e.classList.contains('unavail')).map((e) => e.dataset.id);
    const closed = !document.querySelector('#arch').open && !document.querySelector('#tolsec').open;
    const f3 = document.querySelector('.it[data-id="F3"]'); f3.querySelector('input[value="fail"]').click(); f3.querySelector('textarea.cm').value = 'kein Kreis'; f3.querySelector('textarea.cm').dispatchEvent(new Event('input'));
    f3.querySelector('details.bug').open = true; f3.querySelector('textarea.bt').value = 'Tippen an Kante gibt Ebene'; f3.querySelector('textarea.bt').dispatchEvent(new Event('input'));
    window.alert = () => {}; document.querySelector('#go').click(); await w(100); const out1 = document.querySelector('#out').value;
    const sv = f3.querySelector('select.sev'); sv.value = 'Major'; sv.dispatchEvent(new Event('change'));
    document.querySelector('.it[data-id="BB"] input[value="ok"]').click(); document.querySelector('#go').click(); await w(100);
    const rels = [...document.querySelectorAll('h3.rel')].map((h) => h.textContent.slice(8, 12)); const f4 = document.querySelector('.it[data-id="F4"] .obsn')?.textContent ?? '';
    const f11 = document.querySelector('.it[data-id="F11"]');
    const archHidden = f11.classList.contains('arch-hide');
    document.getElementById('show-arch').click();
    const archShown = !document.querySelector('.it[data-id="F11"]').classList.contains('arch-hide');
    document.getElementById('show-arch').click();
    document.querySelector('.it[data-id="F6"] input[value="ok"]').click();
    document.getElementById('f-status').value = 'ok'; document.getElementById('f-status').dispatchEvent(new Event('change'));
    const visOk = [...document.querySelectorAll('.it[data-grp="p1"]:not(.arch-hide)')].map((e) => e.dataset.id);
    document.querySelector('.it[data-id="F6"] .archbtn').click();
    const stored = JSON.parse(localStorage.getItem('mw3d-test-0.17b') || '{}');
    const f6hidden = document.querySelector('.it[data-id="F6"]').classList.contains('arch-hide');
    document.getElementById('f-status').value = 'all'; document.getElementById('f-status').dispatchEvent(new Event('change'));
    let opened = ''; window.open = (u) => { opened = String(u); return null; };
    document.getElementById('send').click();
    const sendUrl = opened;
    const note = document.querySelector('.it[data-id="F6"] textarea.cm'); note.value = 'x'.repeat(9000); note.dispatchEvent(new Event('input'));
    document.getElementById('send').click();
    const sendLong = opened;
    return { n: p1.length, rels, f4, av, closed, out1, out: document.querySelector('#out').value, steps: !!f3.querySelector('.steps') && !!f3.querySelector('.exp'), archHidden, archShown, visOk, f6a: stored.F6 && stored.F6.a, f6hidden, sendUrl, sendLong }; });
  console.log(v.name, JSON.stringify(r));
  if (r.n !== 97 || !r.steps) fail(`${v.name}: Phase-1 items ${r.n}`);
  if (r.rels.join() !== '0.30,0.31,0.32,0.33,0.34,0.35,0.36,0.37,0.38,0.39,0.40,0.41') fail(`${v.name}: release groups ${r.rels}`);
  if (!r.archHidden || !r.archShown) fail(`${v.name}: archive toggle F11 hidden=${r.archHidden} shown=${r.archShown}`);
  if (r.visOk.join() !== 'F6') fail(`${v.name}: status filter ${r.visOk}`);
  if (r.f6a !== 1 || !r.f6hidden) fail(`${v.name}: archive persist ${r.f6a} hidden=${r.f6hidden}`);
  if (!r.sendUrl.includes('labels=test-results') || !r.sendUrl.includes('F3') || r.sendUrl.length > 8000) fail(`${v.name}: send url ${r.sendUrl.slice(0, 180)} len ${r.sendUrl.length}`);
  if (!r.sendLong.includes('Results%20pasted%20below') || r.sendLong.length > 8000) fail(`${v.name}: long send ${r.sendLong.slice(0, 180)} len ${r.sendLong.length}`);
  if (!/0\.32: ❌ Major/.test(r.f4)) fail(`${v.name}: F4 retest note ${r.f4}`);
  if (r.av.length !== 89 || !['F4', 'F5', 'F11', 'F18', 'F10c', 'R2', 'R2k', 'F20', 'F20b', 'F21', 'F21f', 'A37', 'A37b', 'N38', 'P38', 'I38', 'I38b', 'D38', 'F11b', 'F13b', 'F15b', 'G39', 'S39', 'S39b', 'R39', 'O39', 'L39', 'S40', 'B40', 'B40b', 'B40c', 'B40d', 'B40e', 'B40f', 'N40'].every((i) => r.av.includes(i))) fail(`${v.name}: available at 0.38: ${r.av}`);
  if (!r.closed) fail(`${v.name}: archive/tolerance sections not collapsed`);
  if (r.out1) fail(`${v.name}: bug without severity was accepted`);
  const L = r.out.split('\n');
  if (!/2026\.0\.(3[6789]|40)/.test(L[0])) fail(`${v.name}: version line ${L[0]}`);
  if (!L.some((l) => l.startsWith('F3 ❌ [Major] – kein Kreis 🐞 Tippen'))) fail(`${v.name}: F3 bug line missing`);
  // 0.34: all Phase-1 items available
  if (!L.includes('BB ✅') || L.some((l) => /^(AS|C|AX) /.test(l))) fail(`${v.name}: archive: only changed items expected`);
  if (errors.length) fail(`${v.name}: ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'testpage-check: FEHLER' : 'testpage-check: OK');
