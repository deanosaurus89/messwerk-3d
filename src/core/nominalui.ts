// Feature Builder labels, CAD nominal create policy, and orientation (2026.0.46).
// User-facing words are measured / nominal. Internal roles stay 'ist' / 'soll'.
import type { FitResult } from './fit';
import type { SollState } from './featuremodel';
import { t, typeName } from '../i18n';
import { unit, type Vec3 } from './linalg';

export function roleWord(role: 'soll' | 'ist' | null | undefined): string {
  if (role === 'soll') return t('nominal');
  if (role === 'ist') return t('measured');
  return '';
}

/** English geometry name shown by Smart Detect (plane, circle, cylinder, …). */
export function smartDetectLabel(type: string): string {
  return type ? typeName(type) : '';
}

export function detectBadge(type: string): string {
  if (!type) return '';
  return `<span class="cp-detected" data-detected="${type}">${smartDetectLabel(type)}</span>`;
}

const CURVE = new Set(['Kreis', 'Langloch', 'Linie', 'Linienzug']);
const SURFACE = new Set(['Ebene', 'Zylinder', 'Kegel', 'Kugel', 'Torus', 'Freiformfläche']);

export function featureClass(type: string): 'curve' | 'surface' | 'other' {
  if (CURVE.has(type)) return 'curve';
  if (SURFACE.has(type)) return 'surface';
  return 'other';
}

export function featureClassWord(type: string): string {
  const c = featureClass(type);
  return c === 'curve' ? t('curve') : c === 'surface' ? t('surface') : '';
}

/** CAD / nominal create hides scan-only fit controls. Brush radius may stay. */
export function scanControls(nominal: boolean): { fitCriterion: boolean; normalAngle: boolean; brushRadius: boolean } {
  return nominal
    ? { fitCriterion: false, normalAngle: false, brushRadius: true }
    : { fitCriterion: true, normalAngle: true, brushRadius: true };
}

/** Advanced fields for a nominal create. Fit criterion and the normal angle are absent. */
export function nominalAdvancedControls(brushMm: number): string {
  const pol = scanControls(true);
  const brush = pol.brushRadius
    ? `<label title="${t('Brush radius [mm]')}">r <input id="cp-brush" data-num="abs" type="number" min="0.05" step="0.1" value="${brushMm}" inputmode="decimal"> mm</label>`
    : '';
  const fit = pol.fitCriterion ? `<label>${t('Fit criterion')}</label>` : '';
  const ang = pol.normalAngle ? `<label>${t('Normal angle')}</label>` : '';
  return brush + fit + ang;
}

/** Axis or plane normal stored on the fit and shown as Orientation. */
export function orientationOf(fit: FitResult): Vec3 {
  const d = (fit.type === 'Linie' || fit.type === 'Langloch') && fit.direction ? fit.direction : fit.normal;
  return unit(d);
}

export function orientationText(fit: FitResult, digits = 4): string {
  return orientationOf(fit).map((v) => v.toFixed(digits)).join(' ');
}

/** Nominal component written into the tree when the user confirms a CAD hit. No measured fit yet. */
export function nominalRecord(fit: FitResult, faceId?: number, seed?: Vec3[]): SollState {
  const { residuals: _r, ...rest } = fit;
  void _r;
  return { source: 'cad', fit: rest, method: 'aus CAD', faceId, seed };
}

export function nominalDraft(fit: FitResult, faceId?: number) {
  return { type: fit.type, class: featureClass(fit.type), measured: undefined as undefined, soll: nominalRecord(fit, faceId), orientation: orientationOf(fit) };
}
