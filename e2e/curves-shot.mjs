// Kurvennetz-Bild auf einem Scan-Demoteil: Erkennung + Patch-Layout. Aufruf: node e2e/curves-shot.mjs [URL|-] [key] [iphone]
import { chromium, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null; const KEY = process.argv[3] || 'pruefplatte', PH = process.argv[4] === 'iphone';
if (!URL) { URL = 'http://localhost:8768/'; srv = spawn('npx', ['serve', '-l', '8768', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const b = PH ? await webkit.launch() : await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await b.newContext(PH ? { ...devices['iPhone 14 Pro'] } : { viewport: { width: 1500, height: 900 } })).newPage();
const S = (f, a) => page.evaluate(f, a);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#btn-sample'); await page.click(`.sample-card[data-key="${KEY}"]`);
await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 });
await S(() => { document.querySelector('.tab[data-tab="poly"]').click(); document.querySelector('#btn-curve-detect').click(); });
await page.waitForFunction(() => window.__app.state.layout, null, { timeout: 120000 });
const info = await S(() => { const s = window.__app.state; return { n: s.curves.length, kanten: s.curves.filter((c) => c.kind === 'Kante').length, tangenten: s.curves.filter((c) => c.kind === 'Tangente').length, patches: s.layout.regions.length, vier: s.layout.foursided, t: s.layout.tJunctions, knoten: s.layout.nodes.length }; });
console.log(KEY, JSON.stringify(info));
await page.screenshot({ path: `docs/kurvennetz-${KEY}${PH ? '-iphone' : ''}.png` });
await S(() => document.querySelector('#btn-curve-layout').click()); await sleep(500);
await page.screenshot({ path: `docs/kurvennetz-${KEY}${PH ? '-iphone' : ''}-patches.png` });
await b.close(); srv?.kill();
