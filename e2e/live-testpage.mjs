// Live check of the test page with the REAL version.json (no mock): which Phase-1 items are unlocked. node e2e/live-testpage.mjs URL
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
const BASE = process.argv[2] ?? 'https://deanosaurus89.github.io/messwerk-3d/';
const b = await chromium.launch({ channel: 'chrome' });
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
  const ctx = await b.newContext(v), p = await ctx.newPage(); await p.goto(BASE + 'test.html?x=' + Date.now()); await sleep(2500);
  const r = await p.evaluate(() => ({ av: [...document.querySelectorAll('.it[data-grp="p1"]')].filter((e) => !e.classList.contains('unavail')).map((e) => e.dataset.id), ver: document.body.innerText.match(/2026\.0\.\d+/)?.[0] }));
  console.log(v.name, JSON.stringify(r)); await ctx.close();
}
await b.close();
