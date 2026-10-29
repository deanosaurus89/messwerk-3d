// 2026.0.54: Islands drawer stays open when a chip is selected or dismissed.
// Point create offers Place, not Smart Detect. Desktop and a phone-width sheet.
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const port = 4188;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
const srvLog = [];
srv.stdout?.on('data', (d) => srvLog.push(String(d)));
srv.stderr?.on('data', (d) => srvLog.push(String(d)));
for (let i = 0; i < 50 && !srvLog.join('').includes('ready'); i++) await sleep(200);
if (!srvLog.join('').includes('ready')) { console.log(srvLog.join('').slice(-2000)); throw new Error('vite did not start'); }

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

async function islands(page, label) {
  await page.goto(`http://localhost:${port}/?nodemo`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__app?.renderAll, null, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#whatsnew')?.remove());
  const prep = await page.evaluate(() => {
    const A = window.__app, S = A.state;
    S.data = { name: 'plate' };
    S.mode = { kind: 'fit', type: 'Ebene', method: 'Klick' };
    S.opts.side = 'ist';
    S.preview = {
      fit: { type: 'Ebene', center: [0, 0, 0], normal: [0, 0, 1], rms: 0.01, form: 0.02, maxPos: 0.01, maxNeg: -0.01, n: 4 },
      indices: new Uint32Array([0, 1, 2, 3]), candidates: [], method: 'Klick', role: 'ist',
      islands: [
        { id: 1, kind: 'hole', c: [4, 4, 0], r: 2, area: 12, h: 0, n: 20, inc: false, m: 0, loops: [[[2, 2, 0], [6, 2, 0], [6, 6, 0], [2, 6, 0]]] },
        { id: 2, kind: 'bump', c: [12, 4, 0], r: 1.5, area: 7, h: 0.4, n: 8, inc: false, m: 0, loops: [[[11, 3, 0], [13, 3, 0], [13, 5, 0]]] },
      ],
    };
    document.body.classList.add('show-dialog', 'fb-dialog');
    A.togglePanel('dialog', true);
    A.renderAll();
    const d = document.querySelector('#dialog details.cp-isl-drawer');
    return { has: !!d, text: d?.querySelector('summary')?.textContent ?? '' };
  });
  ok(prep.has && /Islands/.test(prep.text), `${label}: Islands drawer is in the dialog (${prep.text})`);
  await page.evaluate(() => {
    const d = document.querySelector('#dialog details.cp-isl-drawer');
    if (d) d.open = true;
    document.querySelector('#dialog [data-isl="0"]')?.scrollIntoView({ block: 'center', inline: 'center' });
  });
  const box = await page.evaluate(() => {
    const el = document.querySelector('#dialog [data-isl="0"]');
    const pane = document.querySelector('#dialog-pane');
    const r = el.getBoundingClientRect(), p = pane.getBoundingClientRect();
    return { chip: { x: r.x, y: r.y, w: r.width, h: r.height }, pane: { x: p.x, y: p.y, w: p.width, h: p.height }, body: document.body.className };
  });
  console.log(label, 'layout', JSON.stringify(box));
  await page.evaluate(() => document.querySelector('#dialog [data-isl="0"]').click());
  await sleep(100);
  const sel = await page.evaluate(() => {
    const d = document.querySelector('#dialog details.cp-isl-drawer');
    const chip = document.querySelector('#dialog [data-isl="0"]');
    return { open: !!d?.open, on: chip?.classList.contains('on'), n: document.querySelectorAll('#dialog [data-isl]').length };
  });
  ok(sel.open && sel.on && sel.n === 2, `${label}: selecting a chip keeps the list open (${JSON.stringify(sel)})`);
  await page.evaluate(() => document.querySelector('#dialog [data-islx="0"]').click());
  await sleep(80);
  const dis = await page.evaluate(() => {
    const d = document.querySelector('#dialog details.cp-isl-drawer');
    const chip = document.querySelector('#dialog [data-isl="0"]');
    return { open: !!d?.open, drop: chip?.classList.contains('drop') };
  });
  ok(dis.open && dis.drop, `${label}: ✕ dismisses the island and the list stays open (${JSON.stringify(dis)})`);
  await sleep(400);
  const later = await page.evaluate(() => !!document.querySelector('#dialog details.cp-isl-drawer')?.open);
  ok(later, `${label}: drawer still open after the preview refresh`);
  const point = await page.evaluate(() => {
    const A = window.__app;
    A.state.mode.type = 'Punkt';
    A.state.preview = null;
    A.renderAll();
    const b = document.querySelector('#dialog button.cp-smart');
    return b?.textContent ?? '';
  });
  ok(/Place/.test(point) && !/Smart Detect/.test(point), `${label}: point create says Place (${point.trim()})`);
}

const desktop = { viewport: { width: 1400, height: 900 } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  let browser;
  try { browser = await engine.launch(); }
  catch (e) { console.log('SKIP ' + name + ': ' + e.message.split('\n')[0]); continue; }
  try {
    for (const [label, opt] of [[name + ' desktop', desktop], [name + ' phone', phone]]) {
      const page = await (await browser.newContext(opt)).newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await islands(page, label);
      ok(!errs.length, `${label}: no page errors${errs.length ? ' ' + errs.join(' | ') : ''}`);
      await page.context().close();
    }
  } finally { await browser.close(); }
}
srv.kill('SIGKILL');
if (fail) { console.log('release054-check: ' + fail + ' failed'); process.exit(1); }
console.log('release054-check: OK');
process.exit(0);
