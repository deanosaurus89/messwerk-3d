// 2026.0.44: dismissing a plane bore seals the frozen domain (points stay out).
// Aufruf: node e2e/geom044-check.mjs [URL|-]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let BASE = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8774/'; srv = spawn('npx', ['serve', '-l', '8774', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/inseldemo.stl.gz', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?nodemo'); await sleep(2000);
await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(4000);
const r = await page.evaluate(async () => {
  const A = window.__app, S = A.state, w = (ms) => new Promise((res) => setTimeout(res, ms));
  A.startFitMode('Ebene'); await w(100); S.opts.pick = 1.5;
  await A.previewByClick(A.hitAt([70, 50, 10], [0, 0, 1])); await w(500); await A.applyExtract(); A.renderAll(); await w(400);
  const list = S.preview.islands ?? [];
  const k = list.findIndex((I) => Math.hypot(I.c[0] - 40, I.c[1] - 30) < 1.5);
  const details = document.querySelector('details.cp-isl'); if (details) details.open = true;
  document.querySelector(`[data-islx="${k}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await w(1200);
  const isle = S.preview.islands.find((I) => Math.hypot(I.c[0] - 40, I.c[1] - 30) < 1.5);
  const boundaryOff = [...document.querySelectorAll('[data-zsrc], [data-exn="inset"], #cp-smooth')].every((el) => el.disabled);
  await A.commitPreview(); await w(400);
  const f = S.features.at(-1);
  const F = f.frozen;
  const inside = (p) => {
    const x = (p[0] - F.o[0]) * F.u[0] + (p[1] - F.o[1]) * F.u[1] + (p[2] - F.o[2]) * F.u[2];
    const y = (p[0] - F.o[0]) * F.v[0] + (p[1] - F.o[1]) * F.v[1] + (p[2] - F.o[2]) * F.v[2];
    let wdg = false;
    for (const l of F.loops) for (let i = 0; i < l.length; i += 2) {
      const j = (i + 2) % l.length, ay = l[i + 1], by = l[j + 1];
      if ((ay > y) !== (by > y) && x < l[i] + ((y - ay) / (by - ay)) * (l[j] - l[i])) wdg = !wdg;
    }
    return wdg;
  };
  const tri = A.trimFor(f);
  return { k, drop: !!isle?.drop, n: f.indices.length, loops: F?.loops.length ?? 0, sealed: F?.sealed?.length ?? 0, inHole: F ? inside(isle.c) : false, tris: tri ? tri.tri.length : 0, boundaryOff };
});
console.log('seal', JSON.stringify(r));
if (r.k < 0 || !r.drop) fail('bore was not dismissed');
if (!(r.sealed > 0) || !r.inHole) fail('frozen domain still has the bore');
if (!(r.tris > 100)) fail('plane surface missing');
if (!r.boundaryOff) fail('boundary controls were re-enabled on the scan');
if (errors.length) fail('page errors ' + errors.join(' | '));
await ctx.close(); await browser.close(); srv?.kill();
console.log(process.exitCode ? 'geom044-check: FEHLER' : 'geom044-check: OK');
