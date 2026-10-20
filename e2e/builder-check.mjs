// 0.40 Feature Builder / Smart Detect: Auto not pre-highlighted, Smart Detect main action, type/pick/brush under Advanced,
// boundary default fitted geometry, Add region + Brush add after detection, aux options for detected curves, no scroll on iPhone.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process'; import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4173/messwerk-3d/';
const stl = '/tmp/multifeature.stl';
if (!fs.existsSync(stl)) execSync(`gunzip -c public/samples/multifeature.stl.gz > ${stl}`);
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
for (const [name, vp, mob] of [['desktop', { width: 1400, height: 900 }, false], ['iphone', { width: 390, height: 844 }, true]]) {
  const p = await (await b.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 3 : 1 })).newPage();
  p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
  await p.goto(base + '?nodemo'); await p.waitForTimeout(2000);
  await p.setInputFiles('#file', stl);
  await p.waitForSelector('#unit-dlg', { timeout: 120000 }); await p.click('#unit-dlg [data-ok]'); await p.waitForTimeout(5000);
  await p.evaluate(() => document.querySelector('#whatsnew')?.remove());
  const auto0 = await p.evaluate(() => { const a = document.querySelector('.rb-auto'); return a ? { on: a.classList.contains('on'), bg: getComputedStyle(a).backgroundColor, ref: getComputedStyle(a.nextElementSibling ?? a.parentElement.querySelector('button:not(.rb-auto)') ?? a).backgroundColor } : null; });
  ok(auto0 && !auto0.on && auto0.bg === auto0.ref, `${name}: Auto icon not pre-highlighted ${JSON.stringify(auto0)}`);
  ok(await p.evaluate(() => window.__app.state.opts.ex.zoneSrc === 'geom'), `${name}: boundary default = fitted geometry`);
  await p.evaluate(() => window.__app.startFitMode('auto')); await p.waitForTimeout(500);
  const pre = await p.evaluate(() => { const s = document.querySelector('.cp-smart'); const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => e.offsetParent && !e.closest('details:not([open])'));
    return { smart: !!s, title: s?.title?.length > 20, typeOutside: [...document.querySelectorAll('.cp-adv-first')].length > 0 && !vis('.cp-selm + select'), brushInAdv: !!document.querySelector('details.cp-params [data-a="brush"]'), brushTop: !!document.querySelector('.cp-selm [data-a="brush"]'), head: document.body.innerText.includes('Feature Builder') || document.body.innerText.includes('Merkmal') }; });
  ok(pre.smart && pre.title, `${name}: Smart Detect main action with tooltip`);
  ok(pre.brushInAdv && !pre.brushTop, `${name}: brush path under Advanced`);
  ok(pre.typeOutside, `${name}: type/pick under Advanced before detection`);
  const box = await p.locator('canvas').first().boundingBox();
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5); await p.waitForTimeout(8000);
  const pv = await p.evaluate(() => { const v = window.__app.state.preview; return v ? { n: v.indices.length, t: v.fit.type } : null; });
  ok(!!pv, `${name}: Smart Detect detected ${JSON.stringify(pv)}`);
  if (pv) {
    const post = await p.evaluate(() => ({ add: !!document.querySelector('[data-a="addreg"]'), badd: document.querySelector('[data-a="brushadd"]')?.title?.length > 20, rem: !!document.querySelector('[data-a="subreg"]') || true }));
    ok(post.add && post.badd, `${name}: Add region + Brush add after detection`);
    const noScroll = await p.evaluate(() => { const s = document.querySelector('.cp-smart'); let e = s; while (e && e !== document.body) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2 && !e.closest('details')) return { el: e.className, sh: e.scrollHeight, ch: e.clientHeight }; e = e.parentElement; }
      const r = s.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0 ? true : { top: r.top, bottom: r.bottom }; });
    ok(noScroll === true, `${name}: panel without scrolling ${JSON.stringify(noScroll)}`);
    await p.evaluate(() => document.querySelector('[data-a="brushadd"]').click()); await p.waitForTimeout(800);
    const ba = await p.evaluate(() => ({ m: window.__app.state.mode.method, t: window.__app.state.mode.type, c: window.__app.state.brushCount }));
    ok(ba.m === 'Pinsel' && ba.t === pv.t && ba.c === pv.n, `${name}: Brush add keeps selection + type ${JSON.stringify(ba)}`);
  }
  // Hilfsebenen-Optionen für eine von Smart Detect erkannte Bohrung (Kreis) – auch ohne vorher gewählten Typ
  await p.evaluate(() => { const A = window.__app; A.state.preview = null; A.startFitMode('auto'); }); await p.waitForTimeout(400);
  const hole = [-99.2, 205.5, 8]; let auxOk = null; // Rundung bei (−99, 205) – Auto erkennt Kreis in Hilfsebene
  // Wandpunkte der Bohrung (Normale waagerecht, nahe der Achse) aus der Geometrie; Blick schräg auf die Wand
  const cands = await p.evaluate((C) => { const g = window.__app.viewer.model.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, out = [];
    for (let i = 0; i < P.length / 3 && out.length < 400; i += 1) { const dx = P[3*i] - C[0], dy = P[3*i+1] - C[1], r = Math.hypot(dx, dy);
      if (r > 1.5 && r < 9 && Math.abs(N[3*i+2]) < 0.1 && Math.abs(N[3*i] * dx + N[3*i+1] * dy) > 0.9 * r) out.push([P[3*i], P[3*i+1], P[3*i+2], N[3*i], N[3*i+1]]); }
    return out.filter((_, k) => k % 40 === 0); }, hole);
  console.log('  hole wall candidates', cands.length);
  for (const c of cands) {
    const xy = await p.evaluate((c) => { const { viewer } = window.__app; viewer.viewDir([c[3], c[4], 1.2]); viewer.focus([c[0], c[1], c[2]], 30);
      const v = viewer.camera.position.clone().set(c[0], c[1], c[2]).project(viewer.camera); const r = viewer.renderer.domElement.getBoundingClientRect();
      const x = Math.floor(r.left + (v.x + 1) / 2 * r.width), y = Math.floor(r.top + (1 - v.y) / 2 * r.height); const h = viewer.pick(x, y);
      return h && document.elementFromPoint(x, y) === viewer.renderer.domElement && Math.hypot(h.point[0] - c[0], h.point[1] - c[1], h.point[2] - c[2]) < 0.6 ? [x, y] : null; }, c);
    if (!xy) continue;
    mob ? await p.touchscreen.tap(xy[0], xy[1]) : await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(6000);
    auxOk = await p.evaluate(() => { const v = window.__app.state.preview; return v ? { t: v.fit.type, aux: !!document.querySelector('.cp-aux') } : null; });
    if (auxOk && ['Kreis', 'Langloch'].includes(auxOk.t)) break;
    await p.evaluate(() => { window.__app.state.preview = null; });
  }
  ok(auxOk && ['Kreis', 'Langloch'].includes(auxOk.t) && auxOk.aux, `${name}: aux-plane options for a detected circle ${JSON.stringify(auxOk)}`);
  await p.screenshot({ path: `/tmp/builder-${name}.png` });
}
await b.close(); console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
