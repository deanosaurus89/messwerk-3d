// Re-extraction UI (feature dialog section). The SAME extraction parameter set as the Creation Panel: outer contour,
// islands, boundary exclusion distance, search distance ± (+ lateral extension under Advanced), normal angle criterion
// and outlier removal (each with an on/off checkbox). Every change recomputes the result LIVE in the worker (debounced)
// and shows the search region + the captured points; “Apply extraction” only commits.
import { t as tt } from '../i18n';
import { REEX_DEFAULT, ReexParams, SearchRegion, normReex } from '../core/reextract';
import type { Feature } from '../core/features';
import type { FitResult } from '../core/fit';
import type { Vec3 } from '../core/linalg';
import { parseNum } from './numfield';

type RxFeature = Feature & { indices: Uint32Array; src?: Uint32Array; dev?: Float32Array; hit?: unknown; anchor?: { pts: Vec3[] };
  fp?: { crit?: 'lsq' | 'mz' | 'mcc' | 'mic'; k: number; nf: { on: boolean; angleDeg: number }; inset?: number; zoneSrc?: 'points' | 'geom'; zoneBand?: number; fill?: { on: boolean; band: number; exRaised?: boolean; islands?: boolean } } };
interface ReexOut { fit: FitResult; indices: Uint32Array; removedSigma: number; candidates: number; iterations: number; region: SearchRegion }
interface Host { call(req: unknown): Promise<ReexOut>; renderAll(): void; renderScene(): void; showZone(): boolean; setShowZone(on: boolean): void; lasso(): Promise<{ m: number[]; poly: [number, number][] } | null>; toast(t: string): void; invalidate(id: number): void; recompute(): void; autosave(): void; flash(sel: string, pending?: boolean): void; fmt(v: number, d?: number): string }
let H: Host;
export function initReexUI(h: Host) { H = h; }
export const REEX_TYPES = ['Ebene', 'Zylinder', 'Kugel', 'Kegel', 'Kreis', 'Langloch', 'Linie', 'Torus'];
const reexP: ReexParams = { ...REEX_DEFAULT };

/** live preview: search region + captured points of the current parameters (not applied yet) */
let reexPrev: { id: number; R: SearchRegion; idx: Uint32Array; out: ReexOut; key: string } | null = null;
export const reexPreview = (alive: (id: number) => boolean) => (reexPrev && alive(reexPrev.id) ? reexPrev.R : null);
export const reexPreviewPts = (alive: (id: number) => boolean) => (reexPrev && alive(reexPrev.id) ? reexPrev.idx : null);
export const clearReexPreview = () => { reexPrev = null; };

/** parameters for a feature: its last re-extraction, else the parameters it was CREATED with (identical set), migrated */
const drafts = new Map<number, ReexParams>();
/** open/closed state of the re-extraction section per feature, as the user left it – a re-render of the dialog
 *  (datum, tolerance, name …) must not open it (opening starts the zone preview = orange points + zone body) */
