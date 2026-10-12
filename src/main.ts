// MessWerk 3D – Benutzeroberfläche (Layout angelehnt an typische Inspektionssoftware:
// Ribbon oben, Baumansicht links, 3D-Szene Mitte, Dialogbereich rechts, Prüfmerkmal-Tabelle unten).
import { Engine } from './engine';
import { Viewer, Hit } from './viewer';
import { FitResult, GeomType } from './core/fit';
import {
  Control, ControlKind, Feature, availableControls, controlLabel, controlsCSV, defaultControls,
  defaultTolerance, evaluate, featureCSV, DEG, FORM_NAME,
} from './core/features';
import { ICON } from './icons';

type Mode = { type: GeomType | 'auto'; method: 'Klick' | 'Pinsel' } | null;
interface FeatureView extends Feature { color: number; indices: Uint32Array; visible: boolean; }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const engine = new Engine();
const viewer = new Viewer($('#scene'));
const PALETTE = [0xe6194b, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0x00a3a3, 0xf032e6, 0x9a6324, 0x2f4f4f, 0x808000, 0x000075, 0xaa6e28];

const state = {
  data: null as null | { name: string; vertexCount: number; triCount: number; diag: number },
  features: [] as FeatureView[],
  controls: [] as Control[],
  sel: [] as number[],              // gewählte Merkmal-IDs
  selControl: null as number | null,
  mode: null as Mode,
  pendingDistance: null as null | ControlKind,
  opts: { maxAngleDeg: 20, radius: 0, brush: 3 },
  brushMask: null as Uint8Array | null,
  brushCount: 0,
  showPrims: true, colorPts: true,
  nextId: 1, nextCtrl: 1, typeCount: {} as Record<string, number>,
};
(window as any).__app = { state, viewer, engine };

const featMap = () => new Map<number, Feature>(state.features.map((f) => [f.id, f]));
const fmt = (v: number | null | undefined, d = 4) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const rgb = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

function status(t: string) { $('#status').textContent = t; }
function hint(t: string) { $('#hint').textContent = t; }
async function busy<T>(p: Promise<T>): Promise<T> {
  $('#busy').classList.remove('hidden');
  try { return await p; } finally { $('#busy').classList.add('hidden'); }
}

// ------------------------------------------------------------------ Ribbon
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll<HTMLElement>('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tab !== b.dataset.tab));
}));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => viewer.view(b.dataset.view as any)));

const TYPES: (GeomType | 'auto')[] = ['auto', 'Ebene', 'Kreis', 'Zylinder', 'Langloch', 'Kegel', 'Kugel', 'Punkt'];
const typeBtns = $('#feat-type-btns');
for (const t of TYPES) {
  const b = document.createElement('button');
  b.className = 'big'; b.dataset.ftype = t;
  b.innerHTML = `<span class="ico">${ICON[t]}</span>${t === 'auto' ? 'Automatisch' : t}`;
  b.onclick = () => startMode(t);
  typeBtns.appendChild(b);
}

function startMode(t: GeomType | 'auto') {
  if (!state.data) { status('Bitte zuerst ein Polygonmodell laden.'); return; }
  state.mode = { type: t, method: state.mode?.method ?? 'Klick' };
  state.pendingDistance = null;
  clearBrush();
  renderAll();
}
function stopMode() { state.mode = null; clearBrush(); viewer.controls.enabled = true; viewer.showCursor(null, 1); renderAll(); }

$('#file').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  await loadBuffer(f.name, await f.arrayBuffer());
  (e.target as HTMLInputElement).value = '';
};
$('#btn-sample').onclick = async () => {
  status('Lade Beispiel …');
  const r = await fetch('./samples/beispielteil.stl');
  await loadBuffer('beispielteil.stl', await r.arrayBuffer());
};
$('#btn-csv').onclick = () => download('pruefmerkmale.csv', controlsCSV(state.controls, featMap()));
$('#btn-csv-feat').onclick = () => download('merkmale.csv', featureCSV(state.features));
$('#btn-delete-feat').onclick = () => deleteSelected();
$('#btn-toggle-prims').onclick = () => { state.showPrims = !state.showPrims; renderScene(); renderRibbon(); };
$('#btn-toggle-pts').onclick = () => { state.colorPts = !state.colorPts; renderScene(); renderRibbon(); };
document.querySelectorAll<HTMLButtonElement>('[data-dist]').forEach((b) => (b.onclick = () => startDistance(b.dataset.dist as ControlKind)));

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  status(`${name} exportiert.`);
}

