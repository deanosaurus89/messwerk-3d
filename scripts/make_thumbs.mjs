// Vorschaubilder der Beispielteile (public/samples/thumb-*.jpg) und Netz-Nahaufnahmen (docs/scan-*.png) erzeugen.
// Aufruf: npm run build && node scripts/make_thumbs.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
const srv = spawn('npx', ['serve', '-l', '8771', 'dist'], { stdio: 'ignore' }); await sleep(2500);
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
await p.goto('http://localhost:8771/');
const list = JSON.parse(fs.readFileSync('public/samples/index.json', 'utf8'));
const close = { pruefplatte: [[70, 45, 16], [1, -1.4, 1.2], 9, [100, 45, 16]], flansch: [[0, -25, 40], [0.3, -1, 0.35], 9, [0, -22.5, 38]], freiform: [[40, 40, 26], [0.6, -1, 0.9], 10, [35, 40, 29]] };
for (const s of list) {
  await p.click('#btn-sample'); await p.click(`.sample-card[data-key="${s.key}"]`);
  await p.waitForFunction((k) => window.__app.state.data?.name.startsWith(k), s.key, { timeout: 120000 });
  await p.evaluate(() => { const { viewer } = window.__app; viewer.viewDir([1, -1.3, 1.1]); viewer.view('fit'); viewer.viewDir([1, -1.3, 1.1]); });
  await sleep(600);
  const el = await p.$('#scene canvas'); const bb = await el.boundingBox();
  const w = bb.height * 1.6, x = bb.x + (bb.width - w) / 2;
  await p.evaluate(() => document.body.classList.add('thumb'));
  await p.screenshot({ path: `public/samples/thumb-${s.key}.jpg`, type: 'jpeg', quality: 80, clip: { x, y: bb.y, width: w, height: bb.height }, scale: 'css' });
  await p.evaluate(() => document.body.classList.remove('thumb'));
  const c = close[s.key];
}
await b.close(); srv.kill(); console.log('ok');
