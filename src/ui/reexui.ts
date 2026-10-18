// Re-extraction UI (feature dialog section, search-region preview, run). Split out of main.ts; the app passes
// its services in via initReexUI().
import type * as THREE from 'three';
import { t as tt } from '../i18n';
import { REEX_DEFAULT, ReexParams, SearchRegion, buildRegion, reextract } from '../core/reextract';
import type { Feature } from '../core/features';
import type { Vec3 } from '../core/linalg';

type RxFeature = Feature & { indices: Uint32Array; src?: Uint32Array; dev?: Float32Array; hit?: unknown; anchor?: { pts: Vec3[] } };
interface Host { geometry(): THREE.BufferGeometry | undefined; renderAll(): void; toast(t: string): void; invalidate(id: number): void; recompute(): void; autosave(): void }
let H: Host;
export function initReexUI(h: Host) { H = h; }
export const REEX_TYPES = ['Ebene', 'Zylinder', 'Kugel', 'Kegel', 'Kreis', 'Langloch', 'Linie', 'Torus'];
let reexP: ReexParams = { ...REEX_DEFAULT };
/** Search-region preview (transparent body) shown before running the re-extraction. */
let reexPrev: { id: number; R: SearchRegion } | null = null;
/** current preview region for feature ids that still exist */
export const reexPreview = (alive: (id: number) => boolean) => (reexPrev && alive(reexPrev.id) ? reexPrev.R : null);
export function reexHTML(f: RxFeature): string {
  if (f.cons || !REEX_TYPES.includes(f.type) || !f.measured) return '';
  const p = f.reex ? { ...reexP, ...f.reex } : reexP;
  const inp = (k: string, lbl: string, v: number, tip: string) => `<div class="row" title="${tip}"><label>${lbl}</label><input data-rx="${k}" value="${v}" inputmode="decimal"></div>`;
  return `<details class="reex" ${f.reex ? 'open' : ''}><summary>🔁 ${tt('Extraction (re-extract)')}</summary>
    <p class="note">${tt('Uses the current actual geometry as start and re-collects scan points. Overwrites the actual geometry; the initial method stays in the provenance.')}</p>
    ${inp('maxDist', tt('Max. distance [mm]'), p.maxDist, tt('Points farther from the geometry are ignored'))}
    ${inp('sigma', tt('σ filter (n·σ)'), p.sigma, tt('Remove points deviating more than n standard deviations from the mean'))}
    ${inp('maxAngleDeg', tt('Max. normal angle [°]'), p.maxAngleDeg, tt('Surface normal must agree with the geometry normal within this angle'))}
    ${inp('margin', tt('Search margin [mm]'), p.margin, tt('Search region follows the geometry (trimmed contour / shell / band) and is widened at its edges by this margin'))}
    ${f.type === 'Ebene' ? inp('fillBand', tt('All inside boundary: band ± [mm]'), p.fillBand ?? 0, tt('Capture all points inside outer boundary: after re-extraction, take every point inside the outer contour within this band (bumps, spatter, burrs, craters; openings and walls stay out). 0 = off')) : ''}
    <div class="row"><button class="btn" id="rx-show">👁 ${tt('Show search region')}</button><button class="btn primary" id="rx-run">🔁 ${f.reex ? tt('Re-run extraction') : tt('Run extraction')}</button></div></details>`;
}
export function bindReex(d: HTMLElement, f: RxFeature) {
  d.querySelectorAll<HTMLInputElement>('[data-rx]').forEach((i) => (i.onchange = () => { const v = Number(i.value.replace(',', '.')); if (isFinite(v) && v >= 0) (reexP as any)[i.dataset.rx!] = v; }));
  d.querySelector('#rx-show')?.addEventListener('click', () => previewRegion(f));
  d.querySelector('#rx-run')?.addEventListener('click', () => runReextract(f));
}
function previewRegion(f: RxFeature) {
  const g = H.geometry(); if (!g || !f.measured) return;
  try { reexPrev = { id: f.id, R: buildRegion(f.measured, g.getAttribute('position').array as Float32Array, f.indices, reexP, f.anchor?.pts ?? []) }; H.renderAll();
    H.toast(tt('Search region shown (transparent). Check it, then run the extraction.')); }
  catch (e: any) { H.toast(tt('Re-extraction failed: {0}', tt(e.message))); }
}
function runReextract(f: RxFeature) {
  const g = H.geometry(); if (!g || !f.measured) return;
  try {
    const before = f.indices.length;
    const r = reextract(f.measured, g.getAttribute('position').array as Float32Array, (g.getAttribute('normal')?.array as Float32Array) ?? null, f.indices, reexP, f.anchor?.pts ?? []);
    f.measured = { ...r.fit, type: f.type }; f.indices = r.indices; f.src = r.indices; f.pointCount = r.indices.length; f.dev = undefined; f.hit = undefined; H.invalidate(f.id);
    f.reex = { ...reexP, points: r.indices.length, removed: r.removedSigma, before }; reexPrev = null;
    H.recompute(); H.renderAll(); H.autosave();
    H.toast(tt('{0}: re-extracted {1} points ({2} removed by σ filter, {3} iterations)', f.name, r.indices.length, r.removedSigma, r.iterations));
  } catch (e: any) { H.toast(tt('Re-extraction failed: {0}', tt(e.message))); }
}
