// test.html (phase structure): Phase-1 items available by version, archive/tolerances collapsed, result = phase items +
// changed archive items, bug field with severity. Aufruf: node e2e/testpage-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8770/'; srv = spawn('npx', ['serve', '-l', '8770', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = await chromium.launch({ channel: 'chrome' });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext(v), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/version.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '2026.0.29', rev: 'test' }) }));
  await page.goto(BASE + 'test.html'); await sleep(800);
  const r = await page.evaluate(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); localStorage.clear();
    const p1 = [...document.querySelectorAll('.it[data-grp="p1"]')], av = p1.filter((e) => !e.classList.contains('unavail')).map((e) => e.dataset.id);
    const closed = !document.querySelector('#arch').open && !document.querySelector('#tolsec').open;
    const f3 = document.querySelector('.it[data-id="F3"]'); f3.querySelector('input[value="fail"]').click(); f3.querySelector('textarea.cm').value = 'kein Kreis'; f3.querySelector('textarea.cm').dispatchEvent(new Event('input'));
    f3.querySelector('details.bug').open = true; f3.querySelector('textarea.bt').value = 'Tippen an Kante gibt Ebene'; f3.querySelector('textarea.bt').dispatchEvent(new Event('input'));
    window.alert = () => {}; document.querySelector('#go').click(); await w(100); const out1 = document.querySelector('#out').value;
    const sv = f3.querySelector('select.sev'); sv.value = 'Major'; sv.dispatchEvent(new Event('change'));
    document.querySelector('.it[data-id="BB"] input[value="ok"]').click(); document.querySelector('#go').click(); await w(100);
    return { n: p1.length, av, closed, out1, out: document.querySelector('#out').value, steps: !!f3.querySelector('.steps') && !!f3.querySelector('.exp') }; });
  console.log(v.name, JSON.stringify(r));
  if (r.n !== 9 || !r.steps) fail(`${v.name}: Phase-1 items ${r.n}`);
  if (r.av.join() !== 'R1,F1,F2,F3,F4') fail(`${v.name}: available at 0.29: ${r.av}`);
  if (!r.closed) fail(`${v.name}: archive/tolerance sections not collapsed`);
  if (r.out1) fail(`${v.name}: bug without severity was accepted`);
  const L = r.out.split('\n');
  if (!/2026\.0\.29/.test(L[0])) fail(`${v.name}: version line ${L[0]}`);
  if (!L.some((l) => l.startsWith('F3 ❌ – kein Kreis 🐞 [Major]'))) fail(`${v.name}: F3 bug line missing`);
  if (L.some((l) => /^F[5-8] /.test(l))) fail(`${v.name}: unavailable items in the result`);
  if (!L.includes('BB ✅') || L.some((l) => /^(AS|C|AX) /.test(l))) fail(`${v.name}: archive: only changed items expected`);
  if (errors.length) fail(`${v.name}: ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'testpage-check: FEHLER' : 'testpage-check: OK');