const rxOpen = new Map<number, boolean>();
let advOpen = false;
function paramsFor(f: RxFeature): ReexParams {
  const dr = drafts.get(f.id); if (dr) return dr;
  if (f.reex) { const { points, removed, before, ...q } = f.reex as any; void points; void removed; void before; return normReex({ ...reexP, ...q }); }
  const fp = f.fp, q: ReexParams = { ...REEX_DEFAULT, ...reexP };
  if (fp) { q.sigmaOn = fp.k > 0; q.sigma = fp.k > 0 ? fp.k : 3; q.angleOn = !!fp.nf?.on; q.maxAngleDeg = fp.nf?.angleDeg ?? 30; q.inset = fp.inset ?? 0;
    if (fp.zoneSrc === 'geom') { q.margin = -(fp.inset ?? 0); q.inset = 0; if ((fp.zoneBand ?? 0) > 0) q.maxDist = fp.zoneBand!; }
    if (fp.fill?.on) { q.fill = true; q.islands = fp.fill.islands !== false; q.excludeRaised = !!fp.fill.exRaised; if (fp.fill.band > 0) q.maxDist = fp.fill.band; } }
  return normReex(q);
}
let cur: ReexParams = { ...REEX_DEFAULT };
const raisedTipText = () => tt('Exclude raised: raised regions inside the outer contour that belong to another feature (boss, sphere, step – surface rising above the search distance with steep walls, a flat top or higher than 2.5 mm) are shown in magenta. OFF (default) = they count to the plane (e.g. flatness incl. bumps and spatter). ON = they are excluded as a whole. ? = documentation with a picture.');
const exclTipText = () => tt('Boundary exclusion distance ± [mm]: positive = the zone shrinks inward by this distance (points near the outer contour and holes are excluded – edge roundings, burrs, chamfer starts); negative = the zone grows outward by this distance. 0 = exactly the original contour. The preview (zone + points) updates immediately.');
export function reexHTML(f: RxFeature): string {
  if (f.cons || f.derived || (!f.indices?.length && !f.src?.length && !f.anchor?.pts?.length) || !REEX_TYPES.includes(f.type) || !f.measured) return '';
  const p = paramsFor(f), plane = f.type === 'Ebene';
  const num = (k: string, v: number | string, ph = '', dis = false) => `<input data-rx="${k}" data-num="abs" value="${v}" placeholder="${ph}" inputmode="decimal" ${dis ? 'disabled' : ''}>`;
  const row = (tip: string, lbl: string, ctl: string, cls = 'row') => `<div class="${cls}" title="${tip}"><label>${lbl}</label>${ctl}</div>`;
  const chk = (k: string, on: boolean | undefined, lbl: string, tip: string, extra = '') => `<div class="row chk" title="${tip}"><label><input type="checkbox" data-rxc="${k}" ${on ? 'checked' : ''}> ${lbl}</label>${extra}</div>`;
  const q = (sec: string, t: string) => `<button type="button" class="help-q" data-doc-sec="${sec}" title="${t}">?</button>`;
  return `<details class="reex" ${rxOpen.get(f.id) ?? !!f.reex ? 'open' : ''}><summary>🔁 ${tt('Extraction (re-extract)')}</summary>
    <p class="note">${tt('Same parameters as in the Creation Panel. The current actual geometry is the start; points are re-collected inside ONE search region around it. Every change updates the preview at once (points + search region); “Apply extraction” overwrites the actual geometry, the initial method stays in the provenance.')}</p>
    ${plane ? chk('fill', p.fill, tt('Use outer contour (All inside boundary)'), tt('Every point inside the outer contour of the current points within ± search distance is taken (bumps, spatter, burrs, craters); openings, walls and edge fillets stay out.')) : ''}
    ${plane && p.fill ? chk('islands', p.islands !== false, tt('Include detected islands'), tt('Include interior regions inside the outer contour that are not part of the current points (bump patches, spatter rings). Off = only the region of the current points.')) : ''}
    ${plane && p.fill ? chk('excludeRaised', p.excludeRaised, '⛰ ' + tt('Exclude raised features'), raisedTipText(), q('fill', tt('All inside boundary & Exclude raised – documentation'))) : ''}
    ${plane ? row(exclTipText(), tt('Boundary exclusion distance ± [mm]'), num('inset', p.inset ?? 0, '0').replace('data-num="abs"', 'data-num="signed"').replace('inputmode="decimal"', 'inputmode="text"') + q('excl', tt('Boundary exclusion distance – documentation'))) : ''}
    ${row(tt('Thickness of the search region normal to the actual geometry: points farther than ± this distance from the surface/curve are not collected. Also the band of “All inside boundary”.'), tt('Search distance ± [mm]'), num('maxDist', p.maxDist))}
    ${row(tt('Normal angle criterion: the surface normal must agree with the geometry normal within this angle (rejects edges, chamfers, adjacent faces). Unchecked = no angle criterion.'), `<input type="checkbox" data-rxc="angleOn" ${p.angleOn !== false ? 'checked' : ''}> ${tt('Max. normal angle [°]')}`, num('maxAngleDeg', p.maxAngleDeg, '', p.angleOn === false))}
    ${row(tt('Outlier removal: points whose deviation from the fitted geometry is larger than n × the standard deviation (RMS) of all deviations are removed – i.e. the points with the largest deviation. Unchecked = nothing is removed.'), `<input type="checkbox" data-rxc="sigmaOn" ${p.sigmaOn !== false ? 'checked' : ''}> ${tt('Exclude outliers beyond [n × RMS]')}`, num('sigma', p.sigma, '', p.sigmaOn === false))}
    <details class="rx-adv" ${advOpen ? 'open' : ''}><summary>${tt('Advanced')}</summary>
      ${row(tt('How far the search zone reaches beyond the original contour / ends of the geometry (sideways, in the surface). Default 0 = the zone follows the original region exactly. A value > 0 grows the zone by a constant distance all around – that is why its corners then become rounded.'), tt('Lateral extension [mm]'), num('margin', p.margin ?? 0, '0'))}
    </details>
    <div class="row chk" title="${tt('Show the extraction zone (transparent body) while this dialog is open. Unchecking hides it for ALL features until you check it again (remembered; also View › Zone and the ⚙ menu).')}"><label><input type="checkbox" data-rxz ${H.showZone() ? 'checked' : ''}> ${tt('Show extraction zone')}</label></div>
    <div class="row rx-trim" title="${tt('Trim the zone yourself: draw a lasso in the 3D view (click the corners, double-click / Enter to finish, Esc to cancel). “Remove inside” cuts the enclosed points away, “Keep inside” keeps only them. Trims are stored with the feature (in the view they were drawn) and apply on every re-extraction/recompute.')}"><label>✂ ${tt('Trim zone')}</label><button type="button" class="btn" data-trim="rm">${tt('Remove inside')}</button><button type="button" class="btn" data-trim="keep">${tt('Keep inside')}</button>${p.trims?.length ? `<span class="sub">${p.trims.length}×</span><button type="button" class="btn" data-trim="undo" title="${tt('Remove the last trim')}">↶</button><button type="button" class="btn" data-trim="clear" title="${tt('Remove all trims')}">🗑</button>` : ''}</div>
    <div class="rx-live note" id="rx-live">${tt('Change a value and press Enter (or leave the field) – the preview (zone + points) updates immediately. Nothing is changed until “Apply extraction”.')}</div>
    <div class="row"><button class="btn primary" id="rx-run" title="${tt('Runs the extraction with the values shown and overwrites the actual geometry; every click uses the current values again.')}">✓ ${tt('Apply extraction')}</button></div></details>`;
}
let liveT = 0, liveSeq = 0, pendingLive = false;
const keyOf = (p: ReexParams) => JSON.stringify(p);
function live(f: RxFeature, d: HTMLElement) {
  window.clearTimeout(liveT); H.flash('#dialog-pane', true);
  liveT = window.setTimeout(async () => {
    const seq = ++liveSeq, p = { ...cur }, key = keyOf(p) + (f.fp?.crit ?? '');
    try {
      const out = await H.call({ op: 'reex', fit: f.measured, indices: f.indices, params: p, seedPts: f.anchor?.pts ?? [], crit: f.fp?.crit ?? 'lsq' });
      if (seq !== liveSeq) return;
      reexPrev = { id: f.id, R: out.region, idx: out.indices, out, key };
      const el = d.querySelector('#rx-live');
      if (el) el.innerHTML = `<b>${tt('Preview')}</b>: ${out.indices.length} ${tt('pts')} (${tt('now')} ${f.indices.length}) · RMS ${H.fmt(out.fit.rms, 4)} · ${f.type === 'Ebene' ? `${tt('Flatness')} ${H.fmt(out.fit.form, 4)} · ` : ''}${p.sigmaOn !== false && p.sigma > 0 ? tt('{0} outliers removed', out.removedSigma) : tt('no outlier removal')} — ${tt('not applied yet')}`;
      H.renderScene(); H.flash('#dialog-pane');
    } catch (e: any) { if (seq !== liveSeq) return; reexPrev = null; const el = d.querySelector('#rx-live'); if (el) el.innerHTML = `⚠ ${tt(e.message)}`; H.renderScene(); H.flash('#dialog-pane'); }
  }, 300);
}
export function bindReex(d: HTMLElement, f: RxFeature) {
  cur = paramsFor(f); if (drafts.has(f.id) || f.reex) drafts.set(f.id, cur);
  const draft = () => drafts.set(f.id, cur);
  // ONE outlier filter: the n × RMS outlier removal here is the feature's filter (also used by a refit)
  const sync = () => { if (f.fp) f.fp.k = cur.sigmaOn !== false && cur.sigma > 0 ? cur.sigma : 0; };
  d.querySelector<HTMLDetailsElement>('details.rx-adv')?.addEventListener('toggle', (e) => { advOpen = (e.target as HTMLDetailsElement).open; });
  const det = d.querySelector<HTMLDetailsElement>('details.reex');
  if (det) det.addEventListener('toggle', () => { rxOpen.set(f.id, det.open); if (det.open) { draft(); live(f, d); } else { reexPrev = null; drafts.delete(f.id); H.renderScene(); } });
  if (det?.open && reexPrev?.id !== f.id) live(f, d);
  d.querySelectorAll<HTMLInputElement>('[data-rx]').forEach((i) => (i.onchange = () => {
    const k = i.dataset.rx!, v = parseNum(i.value);
    if ((k === 'margin' || k === 'inset') && v == null) { (cur as any)[k] = 0; (reexP as any)[k] = 0; i.value = '0'; }
    else if (v != null && isFinite(v) && (v >= 0 || k === 'inset')) { (cur as any)[k] = v; (reexP as any)[k] = v; } else { i.value = String((cur as any)[k] ?? ''); return; }
    draft(); sync(); live(f, d);
  }));
  // Enter = update the preview at once (zone + points); the extraction itself only runs with “Apply extraction”
  d.querySelectorAll<HTMLInputElement>('[data-rx]').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation(); i.onchange?.(new Event('change')); }));
  d.querySelectorAll<HTMLInputElement>('[data-rxc]').forEach((i) => (i.onchange = () => {
    const k = i.dataset.rxc!; (cur as any)[k] = i.checked; (reexP as any)[k] = i.checked; draft(); sync();
    if (k === 'angleOn' || k === 'sigmaOn') { const n = d.querySelector<HTMLInputElement>(`[data-rx="${k === 'angleOn' ? 'maxAngleDeg' : 'sigma'}"]`); if (n) n.disabled = !i.checked; }
    if (k === 'fill') {
      if (i.checked && cur.sigmaOn !== false) { cur.sigmaOn = reexP.sigmaOn = false; const s = d.querySelector<HTMLInputElement>('[data-rxc="sigmaOn"]'); if (s) s.checked = false; const n = d.querySelector<HTMLInputElement>('[data-rx="sigma"]'); if (n) n.disabled = true; }
      // show / hide the contour-only options (re-render the section from the draft, keep it open)
      pendingLive = true; H.renderAll(); return;
    }
    live(f, d);
  }));
  if (pendingLive) { pendingLive = false; live(f, d); }
  d.querySelector<HTMLInputElement>('[data-rxz]')?.addEventListener('change', (e) => H.setShowZone((e.target as HTMLInputElement).checked));
  d.querySelectorAll<HTMLButtonElement>('[data-trim]').forEach((b) => (b.onclick = async () => {
    const k = b.dataset.trim!, T = [...(cur.trims ?? [])];
    if (k === 'undo') T.pop(); else if (k === 'clear') T.length = 0;
    else { const l = await H.lasso(); if (!l) return; T.push({ ...l, keep: k === 'keep' }); }
    cur.trims = T; drafts.set(f.id, cur); pendingLive = true; H.renderAll();
  }));
  d.querySelector('#rx-run')?.addEventListener('click', () => runReextract(f));
}
async function runReextract(f: RxFeature) {
  if (!f.measured) return;
  try {
    const before = f.indices.length, p = { ...cur }, key = keyOf(p) + (f.fp?.crit ?? '');
    const r = reexPrev && reexPrev.id === f.id && reexPrev.key === key ? reexPrev.out : await H.call({ op: 'reex', fit: f.measured, indices: f.indices, params: p, seedPts: f.anchor?.pts ?? [], crit: f.fp?.crit ?? 'lsq', formBy: true });
    f.measured = { ...r.fit, type: f.type }; f.indices = r.indices; f.src = r.indices; f.pointCount = r.indices.length; f.dev = undefined; f.hit = undefined; H.invalidate(f.id);
    const { fillBand: _fb, ...cp } = p; void _fb; f.reex = { ...cp, points: r.indices.length, removed: r.removedSigma, before }; reexPrev = null; drafts.delete(f.id);
    H.recompute(); H.renderAll(); H.autosave();
    H.toast(tt('{0}: re-extracted {1} points ({2} outliers removed, {3} iterations)', f.name, r.indices.length, r.removedSigma, r.iterations));
  } catch (e: any) { H.toast(tt('Re-extraction failed: {0}', tt(e.message))); }
}