async function loadBuffer(name: string, buf: ArrayBuffer) {
  try {
    const t0 = performance.now();
    const r = await busy(engine.call<any>({ op: 'load', name, buffer: buf }, [buf]));
    viewer.setModel(r.positions, r.indices, r.normals);
    state.data = { name: r.name, vertexCount: r.vertexCount, triCount: r.triCount, diag: r.bounds.diag };
    state.features = []; state.controls = []; state.sel = []; state.mode = null;
    state.opts.brush = +(r.bounds.diag / 25).toFixed(1);
    $('#projname').textContent = r.name;
    status(`${name} geladen in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
    $('#stats').textContent = `${r.vertexCount.toString()} Punkte · ${r.triCount.toString()} Dreiecke`;
    renderAll();
  } catch (e: any) { status('Fehler beim Import: ' + e.message); }
}

// ------------------------------------------------------------------ 3D-Interaktion
let down: { x: number; y: number; t: number; id: number } | null = null;
let painting = false;
const canvas = viewer.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  if (state.mode?.method === 'Pinsel' && e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)) {
    const h = viewer.pick(e.clientX, e.clientY);
    if (h) { painting = true; viewer.controls.enabled = false; brushAt(h); }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (state.mode?.method !== 'Pinsel') return;
  const h = viewer.pick(e.clientX, e.clientY);
  viewer.showCursor(h, state.opts.brush);
  if (painting && h) brushAt(h);
});
window.addEventListener('pointerup', async (e) => {
  if (painting) { painting = false; viewer.controls.enabled = true; down = null; return; }
  if (!down || e.target !== canvas) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 6 || dt > 600) return;
  const h = viewer.pick(e.clientX, e.clientY);
  if (state.mode?.method === 'Klick' && h) await createByClick(h);
});

let brushBusy = false;
async function brushAt(h: Hit) {
  if (brushBusy || !state.brushMask) return;
  brushBusy = true;
  try {
    const r = await engine.call<any>({ op: 'brush', center: h.point, radius: state.opts.brush, facing: h.normal });
    const add: number[] = [];
    for (const v of r.indices as Uint32Array) if (!state.brushMask[v]) { state.brushMask[v] = 1; add.push(v); state.brushCount++; }
    viewer.paint(Uint32Array.from(add), [1, 0.85, 0]); viewer.commitColors();
    renderDialog();
  } finally { brushBusy = false; }
}
function clearBrush() {
  state.brushMask = state.data ? new Uint8Array(state.data.vertexCount) : null;
  state.brushCount = 0;
}

async function createByClick(h: Hit) {
  const m = state.mode!;
  try {
    const r = await busy(engine.call<any>({ op: 'grow', tri: h.tri, point: h.point, maxAngleDeg: state.opts.maxAngleDeg, radius: state.opts.radius, type: m.type }));
    addFeature(r.fit, r.indices, 'Klick', r.candidates);
    status(`${r.fit.type} erstellt aus ${r.indices.length.toString()} Punkten (${r.ms.toFixed(0)} ms).`);
  } catch (e: any) { status('Merkmal konnte nicht erstellt werden: ' + e.message); }
}

async function createFromBrush() {
  if (!state.brushMask || !state.brushCount) { status('Zuerst Bereich mit dem Pinsel markieren.'); return; }
  const idx = new Uint32Array(state.brushCount); let k = 0;
  state.brushMask.forEach((v, i) => { if (v) idx[k++] = i; });
  try {
    const r = await busy(engine.call<any>({ op: 'fit', indices: idx, type: state.mode!.type }));
    addFeature(r.fit, r.indices, 'Pinsel', r.candidates);
    clearBrush();
    status(`${r.fit.type} aus markiertem Bereich erstellt.`);
  } catch (e: any) { status('Fit fehlgeschlagen: ' + e.message); }
}

function addFeature(fit: FitResult, indices: Uint32Array, method: 'Klick' | 'Pinsel', cands: { type: string; rms: number }[]) {
  const n = (state.typeCount[fit.type] = (state.typeCount[fit.type] ?? 0) + 1);
  const f: FeatureView = {
    id: state.nextId++, name: `${fit.type} ${n}`, type: fit.type, measured: fit, pointCount: indices.length,
    method, color: PALETTE[(state.nextId - 2) % PALETTE.length], indices, visible: true,
  };
  (f as any).candidates = cands;
  state.features.push(f);
  for (const kind of defaultControls(f.type)) addControl(kind, [f.id]);
  state.sel = [f.id]; state.selControl = null;
  renderAll();
}

function addControl(kind: ControlKind, ids: number[]) {
  const t = defaultTolerance(kind);
  state.controls.push({ id: state.nextCtrl++, kind, featureIds: ids, nominal: t.nominal, tolUp: t.up, tolLo: t.lo });
}

function startDistance(kind: ControlKind) {
  if (state.sel.length === 2) { addControl(kind, [...state.sel]); renderAll(); status(`${kind} erstellt.`); return; }
  if (state.sel.length !== 1) { status('Für einen Abstand zuerst ein Merkmal in der Baumansicht wählen.'); return; }
  state.pendingDistance = kind; state.mode = null;
  hint(`${kind}: zweites Merkmal in der Baumansicht wählen …`);
  renderDialog();
}

function selectFeature(id: number, additive = false) {
  if (state.pendingDistance && state.sel.length === 1 && state.sel[0] !== id) {
    addControl(state.pendingDistance, [state.sel[0], id]);
    status(`${state.pendingDistance} zwischen ${nameOf(state.sel[0])} und ${nameOf(id)} erstellt.`);
    state.pendingDistance = null; state.sel = [state.sel[0], id];
  } else if (additive) {
    state.sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id].slice(-2);
  } else state.sel = [id];
  state.selControl = null;
  renderAll();
}
const nameOf = (id: number) => state.features.find((f) => f.id === id)?.name ?? '?';

function deleteSelected() {
  if (state.selControl != null) { state.controls = state.controls.filter((c) => c.id !== state.selControl); state.selControl = null; }
  else if (state.sel.length) {
    const s = new Set(state.sel);
    state.features = state.features.filter((f) => !s.has(f.id));
    state.controls = state.controls.filter((c) => !c.featureIds.some((i) => s.has(i)));
    state.sel = [];
  }
  renderAll();
}
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === 'Escape') { state.pendingDistance = null; stopMode(); }
  if (e.key === 'Delete') deleteSelected();
});

// ------------------------------------------------------------------ Darstellung
function renderAll() { renderRibbon(); renderTree(); renderDialog(); renderTable(); renderScene(); renderHint(); }

function renderRibbon() {
  document.querySelectorAll<HTMLButtonElement>('[data-ftype]').forEach((b) => b.classList.toggle('on', state.mode?.type === b.dataset.ftype));
  $('#btn-toggle-prims').classList.toggle('on', state.showPrims);
  $('#btn-toggle-pts').classList.toggle('on', state.colorPts);
  const cb = $('#ctrl-btns'); cb.innerHTML = '';
  const f = state.features.find((x) => x.id === state.sel[0]);
  const kinds: ControlKind[] = f ? availableControls(f.type) : ['Durchmesser', 'X', 'Y', 'Z', 'Form'];
  for (const k of kinds) {
    const b = document.createElement('button'); b.className = 'big'; b.disabled = !f;
    b.innerHTML = `<span class="ico">${ICON[k] ?? '#'}</span>${f && k === 'Form' ? FORM_NAME[f.type] : k}`;
    b.onclick = () => { addControl(k, [f!.id]); renderAll(); };
    cb.appendChild(b);
  }
}

function renderHint() {
  if (state.pendingDistance) return;
  if (!state.data) hint('');
  else if (state.mode?.method === 'Klick') hint(`${state.mode.type === 'auto' ? 'Automatische Erkennung' : state.mode.type}: auf die Fläche im Netz klicken/tippen. Esc beendet.`);
  else if (state.mode?.method === 'Pinsel') hint('Pinsel: Bereich überstreichen (Ziehen markiert, Navigation pausiert), dann „Erstellen“.');
  else hint('');
}

function statusOfFeature(id: number): 'IO' | 'NIO' | null {
  const fm = featMap(); let any = false;
  for (const c of state.controls) if (c.featureIds.includes(id)) {
    const r = evaluate(c, fm); if (r.status === 'NIO') return 'NIO'; if (r.status === 'IO') any = true;
  }
  return any ? 'IO' : null;
}

function renderTree() {
  const q = ($('#search') as HTMLInputElement).value.trim().toLowerCase();
  const t = $('#tree'); t.innerHTML = '';
  const node = (html: string, cls: string, onClick?: (e: MouseEvent) => void, sel = false) => {
    const d = document.createElement('div'); d.className = `node ${cls}${sel ? ' sel' : ''}`; d.innerHTML = html;
    if (onClick) d.onclick = onClick; t.appendChild(d); return d;
  };
  node(`<span class="tw">▾</span>${ICON.folder}<b>Objekte</b>`, '');
  node(`<span class="tw">▾</span>${ICON.data}Daten`, 'indent1');
  if (state.data) node(`<span class="tw"></span>${ICON.mesh}${state.data.name} <span class="note">(Polygonmodell)</span>`, 'indent2');
  node(`<span class="tw">▾</span>${ICON.folder}Merkmale (${state.features.length})`, 'indent1');
  const fm = featMap();
  for (const f of state.features) {
    if (q && !f.name.toLowerCase().includes(q) && !f.type.toLowerCase().includes(q)) continue;
    const st = statusOfFeature(f.id);
    node(`<span class="tw">▸</span><span style="color:${hex(f.color)}">${ICON[f.type]}</span>${f.name}${st ? `<span class="badge ${st}">${st}</span>` : ''}`,
      'indent2', (e) => selectFeature(f.id, e.ctrlKey || e.metaKey || e.shiftKey), state.sel.includes(f.id));
    for (const c of state.controls.filter((c) => c.featureIds[0] === f.id && c.featureIds.length === 1)) {
      const r = evaluate(c, fm);
      node(`<span class="tw"></span>${ICON.control}${controlLabel(c, f)}${r.status !== '—' ? `<span class="badge ${r.status}">${r.status}</span>` : ''}`,
        'indent3', () => { state.sel = [f.id]; state.selControl = c.id; renderAll(); }, state.selControl === c.id);
    }
  }
  const multi = state.controls.filter((c) => c.featureIds.length > 1);
  node(`<span class="tw">▾</span>${ICON.folder}Prüfmerkmale – Abstände (${multi.length})`, 'indent1');
  for (const c of multi) {
    const r = evaluate(c, fm);
    node(`<span class="tw"></span>${ICON['Abstand 3D']}${c.kind}: ${nameOf(c.featureIds[0])} → ${nameOf(c.featureIds[1])}${r.status !== '—' ? `<span class="badge ${r.status}">${r.status}</span>` : ''}`,
      'indent2', () => { state.sel = [...c.featureIds]; state.selControl = c.id; renderAll(); }, state.selControl === c.id);
  }
}
($('#search') as HTMLInputElement).oninput = () => renderTree();

function numInput(v: number | null, onChange: (x: number | null) => void) {
  const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'decimal';
  i.value = v == null ? '' : String(v);
  i.onchange = () => { const s = i.value.replace(',', '.').trim(); const x = s === '' ? null : Number(s); if (s === '' || isFinite(x!)) onChange(x); renderAll(); };
  return i;
}

function renderDialog() {
  const d = $('#dialog'); d.innerHTML = '';
  if (state.mode) {
    const m = state.mode;
    d.innerHTML = `<h3>${ICON[m.type]} Merkmal erstellen: ${m.type === 'auto' ? 'Automatisch' : m.type}</h3>
      <div class="seg"><button data-m="Klick" class="${m.method === 'Klick' ? 'on' : ''}">Klick + Wachstum</button><button data-m="Pinsel" class="${m.method === 'Pinsel' ? 'on' : ''}">Pinsel</button></div>
      <h4>Typ</h4><div class="row"><select id="d-type">${TYPES.map((t) => `<option ${t === m.type ? 'selected' : ''} value="${t}">${t === 'auto' ? 'Automatisch erkennen' : t}</option>`).join('')}</select></div>
      ${m.method === 'Klick' ? `<h4>Regionenwachstum</h4>
      <div class="row"><label>Max. Normalenwinkel [°]</label><input id="d-ang" value="${state.opts.maxAngleDeg}" inputmode="decimal"></div>
      <div class="row"><label>Suchradius [mm] (0 = ∞)</label><input id="d-rad" value="${state.opts.radius}" inputmode="decimal"></div>
      <p class="note">Ausgehend vom Klickpunkt werden benachbarte Dreiecke gesammelt, solange der Normalenwinkel zwischen Nachbarn kleiner als der Grenzwert ist (Kanten stoppen das Wachstum). Danach Ausgleichsrechnung (kleinste Quadrate, robust mit 3σ-Ausreißerentfernung).</p>`
      : `<h4>Pinsel</h4><div class="row"><label>Pinselradius [mm]</label><input id="d-brush" value="${state.opts.brush}" inputmode="decimal"></div>
      <div class="row"><label>Markiert</label><b>${state.brushCount.toString()} Punkte</b></div>
      <button class="btn primary" id="d-create">Erstellen</button><button class="btn" id="d-clear">Markierung löschen</button>`}
      <div><button class="btn" id="d-close">Schließen</button></div>`;
    d.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => (b.onclick = () => { state.mode!.method = b.dataset.m as any; clearBrush(); renderScene(); renderAll(); }));
    ($('#d-type') as HTMLSelectElement).onchange = (e) => { state.mode!.type = (e.target as HTMLSelectElement).value as any; renderAll(); };
    const bind = (id: string, key: 'maxAngleDeg' | 'radius' | 'brush') => { const el = d.querySelector<HTMLInputElement>(id); if (el) el.onchange = () => { const x = Number(el.value.replace(',', '.')); if (isFinite(x)) state.opts[key] = x; }; };
    bind('#d-ang', 'maxAngleDeg'); bind('#d-rad', 'radius'); bind('#d-brush', 'brush');
    d.querySelector<HTMLButtonElement>('#d-create')?.addEventListener('click', createFromBrush);
    d.querySelector<HTMLButtonElement>('#d-clear')?.addEventListener('click', () => { clearBrush(); renderScene(); renderDialog(); });
    ($('#d-close') as HTMLButtonElement).onclick = stopMode;
    return;
  }
  const f = state.features.find((x) => x.id === state.sel[0]);
  if (!f) {
    d.innerHTML = state.data
      ? `<h3>Polygonmodell</h3><div class="kv"><div>Name</div><div>${state.data.name}</div><div>Punkte</div><div>${state.data.vertexCount.toString()}</div><div>Dreiecke</div><div>${state.data.triCount.toString()}</div></div>
        <p class="note">Im Register <b>Merkmale</b> einen Typ (oder „Automatisch“) wählen und auf das Netz klicken. Navigation: Ziehen = Drehen, Rechts/Zwei Finger = Verschieben, Rad/Pinch = Zoom.</p>`
      : `<h3>Willkommen</h3><p class="note">Polygonmodell (STL, PLY, OBJ) oder Punktwolke (XYZ) importieren oder <b>Beispiel laden</b>.</p>`;
    return;
  }
  const m = f.measured!;
  const rows: [string, string][] = [
    ['Typ', f.type], ['Methode', f.method], ['Punkte', f.pointCount.toString()],
    ['X', fmt(m.center[0])], ['Y', fmt(m.center[1])], ['Z', fmt(m.center[2])],
    ['I', fmt(m.normal[0], 6)], ['J', fmt(m.normal[1], 6)], ['K', fmt(m.normal[2], 6)],
  ];
  if (m.diameter != null && f.type !== 'Langloch') rows.push(['Durchmesser', fmt(m.diameter)], ['Radius', fmt(m.radius)]);
  if (f.type === 'Langloch') rows.push(['Länge', fmt(m.length)], ['Breite', fmt(m.width)], ['Richtung', m.direction!.map((v) => v.toFixed(4)).join(' ')]);
  if (f.type === 'Zylinder' || f.type === 'Kegel') rows.push(['Höhe', fmt(m.length)]);
  if (f.type === 'Kegel') rows.push(['Kegelwinkel [°]', fmt(2 * m.halfAngle! * DEG)], ['Spitze', m.apex!.map((v) => v.toFixed(3)).join(' ')]);
  rows.push([FORM_NAME[f.type], fmt(m.form)], ['Std.-Abw. (RMS)', fmt(m.rms)]);
  d.innerHTML = `<h3><span style="color:${hex(f.color)}">${ICON[f.type]}</span> ${f.name}</h3>
    <div class="row"><label>Name</label><input id="d-name" value="${f.name}"></div>
    <h4>Ist-Komponente</h4><div class="kv">${rows.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('')}</div>
    ${(f as any).candidates?.length ? `<h4>Erkennung (RMS je Typ)</h4><div class="kv">${(f as any).candidates.map((c: any) => `<div>${c.type}</div><div>${fmt(c.rms)}</div>`).join('')}</div>` : ''}
    <h4>Typ ändern (Neuberechnung)</h4><div class="row"><select id="d-retype">${TYPES.filter((t) => t !== 'auto').map((t) => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn" id="d-refit">Neu fitten</button></div>
    <h4>Prüfmerkmale</h4><div id="d-ctrls"></div>
    <div><button class="btn" id="d-del">Merkmal löschen</button></div>`;
  ($('#d-name') as HTMLInputElement).onchange = (e) => { f.name = (e.target as HTMLInputElement).value; renderAll(); };
  ($('#d-del') as HTMLButtonElement).onclick = () => { state.selControl = null; deleteSelected(); };
  ($('#d-refit') as HTMLButtonElement).onclick = async () => {
    const t = ($('#d-retype') as HTMLSelectElement).value as GeomType;
    try {
      const r = await busy(engine.call<any>({ op: 'fit', indices: f.indices, type: t }));
      f.type = r.fit.type; f.measured = r.fit;
      state.controls = state.controls.filter((c) => !(c.featureIds.length === 1 && c.featureIds[0] === f.id && !availableControls(f.type).includes(c.kind)));
      if (!state.controls.some((c) => c.featureIds[0] === f.id)) for (const k of defaultControls(f.type)) addControl(k, [f.id]);
      renderAll();
    } catch (e: any) { status('Fit fehlgeschlagen: ' + e.message); }
  };
  const box = $('#d-ctrls');
  const fm = featMap();
  for (const c of state.controls.filter((c) => c.featureIds.includes(f.id))) {
    const r = evaluate(c, fm);
    const div = document.createElement('div'); div.className = 'row';
    div.innerHTML = `<label>${c.featureIds.length > 1 ? `${c.kind} → ${nameOf(c.featureIds.find((i) => i !== f.id)!)}` : controlLabel(c, f)}</label><span>${fmt(r.measured, 3)}</span><span class="st ${r.status === '—' ? 'none' : r.status}">${r.status}</span>`;
    box.appendChild(div);
  }
}

function renderTable() {
  const tb = $('#ctrl-table tbody'); tb.innerHTML = '';
  const fm = featMap();
  let io = 0, nio = 0;
  for (const c of state.controls) {
    const r = evaluate(c, fm); if (r.status === 'IO') io++; if (r.status === 'NIO') nio++;
    const f = fm.get(c.featureIds[0]);
    const tr = document.createElement('tr');
    if (state.selControl === c.id || (state.selControl == null && c.featureIds.every((i) => state.sel.includes(i)) && state.sel.length === c.featureIds.length)) tr.className = 'sel';
    const td = (html: string | HTMLElement, cls = '') => { const e = document.createElement('td'); e.className = cls; if (typeof html === 'string') e.innerHTML = html; else e.appendChild(html); tr.appendChild(e); return e; };
    td(c.featureIds.map(nameOf).join(' → '));
    td(controlLabel(c, f));
    td(numInput(c.nominal, (x) => (c.nominal = x)), 'num');
    td(fmt(r.measured), 'num');
    td(fmt(r.deviation), `num dev ${r.status}`);
    td(numInput(c.tolUp, (x) => (c.tolUp = x ?? 0)), 'num');
    td(numInput(c.tolLo, (x) => (c.tolLo = x == null ? 0 : -Math.abs(x))), 'num');
    td(`<span class="st ${r.status === '—' ? 'none' : r.status}">${r.status}</span>`);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Löschen';
    x.onclick = (e) => { e.stopPropagation(); state.controls = state.controls.filter((k) => k.id !== c.id); renderAll(); };
    td(x);
    tr.onclick = (e) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; state.sel = [...c.featureIds]; state.selControl = c.id; renderTree(); renderDialog(); renderScene(); renderTable(); };
    tb.appendChild(tr);
  }
  $('#summary').innerHTML = state.controls.length ? `${state.controls.length} Prüfmerkmale · <span style="color:var(--io)">${io} IO</span> · <span style="color:var(--nio)">${nio} NIO</span>` : '';
}

function renderScene() {
  if (!state.data) return;
  viewer.resetColors();
  if (state.colorPts) for (const f of state.features) {
    const c = rgb(f.color), s = state.sel.includes(f.id);
    viewer.paint(f.indices, s ? c : c.map((v) => 0.55 * v + 0.45 * 0.68));
  }
  if (state.brushMask && state.brushCount) {
    const idx: number[] = []; state.brushMask.forEach((v, i) => v && idx.push(i));
    viewer.paint(Uint32Array.from(idx), [1, 0.85, 0]);
  }
  viewer.commitColors();
  viewer.clearPrims();
  if (state.showPrims) for (const f of state.features) viewer.addPrimitive(f.measured!, f.color, state.sel.includes(f.id));
}

renderAll();
