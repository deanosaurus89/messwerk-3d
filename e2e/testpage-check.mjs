// test.html (phase structure): Phase-1 items available by version, archive/tolerances collapsed, result = phase items +
// changed archive items, severity per item (required for ❌). 0.33: one feature per item, grouped by release (h3.rel). Aufruf: node e2e/testpage-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8770/'; srv = spawn('npx', ['serve', '-l', '8770', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = await chromium.launch({ channel: 'chrome' });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/version.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '2026.0.34', rev: 'test' }) }));
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
    return { n: p1.length, rels, f4, av, closed, out1, out: document.querySelector('#out').value, steps: !!f3.querySelector('.steps') && !!f3.querySelector('.exp') }; });
  console.log(v.name, JSON.stringify(r));
  if (r.n !== 57 || !r.steps) fail(`${v.name}: Phase-1 items ${r.n}`);
  if (r.rels.join() !== '0.28,0.29,0.30,0.31,0.32,0.33,0.34') fail(`${v.name}: release groups ${r.rels}`);
  if (!/0\.32: ❌ Major/.test(r.f4)) fail(`${v.name}: F4 retest note ${r.f4}`);
  if (r.av.length !== 57 || !['F4', 'F5', 'F11', 'F18', 'F10c', 'R2', 'R2k'].every((i) => r.av.includes(i))) fail(`${v.name}: available at 0.34: ${r.av}`);
  if (!r.closed) fail(`${v.name}: archive/tolerance sections not collapsed`);
  if (r.out1) fail(`${v.name}: bug without severity was accepted`);
  const L = r.out.split('\n');
  if (!/2026\.0\.34/.test(L[0])) fail(`${v.name}: version line ${L[0]}`);
  if (!L.some((l) => l.startsWith('F3 ❌ [Major] – kein Kreis 🐞 Tippen'))) fail(`${v.name}: F3 bug line missing`);
  // 0.34: all Phase-1 items available
  if (!L.includes('BB ✅') || L.some((l) => /^(AS|C|AX) /.test(l))) fail(`${v.name}: archive: only changed items expected`);
  if (errors.length) fail(`${v.name}: ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'testpage-check: FEHLER' : 'testpage-check: OK');
