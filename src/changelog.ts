// Version (git revision + build date, injected by Vite) and the "What's new" dialog shown once after each deploy.
import { t } from './i18n';
declare const __BUILD__: { version: string; rev: string; date: string } | undefined;
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { version: 'dev', rev: 'dev', date: new Date().toISOString().slice(0, 10) };
/** Semantic version YEAR.MAJOR.DEPLOY (package.json; deploy.sh bumps the last number). */
export const versionText = () => `${t('Version')} ${BUILD.version} · ${BUILD.date}`;
/** Newest first. Keep entries short; shown after a deploy and under Help › What's new. */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  { version: '2026.0.10', date: '2026-10-15', items: [
    'Analyze › Axis analysis: cylinder/cone axis vs. the nominal axis from the datum (perpendicularity, parallelism, position, coaxiality): exaggerated tilt, section centres, tolerance cylinder and zone envelope.',
    'Re-extraction of features (max. distance, n·σ filter, normal angle, margin) with provenance in the dialog; right-click › Re-extract.',
    'Trimmed geometry: planes, cylinders, spheres, cones shown over their selected points with contour (View › Trimmed).',
    'Coordinate systems: “Constrained DOF” checkboxes per step. Line: local band aux plane. Start ribbon: split buttons with the method menu.',
  ] },
  { version: '2026.0.9', date: '2026-10-15', items: [
    'New default demo model: form deviation demo (loads on first start). Sample gallery: form deviation demo and shaft/flange.',
    'Feature dialog shows the provenance (method, seed point, extraction parameters, aux plane, anchor points). Anchor circle from exactly 3 points.',
  ] },
  { version: '2026.0.8', date: '2026-10-15', items: [
    'Options moved into the Home tab; new Help › Documentation with workflows and demo-part images.',
    'Auto-detect: clicks on a rim between a face and a hole wall segment the neighbourhood into plane + cylinder (fewer misdetections).',
    'Circle/slot: auxiliary plane “Local ring” (annulus / stadium band with gap and width) besides the full plane. Plane: several seed regions merged into one plane.',
    'Analyze: color scale centred on the form-zone mid (ISO 1101), automatic range zone/2 or t/2, custom centre/range/classes, thick color-coded arrows, form-zone surfaces, explanations.',
    'Cut polyline: close the polygon on the first point (snap highlight), by right-click or ✓; then choose the side.',
    'New Start ribbon after Home: Features, Coordinate Systems and Mesh editing in one ribbon. One feature list (incl. Distance, Angle, Bolt circle); method buttons in the dialog: From polygon model | Construction | Anchor | From CAD reference (later).',
    'Anchor: create point/line/plane/circle/sphere/cylinder/cone from the minimum number of clicked points; distance between two clicked points. Line through two centers (circle, slot …), angle between lines, planes, axes and slots.',
    'Coordinate systems: named “Coordinate System” consistently; auto-filled origin entries are marked “auto: reason”, never overwrite your choice, with a help section explaining the 3-2-1 logic.',
    'Action Bar is the name of the strip at the bottom of the 3D view; ☰ panels menu in the 3D view restores closed panels; more tooltips.',
  ] },
  { version: '2026.0.7', date: '2026-10-15', items: [
    'Constructed features (31 constructions): points (intersections, closest point, centers, cone apex, projections, midpoint, centroid), lines/axes, planes (best-fit, 3 points, offset, mid-plane, tangent …), circles (sections, best-fit, projection), cylinder, best-fit sphere, bolt-circle pattern with pitch deviation, angle.',
    'Create dialogs: method choice “From polygon model” or “Construction”; inputs picked in the 3D view or tree; chain icon 🔗; automatic recompute when a parent changes.',
  ] },
  { version: '2026.0.6', date: '2026-10-15', items: [
    'Coordinate Systems ribbon: 3-2-1 coordinate systems (primary, secondary, origin), tree group, one active system, lower-right indicator, triads; recomputed when features change; coordinates are output in the active system.',
    'Version numbers: YEAR.0.N, shown in Help and What\'s new.',
  ] },
  { version: '2026.0.5', date: '2026-10-15', items: [
    'English user interface (all texts centralised for later translations).',
    'One Action Bar (bottom of the 3D view) for every tool and preview: mode controls, statistics and ↶ ↷ ✕ ✓.',
    'Dialog shows the selected object (tree or 3D pick); panels can be closed and resized.',
    'Tree groups collapsible with visibility per group; geometry and annotation visibility per feature and for all.',
    'Analyze ribbon: deviation color map, whiskers with exaggeration, transparent model.',
    'Distances: pick two features, choose 3D/X/Y/Z, drag the dimension; value in an annotation.',
    'New feature: Line (edge between two faces, choose the auxiliary plane).',
    'Form and orientation controls use a single tolerance zone 0…t.',
    'Reverse-engineering tools moved to their own ribbon (work in progress / paused).',
    'Right-click menu (properties, color, center view, analyze, visibility); view options for feature colors and annotations.',
  ] },
  { version: '2026.0.4', date: '2026-10-15', items: ['CAD export keeps the face orientation (STEP and IGES).', 'Progress indicator for all long operations.', 'Much faster, parallel triangle reduction; max. edge length and min. angle.'] },
];
const KEY = 'mw-seen-rev';
export function showWhatsNew() {
  const el = document.createElement('div'); el.id = 'whatsnew';
  el.innerHTML = `<div class="wn-box"><h3>${t("What's new")}</h3><p class="note">${versionText()}</p>
    ${CHANGELOG.map((c) => `<h4>${c.version} <span class="sub">· ${c.date}</span></h4><ul>${c.items.map((i) => `<li>${t(i)}</li>`).join('')}</ul>`).join('')}
    <div class="row"><button class="btn primary" data-ok>${t('OK')}</button></div></div>`;
  el.querySelector<HTMLButtonElement>('[data-ok]')!.onclick = () => el.remove();
  el.addEventListener('pointerdown', (e) => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
}
/** Show the changelog once per new revision (only for returning users). */
export function maybeShowWhatsNew() {
  try {
    const seen = localStorage.getItem(KEY);
    // returning user = stored revision differs, or app data from an earlier version without the key
    const returning = seen ? seen !== BUILD.version : Object.keys(localStorage).some((k) => k.startsWith('mw-') && k !== KEY);
    localStorage.setItem(KEY, BUILD.version);
    if (returning && BUILD.version !== 'dev') showWhatsNew();
  } catch { /* ignore */ }
}
