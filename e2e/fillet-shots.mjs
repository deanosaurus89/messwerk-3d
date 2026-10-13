// Vorher/Nachher-Bilder der Reduktion an Verrundungsübergängen (Drahtgitter). Aufruf: node e2e/fillet-shots.mjs [URL|-] [tol]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
let URL = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null; const TOL = process.argv[3] || '0.05';
if (!URL) { URL = 'http://localhost:8767/'; srv = spawn('npx', ['serve', '-l', '8767', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const S = (f, a) => page.evaluate(f, a);
const shots = [
  { key: 'pruefplatte', c: [3, 3, 12], r: 9, dir: [-1, -1.2, 1.1] },
  { key: 'flansch', c: [25, 0, 18], r: 9, dir: [1, -1.4, 0.6] },
];
for (const s of shots) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#btn-sample'); await page.click(`.sample-card[data-key="${s.key}"]`);
  await page.waitForFunction(() => window.__app.state.data, null, { timeout: 120000 });
  const place = () => S((s) => { const { viewer } = window.__app; viewer.viewDir(s.dir); viewer.focus(s.c, s.r); viewer.setWireframe(true); }, s);
  await place(); await sleep(600);
  const canvas = await page.$('#scene canvas');
  const t0 = await S(() => window.__app.state.data.triCount);
  await canvas.screenshot({ path: `docs/reduktion-${s.key}-vorher.png` });
  await S(() => document.querySelector('.tab[data-tab="poly"]').click()); await S(() => document.querySelector('[data-pe="reduce"]').click());
  await S((t) => { const n = document.querySelector('#pe-tol-n'); n.value = t; n.dispatchEvent(new Event('input')); document.querySelector('#pe-run').click(); }, TOL);
  await page.waitForFunction((t0) => window.__app.state.data.triCount < t0 && !window.__app.pe.running, t0, { timeout: 300000 });
  await place(); await sleep(600);
  await canvas.screenshot({ path: `docs/reduktion-${s.key}-nachher.png` });
  console.log(s.key, t0, '->', await S(() => window.__app.state.data.triCount));
}
await b.close(); srv?.kill();
