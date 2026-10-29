// CAD nominal on a phone and with a mouse: face, edge/curve (Auto and explicit), polyline.
// Aufruf: node e2e/mobile-nominal.mjs <URL>
import { webkit, chromium, devices } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
async function boot(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'nodemo', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__app?.cad, null, { timeout: 60000 });
  await page.evaluate(() => document.querySelector('#btn-sample').click());
  const card = page.locator('.sample-card[data-key="cadsample"]');
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await card.tap().catch(() => card.click());
  await page.waitForFunction(() => (window.__app?.cad?.faces?.length ?? 0) > 10, null, { timeout: 180000 });
  await page.evaluate(() => {
    document.querySelectorAll('#labels .lbl, #leaders').forEach((e) => { e.style.pointerEvents = 'none'; });
  });
  return errs;
}

async function spot(page, want) {
  return page.evaluate((want) => {
    const { cad, viewer, cadPickHit, nominalAtPointer, nominalOnCad } = window.__app;
    viewer.view('iso');
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const V = viewer.camera.position.constructor;
    const faces = cad.faces.map((f) => {
      const tess = f.res?.tess ?? f.tess;
      return { id: f.id, geom: f.geom ?? null, positions: tess?.positions, normals: tess?.normals };
    });
    const tol = 8;
    const project = (mid) => {
      const p = new V(mid[0], mid[1], mid[2]).project(viewer.camera);
      if (p.z < -1 || p.z > 1) return null;
      const x = rect.left + (p.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
      if (x < rect.left + 10 || x > rect.right - 10 || y < rect.top + 20 || y > rect.bottom - 90) return null;
      if (document.elementFromPoint(x, y) !== viewer.renderer.domElement) return null;
      return { x, y };
    };
    if (want === 'surface') {
      for (let y = rect.top + 30; y < rect.bottom - 90; y += 14) {
        for (let x = rect.left + 16; x < rect.right - 16; x += 14) {
          if (document.elementFromPoint(x, y) !== viewer.renderer.domElement) continue;
          const h = cadPickHit(x, y);
          if (!h) continue;
          const n = nominalOnCad(faces, h.id, h.p, 'auto', 12);
          if (n && !n.pick.freeform && (n.pick.fit.type === 'Ebene' || n.pick.fit.type === 'Zylinder' || n.pick.fit.type === 'Kegel' || n.pick.fit.type === 'Kugel' || n.pick.fit.type === 'Torus'))
            return { x, y, type: n.pick.fit.type };
        }
      }
      return null;
    }
    for (const f of cad.faces) {
      for (const e of f.geom?.edges ?? []) {
        if (e.kind !== 'line' && e.kind !== 'circle') continue;
        if (want === 'Linienzug' && e.kind !== 'line') continue;
        const xy = project(e.mid);
        if (!xy) continue;
        const h = cadPickHit(xy.x, xy.y, true);
        if (!h) continue;
        const n = nominalAtPointer(faces, h.id, h.p, want === 'edge' ? 'auto' : want, tol);
        if (!n) continue;
        const type = n.pick.fit.type;
        if (want === 'edge' && (type === 'Kreis' || type === 'Linie' || type === 'Langloch')) return { ...xy, type };
        if (want !== 'edge' && type === want) return { ...xy, type };
      }
    }
    return null;
  }, want);
}

async function pick(page, x, y, touch) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

const SURFACE = ['Ebene', 'Zylinder', 'Kegel', 'Kugel', 'Torus', 'Freiformfläche'];
function accepts(want, type) {
  if (want === 'surface') return SURFACE.includes(type);
  if (want === 'edge') return type === 'Kreis' || type === 'Linie' || type === 'Langloch';
  return type === want;
}
async function confirmCurve(page, touch, label, want) {
  const errs = [];
  const modeType = want === 'surface' || want === 'edge' ? 'auto' : want;
  await page.evaluate((w) => window.__app.startFitMode(w, 'soll'), modeType);
  const hit = await spot(page, want);
  if (!hit) { errs.push(label + ': no spot'); return errs; }
  console.log(label, JSON.stringify(hit));
  await pick(page, hit.x, hit.y, touch);
  try {
    await page.waitForFunction(() => window.__app.state.preview?.role === 'soll', null, { timeout: 10000 });
  } catch (e) {
    errs.push(label + ' no preview: ' + (await page.textContent('#status')) + ' / ' + e.message);
    return errs;
  }
  const shown = await page.evaluate(() => window.__app.state.preview?.fit?.type);
  if (!accepts(want, shown)) { errs.push(label + ' preview ' + shown); return errs; }
  const ok = await page.locator('#cp-ok').isVisible().catch(() => false);
  if (!ok) errs.push(label + ' confirm button missing');
  else {
    const title = await page.locator('#cp-ok').getAttribute('title');
    if (title !== 'Create nominal') errs.push(label + ' confirm title ' + title);
    if (touch) await page.tap('#cp-ok'); else await page.click('#cp-ok');
    try {
      await page.waitForFunction((w) => window.__app.state.features.some((f) => f.soll && f.type === w), shown, { timeout: 8000 });
    } catch (e) { errs.push(label + ' not in the tree: ' + e.message); }
  }
  const side = await page.evaluate(() => window.__app.state.opts.side);
  if (side !== 'soll') errs.push(label + ' side did not stay nominal');
  return errs;
}

async function polylineMenu(page, touch) {
  const errs = [];
  const tab = page.locator('.tab[data-tab="merkmale"]');
  if (touch) await tab.tap(); else await tab.click();
  const more = page.locator('#btn-feat-more');
  await more.scrollIntoViewIfNeeded();
  if (touch) await more.tap(); else await more.click();
  const pl = page.locator('#btn-polyline');
  if (touch) await pl.tap(); else await pl.click();
  const later = await page.locator('.ctx-menu button', { hasText: 'later' }).count();
  if (later) errs.push('polyline menu still says later');
  const cad = page.locator('.ctx-menu button', { hasText: 'From CAD' });
  if (await cad.isDisabled()) errs.push('polyline From CAD is disabled');
  const mesh = page.locator('.ctx-menu button', { hasText: 'From polygon model' });
  if (!(await mesh.isDisabled())) errs.push('polyline mesh nominal should stay unavailable');
  if (touch) await cad.tap(); else await cad.click();
  const mode = await page.evaluate(() => ({ type: window.__app.state.mode?.type, side: window.__app.state.opts.side }));
  if (mode.type !== 'Linienzug' || mode.side !== 'soll') errs.push('polyline From CAD did not start: ' + JSON.stringify(mode));
  return errs;
}

async function spotType(page, type) {
  return page.evaluate((type) => {
    const { cad, viewer, cadPickHit, nominalOnCad } = window.__app;
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const faces = cad.faces.map((f) => {
      const tess = f.res?.tess ?? f.tess;
      return { id: f.id, geom: f.geom ?? null, positions: tess?.positions, normals: tess?.normals };
    });
    for (let y = rect.top + 30; y < rect.bottom - 90; y += 18) {
      for (let x = rect.left + 16; x < rect.right - 16; x += 18) {
        if (document.elementFromPoint(x, y) !== viewer.renderer.domElement) continue;
        const h = cadPickHit(x, y);
        if (!h) continue;
        const n = nominalOnCad(faces, h.id, h.p, type, 12);
        if (n && !n.pick.freeform && n.pick.fit.type === type) return { x, y, type };
      }
    }
    for (const f of faces) {
      if (!f.positions || f.positions.length < 9) continue;
      const step = Math.max(1, Math.floor(f.positions.length / 3 / 24));
      for (let i = 0; i < f.positions.length / 3; i += step) {
        const p = [f.positions[3 * i], f.positions[3 * i + 1], f.positions[3 * i + 2]];
        const n = nominalOnCad(faces, f.id, p, type, 12);
        if (n && !n.pick.freeform && n.pick.fit.type === type) return { x: 0, y: 0, type, direct: f.id, p };
      }
    }
    return null;
  }, type);
}

async function confirmNamed(page, touch, label, type) {
  const errs = [];
  await page.evaluate((t) => window.__app.startFitMode(t, 'soll'), type);
  const hit = await spotType(page, type);
  if (!hit) { errs.push(label + ': no ' + type); return errs; }
  console.log(label, type, JSON.stringify(hit));
  if (hit.direct != null) {
    await page.evaluate((h) => window.__app.previewFromCad({ id: h.direct, p: h.p }), hit);
  } else await pick(page, hit.x, hit.y, touch);
  try {
    await page.waitForFunction((t) => window.__app.state.preview?.fit?.type === t, type, { timeout: 12000 });
  } catch (e) {
    errs.push(label + ' ' + type + ' no preview: ' + (await page.textContent('#status')));
    return errs;
  }
  if (!(await page.locator('#cp-ok').isVisible().catch(() => false))) { errs.push(label + ' ' + type + ' no confirm'); return errs; }
  if (touch) await page.tap('#cp-ok'); else await page.click('#cp-ok');
  try {
    await page.waitForFunction((t) => window.__app.state.features.some((f) => f.type === t && (f.soll || f.measured)), type, { timeout: 8000 });
  } catch (e) { errs.push(label + ' ' + type + ' not in the tree'); }
  return errs;
}

async function builderChecks(page, touch) {
  const errs = [];
  const tree = await page.locator('#tree').innerText();
  for (const name of ['Data', 'Reference', 'Features', 'Coordinate Systems']) {
    if (!tree.includes(name)) errs.push('tree missing ' + name);
  }
  if (/\bObjects\b/.test(tree) || tree.includes('Datenobjekte')) errs.push('tree still has the old parent');
  await page.evaluate(() => window.__app.startFitMode('auto', 'soll'));
  if (await page.locator('#ctx-panel #cp-brush, #ctx-panel .cp-pick').count()) errs.push('nominal shows a brush or pick radius');
  if (!(await page.locator('#ctx-panel.fb-compact').count())) errs.push('compact Feature Builder is not the default');
  await page.evaluate(() => window.__app.startFitMode('auto', 'ist'));
  if (!(await page.locator('#ctx-panel .cp-pick, #ctx-panel #cp-brush').count())) errs.push('measured has no radius control');
  await page.evaluate(() => window.__app.startFitMode('Punkt', 'soll'));
  const face = await page.evaluate(() => {
    const f = window.__app.cad.faces.find((x) => x.geom);
    return f ? { id: f.id, p: f.geom.origin } : null;
  });
  if (!face) { errs.push('no face for a point'); return errs; }
  await page.evaluate((h) => window.__app.previewFromCad(h), face);
  try {
    await page.waitForFunction(() => window.__app.state.preview?.fit?.type === 'Punkt', null, { timeout: 8000 });
  } catch { errs.push('point preview missing'); return errs; }
  if (touch) await page.tap('#cp-ok'); else await page.click('#cp-ok');
  try {
    await page.waitForFunction(() => window.__app.state.features.some((f) => f.type === 'Punkt' && f.soll), null, { timeout: 8000 });
  } catch { errs.push('point not in the tree'); }
  const side = await page.evaluate(() => window.__app.state.opts.side);
  if (side !== 'soll') errs.push('point create changed the sticky side');
  await page.evaluate(() => window.__app.startFitMode('Ebene', 'ist'));
  if (!(await page.locator('#ctx-panel .cp-pick, #ctx-panel #cp-brush').count())) errs.push('measured plane has no radius');
  await page.evaluate((h) => window.__app.previewFromCad(h), face);
  try {
    await page.waitForFunction(() => window.__app.state.preview?.role === 'ist' && window.__app.state.preview?.fit?.type === 'Ebene', null, { timeout: 8000 });
  } catch { errs.push('measured plane preview missing'); return errs; }
  if (touch) await page.tap('#cp-ok'); else await page.click('#cp-ok');
  try {
    await page.waitForFunction(() => window.__app.state.features.some((f) => f.type === 'Ebene' && f.measured && !f.soll), null, { timeout: 8000 });
  } catch { errs.push('measured plane not in the tree'); }
  if ((await page.evaluate(() => window.__app.state.opts.side)) !== 'ist') errs.push('measured create inferred nominal');
  return errs;
}

async function run(name, browserType, contextOpts, touch) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errs = await boot(page);
  errs.push(...await confirmCurve(page, touch, name + ' surface', 'surface'));
  for (const type of ['Ebene', 'Zylinder', 'Kugel']) errs.push(...await confirmNamed(page, touch, name, type));
  errs.push(...await builderChecks(page, touch));
  errs.push(...await confirmCurve(page, touch, name + ' auto-edge', 'edge'));
  const explicit = await page.evaluate(() => window.__app.state.features.some((f) => f.type === 'Kreis') ? 'Linie' : 'Kreis');
  errs.push(...await confirmCurve(page, touch, name + ' explicit', explicit));
  errs.push(...await polylineMenu(page, touch));
  errs.push(...await confirmCurve(page, touch, name + ' polyline', 'Linienzug'));
  const feat = await page.evaluate(() => window.__app.state.features.map((f) => `${f.type}:${f.soll ? 'soll' : 'ist'}`).join(','));
  console.log(errs.length ? 'FEHLER ' + name + ' ' + errs.join(' | ') : 'OK ' + name + ' → ' + feat);
  await browser.close();
  return errs;
}

const errs = [];
errs.push(...await run('webkit-iphone', webkit, devices['iPhone 14'], true));
errs.push(...await run('desktop-mouse', chromium, { viewport: { width: 1400, height: 900 } }, false));
process.exitCode = errs.length ? 1 : 0;
