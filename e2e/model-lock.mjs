// Behaviour lock for the feature-model refactoring (Feature node → Ist), desktop + iPhone viewport:
// builds a representative project on the demo part (planes A|B|C as datums, hole, boss, circle/slot with aux plane, cone,
// sphere, torus, Auto circle, a constructed point, 19 controls incl. Position A|B|C, a 3-2-1 coordinate system, label offsets)
// and records a canonical snapshot of every result (fit values, point counts + index checksums, control results, CS
// and label offsets). Checks: (1) snapshot == committed baseline (e2e/baseline/model-lock.json, recorded with 0.27),
// (2) save/load roundtrip gives the identical snapshot, (3) an OLD project file (written by 0.27,
// e2e/baseline/model-lock-0.27.mw3d) loads to the identical snapshot (migration).
// Aufruf: node e2e/model-lock.mjs [URL|-] [--baseline]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
const args = process.argv.slice(2), BASELINE = args.includes('--baseline'), pos = args.filter((a) => !a.startsWith('--'));
let BASE = pos[0] && pos[0] !== '-' ? pos[0] : null, srv = null;
if (!BASE) { BASE = 'http://localhost:8772/'; srv = spawn('npx', ['serve', '-l', '8772', 'dist'], { stdio: 'ignore' }); await sleep(2500); }
const STL = fileURLToPath(new URL('../public/samples/beispielteil.stl', import.meta.url));
const SNAP = fileURLToPath(new URL('./baseline/model-lock.json', import.meta.url));
const OLD = fileURLToPath(new URL('./baseline/model-lock-0.27.mw3d', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = (m) => { console.error('FEHLER:', m); process.exitCode = 1; };
const diff = (a, b, path = '') => { // first differences between two snapshots
  const out = []; const ka = typeof a, kb = typeof b;
  if (ka !== kb || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) return [`${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`];
  if (ka === 'object' && a) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { out.push(...diff(a[k], b[k], path + '.' + k)); if (out.length > 12) break; } return out; }
  return a === b ? [] : [`${path}: ${a} ≠ ${b}`];
};
const SNAPSHOT = () => { const A = window.__app, S = A.state;
  const r = (x) => typeof x === 'number' ? (Number.isFinite(x) ? +x.toPrecision(10) : String(x)) : Array.isArray(x) ? x.map(r) : x && typeof x === 'object' && !ArrayBuffer.isView(x) ? Object.fromEntries(Object.keys(x).sort().filter((k) => k !== 'residuals').map((k) => [k, r(x[k])])) : x;
  const ck = (a) => { if (!a) return null; let h = 0; for (let i = 0; i < a.length; i++) h = (h * 31 + a[i]) >>> 0; return [a.length, h]; };
  return r({
    features: S.features.map((f) => ({ id: f.id, name: f.name, type: f.type, method: f.method, datum: f.datum ?? null, refs: f.refs ?? null, cons: f.cons ?? null, pointCount: f.pointCount,
      fit: f.measured, aux: f.aux ? { plane: f.aux.plane, pointCount: f.aux.pointCount, source: f.aux.source } : null, idx: ck(f.indices), auxIdx: ck(f.auxIndices), src: ck(f.src), fp: f.fp ?? null, reex: f.reex ?? null })),
    controls: S.controls.map((c) => ({ c, res: A.evaluateControl(c.id) })),
    csys: S.csys.map((c) => ({ c, res: A.csResult(c) })), activeCs: S.activeCs,
    reports: S.reports, typeCount: S.typeCount, nextId: S.nextId, nextCtrl: S.nextCtrl, labelOffsets: [...S.labelOffsets.entries()],
  }); };
const BUILD = async () => { const A = window.__app, S = A.state, w = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = async (mode, p, n) => { S.preview = null; S.opts.pick = 1.5; A.startFitMode(mode); await w(50); await A.previewByClick(A.hitAt(p, n)); await w(100); const k = S.features.length; await A.commitPreview(); await w(100); return S.features[k]; };
  const T = A.TRAIN_FEATS;
  const a = await mk('Ebene', T.A[1], T.A[2]), b = await mk('Ebene', T.B[1], T.B[2]), c = await mk('Ebene', T.C[1], T.C[2]);
  A.setDatum(a, 'A'); A.setDatum(b, 'B'); A.setDatum(c, 'C');
  const hole = await mk('Zylinder', T.H[1], T.H[2]), boss = await mk('Zylinder', [63.05, 30, 26], [1, 0, 0]);
  const circ = await mk('Kreis', [20, 26.84, 20], [0, 0, 1]), slot = await mk('Langloch', [20, 39.2, 20], [0, 0, 1]);
  const cone = await mk('Kegel', [89, 38, 25], [10 / Math.hypot(10, 6), 0, 6 / Math.hypot(10, 6)]), sph = await mk('Kugel', [60, 8, 24], [0, 0, 1]), tor = await mk('Torus', [46, 10, 22.8], [0, 0, 1]);
  const autoF = await mk('auto', [85 + 3.8 * Math.cos(3.5), 10 + 3.8 * Math.sin(3.5), 20], [0, 0, 1]);
  S.mode = null; S.preview = null;
  // constructed point: intersection of the 3 datum planes
  A.startConstruct('Punkt', 'pt-3planes'); A.conPick(a.id); A.conPick(b.id); A.conPick(c.id); await w(100); if (S.preview) await A.commitPreview(); S.mode = null; S.preview = null;
  const ctl = (kind, f, nominal, up, lo, datums) => { A.addControl(kind, f.id); const k = S.controls.at(-1); if (nominal !== undefined) k.nominal = nominal; if (up !== undefined) { k.tolUp = up; k.tolLo = lo; } if (datums) k.datumIds = datums.map((x) => x.id); return k; };
  ctl('Durchmesser', hole, 12, 0.1, -0.05); ctl('Form', a, null, 0.05, 0); ctl('Form', hole, null, 0.05, 0); ctl('Std.-Abw.', a);
  const ps = ctl('Position', hole, undefined, 0.1, 0, [a, b, c]); ps.basic = ps.basic ?? []; 
  ctl('Rechtwinkligkeit', hole, undefined, 0.05, 0, [a]); ctl('Parallelität', a, undefined, 0.05, 0, [a]); ctl('Rechtwinkligkeit', b, undefined, 0.05, 0, [a]);
  ctl('Durchmesser', boss, 16, 0.05, -0.05); ctl('Position', boss, undefined, 0.2, 0, [a, b, c]); ctl('Durchmesser', circ, 12.08, 0.02, -0.02);
  ctl('Länge', slot, 30, 0.1, -0.1); ctl('Breite', slot, 10, 0.1, -0.1); ctl('Kegelwinkel', cone); ctl('Radius', sph, 7, 0.02, -0.02); ctl('Rohrdurchmesser', tor, 4, 0.05, -0.05);
  ctl('X', hole, 20, 0.1, -0.1); ctl('Z', sph, 17, 0.1, -0.1); ctl('Koaxialität', boss, undefined, 0.1, 0, [hole]); void autoF;
  // coordinate system 3-2-1 from A, B, C
  S.sel = []; A.csNew(); A.csPick(a.id); A.csPick(b.id); A.csPick(c.id); A.csOk(); await w(100);
  S.labelOffsets.set('f' + hole.id, [5, 6]); A.renderAll(); await w(300); };
const results = {};
for (const v of [{ name: 'desktop', viewport: { width: 1400, height: 900 } }, { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext({ ...v, acceptDownloads: true }), page = await ctx.newPage(), errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?nodemo'); await sleep(2500);
  await page.setInputFiles('#file', STL); await page.waitForSelector('#unit-dlg', { timeout: 180000 }); await page.click('#unit-dlg [data-ok]'); await sleep(5000);
  await page.evaluate(BUILD);
  const s0 = await page.evaluate(SNAPSHOT);
  await page.evaluate(async () => { await window.__app.roundtrip(); await new Promise((r) => setTimeout(r, 500)); });
  const s1 = await page.evaluate(SNAPSHOT);
  const d01 = diff(s0, s1); if (d01.length) fail(`${v.name}: save/load roundtrip changed results: ${d01.join(' | ')}`);
  results[v.name] = s0;
  if (!BASELINE) { // structure from 0.28: feature node + Ist, project format 2
    const m = await page.evaluate(() => { const A = window.__app, S = A.state, j = A.projectJSON();
      const flat = ['measured', 'pointCount', 'method', 'aux', 'reex', 'anchor', 'fp', 'indices', 'src'];
      return { nodes: S.features.every((f) => f.ist && f.ist.source && !flat.some((k) => Object.keys(f).includes(k))), format: j.featureModel,
        json: j.state.features.every((f) => f.ist && !('measured' in f) && !('indices' in f.ist) && (f.ist.fit || f.type === 'Punkt')), src: [...new Set(S.features.map((f) => f.ist.source))].join() }; });
    console.log(v.name, 'model', JSON.stringify(m));
    if (!m.nodes || m.format !== 2 || !m.json) fail(`${v.name}: feature node/Ist structure not in place (${JSON.stringify(m)})`);
  }
  console.log(v.name, `${s0.features.length} features, ${s0.controls.length} controls, ${s0.csys.length} CS – roundtrip ${d01.length ? '✗' : 'identical'}`);
  if (v.name === 'desktop') {
    if (BASELINE) { const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.__app.saveProject())]); await dl.saveAs(OLD); console.log('old-format project written', OLD); }
    else if (existsSync(OLD)) {
      await page.setInputFiles('#file-project', OLD); await sleep(6000);
      const s2 = await page.evaluate(SNAPSHOT); const base = JSON.parse(readFileSync(SNAP, 'utf8')).desktop;
      const d = diff(base, s2); if (d.length) fail(`old 0.27 project: loaded results differ: ${d.join(' | ')}`); else console.log('old 0.27 project file: loaded identically');
    } else console.log('(old project fixture missing – migration check skipped)');
  }
  if (errors.length) fail(`${v.name}: page errors ${errors.join(' | ')}`);
  await ctx.close();
}
if (BASELINE) { writeFileSync(SNAP, JSON.stringify(results, null, 1)); console.log('baseline written', SNAP); }
else { const base = JSON.parse(readFileSync(SNAP, 'utf8')); for (const k of Object.keys(results)) { const d = diff(base[k], results[k]); if (d.length) fail(`${k}: results differ from the 0.27 baseline: ${d.join(' | ')}`); else console.log(k, 'identical to the 0.27 baseline'); } }
await browser.close(); srv?.kill();
console.log(process.exitCode ? 'model-lock: FEHLER' : 'model-lock: OK');
