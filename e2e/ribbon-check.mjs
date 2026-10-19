// Ribbon no-scroll rule: every tab (and every section chip) fits without horizontal scrolling at 1280 and 1400 px
// (desktop) and 390 px (iPhone viewport); on the phone the ribbon stays compact (≤ 2 button rows); every button keeps its tooltip.
// Aufruf: node e2e/ribbon-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!URL) { URL = 'http://localhost:8766/'; srv = spawn('npx', ['serve', '-l', '8766', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const VIEWS = [{ name: '1280', viewport: { width: 1280, height: 800 } }, { name: '1400', viewport: { width: 1400, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }];
for (const v of VIEWS) {
  const ctx = await browser.newContext(v); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL + '?nodemo'); await sleep(2500);
  const tabs = await page.$$eval('#ribbon-tabs .tab', (b) => b.map((x) => x.dataset.tab));
  const tabBar = await page.$eval('#ribbon-tabs', (e) => [e.scrollWidth, e.clientWidth]);
  if (tabBar[0] > tabBar[1] + 1) fail(`${v.name}px: tab bar scrolls (${tabBar[0]} > ${tabBar[1]})`);
  const rows = [];
  for (const t of tabs) {
    await page.evaluate((t) => document.querySelector(`#ribbon-tabs [data-tab="${t}"]`).click(), t); await sleep(250);
    const chips = await page.evaluate((t) => [...document.querySelectorAll(`#ribbon .panel[data-tab="${t}"] .rsec-nav button`)].filter((b) => b.offsetParent).length, t);
    for (let k = 0; k < Math.max(1, chips); k++) {
      if (chips) { await page.evaluate(([t, k]) => document.querySelectorAll(`#ribbon .panel[data-tab="${t}"] .rsec-nav button`)[k].click(), [t, k]); await sleep(200); }
      const m = await page.evaluate((t) => { const r = document.querySelector('#ribbon'), p = document.querySelector(`#ribbon .panel[data-tab="${t}"]`);
        const vis = [...p.querySelectorAll('.big')].filter((b) => b.offsetParent);
        const tops = [...new Set(vis.map((b) => Math.round(b.getBoundingClientRect().top / 8)))];
        return { sw: Math.max(r.scrollWidth, p.scrollWidth), cw: r.clientWidth, h: Math.round(r.getBoundingClientRect().height), rows: tops.length, noTip: vis.filter((b) => !(b.title || b.closest('[title]')?.title)).map((b) => b.textContent.trim()) }; }, t);
      const id = `${v.name}px ${t}${chips ? ' §' + k : ''}`; rows.push(`${id}: ${m.sw}/${m.cw} h${m.h} rows${m.rows}`);
      if (m.sw > m.cw + 1) fail(`${id}: scrolls horizontally (${m.sw} > ${m.cw})`);
      if (v.name === '390' && m.rows > 2) fail(`${id}: ${m.rows} button rows (max 2)`);
      if (m.noTip.length) fail(`${id}: buttons without tooltip: ${m.noTip.join(', ')}`);
    }
  }
  console.log(rows.join('\n'));
  if (errors.length) fail(`${v.name}px: page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); srv?.kill();
if (!process.exitCode) console.log('OK: no ribbon scrolls at 1280 / 1400 / 390 px');
