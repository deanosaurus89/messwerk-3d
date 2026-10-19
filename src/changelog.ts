import { bindEscClose, bindSwipeClose } from './ui/overlay';
// Version (git revision + build date, injected by Vite) and the "What's new" dialog shown once after each deploy.
import { t } from './i18n';
declare const __BUILD__: { version: string; rev: string; date: string } | undefined;
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { version: 'dev', rev: 'dev', date: new Date().toISOString().slice(0, 10) };
/** Semantic version YEAR.MAJOR.DEPLOY (package.json; deploy.sh bumps the last number). */
export const versionText = () => `${t('Version')} ${BUILD.version} · ${BUILD.date}`;
/** Newest first. Keep entries short; shown after a deploy and under Help › What's new. */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  { version: '2026.0.30', date: '2026-10-19', items: [
    'Feature creation, step 2 – feedback: the preview shows exactly point count, form deviation and standard deviation (sizes and further values after ✓ in the tree and dialog).',
    'Feature creation, step 3 – Create uses the selection as-is: the created feature is a plain fit of ALL selected points (also the aux plane of circles/slots). Outlier removal is no longer applied silently; it is an optional filter under Parameters (off by default). Demo part: form deviations now include the scan noise tails (e.g. top plane 0.044 → 0.071 mm), sizes change by less than 0.001 mm. Existing features keep their values.',
  ] },
  { version: '2026.0.29', date: '2026-10-19', items: [
    'Feature creation, step 1 – selection: the Creation Panel offers 👆 Click & grow | ＋ Add region | 🖌 Brush as the selection method. Add region: every click grows a further region (same intelligence), the union is fitted.',
    'Seed area feedback: the triangles inside the pick circle are highlighted where you click or tap – now also on iPhone (stays with the preview) and including the hole wall next to a plane.',
    'Circle/slot by tapping roughly on the edge: if the tapped face alone does not give wall + aux plane (e.g. a flat facet strip of the hole wall), the extraction restarts from the other side of the edge inside the pick circle – wall points AND aux-plane points, as reliable as Auto.',
    'Feature dialog simpler: re-extraction moved into the collapsed section “⚙ Advanced · Re-extraction”.',
  ] },
  { version: '2026.0.28', date: '2026-10-19', items: [
    'Internal: new feature data model – every feature is a node (name, type, dependencies, datum) with its actual state (Ist: points, fit, aux plane, extraction parameters) underneath; prepared for a nominal state from CAD later. No visible change: all results are identical (checked against 0.27 with 12 features, 19 controls and a coordinate system).',
    'Project files: format version 2. Projects saved with 0.27 or older (and the last autosave) open unchanged and are converted automatically; a project saved with 0.28 cannot be opened by older versions.',
    'Test checklist reorganised by phase: Phase 1 (feature creation) on top with how-to-test steps and expected results, earlier items in a collapsed archive, bug report with severity per item.',
  ] },
  { version: '2026.0.27', date: '2026-10-19', items: [
    'Boundary from “Fitted geometry” (cylinder/cone/sphere/torus) now really is the fitted shape: the created feature keeps all surface points of the zone (demo hole: 6 183 selected → 10 057 of 10 079 wall points) instead of falling back to the selected triangles – also when Auto detection found a circle and the type was switched to Cylinder, and after a refit. Shown as a clean surface with circles at its ends (full 360° for a closed wall, arc for an open one), no polygon outline. The option is also offered in Auto detection before the click; the Dialog shows “Boundary from: Fitted geometry”.',
    'Assigning a datum no longer changes the 3D view: re-rendering the dialog opened the re-extraction section, which started its zone preview (orange points + zone). The section now stays as you left it.',
    'View tab: new section “Annotations” (show/hide all, Reset positions, Point count, Std. dev., Decimals −/+), synced with Options and remembered. Options › Display › Decimal places (default 2): number of decimal places of all displayed values (annotations, panels, tree, status, report and CSV, angles too). Internal values and input fields are not rounded; direction vectors keep at least 5 places.',
    'Options › Tolerances › “Use general tolerance tables (ISO 2768 / ISO 286)” – off by default = tolerances by hand as before 0.24 (no auto-fill, badge, fit field, ribbon group or “Tol. source” column); on = 0.24 behaviour. Project values are kept.',
    'Creation Panel: “Area r” is now “Growth limit r” (region growing stops at this radius around the click; 0 = unlimited) and sits in the collapsible Parameters, which are available before the click too (Auto detection included, with Boundary from). Stale “mouse wheel” hints fixed (Shift+wheel).',
    'Test checklist: shows the real app version, “Test first” section, tolerance tables as an optional section, superseded items marked.',
  ] },
  { version: '2026.0.26', date: '2026-10-19', items: [
    'Help/info overlays on the iPhone: the ✕ is always visible – the "?" help opened during feature creation no longer slides under the ribbon (a jump to a doc section used to scroll the whole layout). Documentation, help, datum info, sample dialog, What\'s new and Properties have a fixed header with a large ✕ and close by ✕, Esc, tapping outside or swiping down. On the phone the help opens as a bottom sheet, so the upper third of the 3D view stays visible.',
  ] },
  { version: '2026.0.25', date: '2026-10-19', items: [
    'No horizontal scrolling in ANY ribbon: on desktop a group that does not fit switches to a compact two-row layout (checked at 1280 and 1400 px – View and Start no longer overflow); on the iPhone every tab wraps into at most two button rows, View gets section chips Views | Display | Panels. All buttons keep their tooltips (feature type buttons got new ones).',
  ] },
  { version: '2026.0.24', date: '2026-10-19', items: [
    'General tolerances (project setting, Controls ribbon): ISO 2768-1 class f/m/c/v for sizes, distances, radii and angles and ISO 2768-2 class H/K/L for flatness/straightness, roundness, perpendicularity, symmetry, parallelism and run-out. Default mK; new controls are filled automatically from the nominal (or actual) size and the feature length.',
    'ISO 286 fits per size control: type e.g. H7 (hole) or g6 (shaft) in the Fit field – Tol+/Tol− follow from the nominal size (IT4–IT12, D…P / d…p, JS/js, up to 500 mm).',
    'Tolerance source shown in Control Properties (badge “ISO 2768-m”, “ISO 286 H7”, “manual”) and as a column in the report/CSV. Typing a tolerance overrides it (manual); ↺ returns to the general tolerance / fit; “Apply to all” refills every non-manual control.',
  ] },
  { version: '2026.0.23', date: '2026-10-19', items: [
    'Global coordinate system in the tree: eye button shows/hides the WCS triad (remembered), right-click › Center on origin; every CS offers triad on/off and Center on origin.',
    'Fix: the extraction zone of a click-grown plane at boundary exclusion 0 now contains exactly the grown points (before it also collected not-grown neighbours on scan meshes – ~27k instead of 14.7k points). All inside boundary (gap filling) is unchanged.',
    'Feature dialog restructured into collapsible sections: Datum on top → ① Point selection → ② Extraction & filters (outlier removal only once) → ③ Fit last.',
    'New fit criteria for all regular features: Minimum zone (Chebyshev), Tangential circumscribed (minimum circumscribed) and Tangential inscribed (maximum inscribed); plane: outer/inner tangent plane. Form per criterion (e.g. roundness LSC/MZC/MCC/MIC) shown in the dialog and Properties; controls, CS, DRF and report follow automatically.',
    'Start ribbon without horizontal scrolling: section chips Features | Coordinate Systems | Mesh editing (remembered); on the iPhone the chips sit on top and the buttons wrap into two rows; short tab label “RE”.',
    'iPhone lasso: the bottom sheets hide while you tap the lasso corners and come back after ✓.',
  ] },
  { version: '2026.0.22', date: '2026-10-19', items: [
    'Central overlay rule: temporary displays belong to the tool/dialog that made them and disappear when you leave it – creation preview, hover sets and pick circle (tool), extraction zone and re-extraction points (feature dialog), colour map/arrows/zones/derive preview (Analyze), DRF triad (selected control). Permanent display only via the View ribbon. Help › “What is shown when”.',
    'Trim zone: in the feature dialog (Extraction) draw a lasso in the 3D view – “Remove inside” or “Keep inside”; trims are stored with the feature and apply on every re-extraction; ↶ undo, 🗑 clear.',
  ] },
  { version: '2026.0.21', date: '2026-10-19', items: [
    'Transparent model now works everywhere (Analyze › Display › Transparent): scan and CAD faces become semi-transparent also without an active analysis; the setting is remembered; clearer tooltips.',
    'Derived features (from Analyze) no longer show empty re-extraction/fit parameter sections; a note explains that they follow their parent automatically.',
    'Axis/position analysis panel redesigned: compact; Hide mesh + Transparent side by side; tolerance zone always drawn; optional 3D value labels for zone (Ø/2 planes + size), envelope Ø, nominal (TED, in the DRF) and deviation; clear zone-shape indicator (Ø cylinder / ∥ 2 planes) instead of the old Ø toggle text; tooltips explain Form bend × and Location offset ×.',
    'Analyze shows only the annotation of the analysed feature. New “Show datum features” (only for controls with datums, default off) shows and highlights the datum features of the control.',
    'Pick radius: in Auto and every Click & grow feature the circle at the cursor (desktop) is the seed area of the region growing – visible from the start; Alt+mouse wheel resizes it (plain wheel zooms, Shift+wheel = analysis area); stepper ◎ r −/＋ in the Creation Panel (phone). For circles/slots it is the window in which the hole-wall/plane transition is searched.',
    'Circle/slot/line: “Aux plane: Auto-detect | Existing plane” in the Creation Panel (also in Auto), pick from the list, 🎯 in the 3D view or the tree; then only the hole wall is clicked.',
    'Properties concept: feature node → Properties = the editable dialog (Start › Properties, double-click in the tree, right-click › Properties…); Actual node → read-only info (points, fit results, statistics) that refreshes after every recompute. Constructed features: change, swap, add or remove source features; dependents recompute.',
  ] },
  { version: '2026.0.20', date: '2026-10-19', items: [
    'Fix: Click & grow on desktop – the mouse wheel changed the analysis area instead of zooming; after a zoom the cursor showed a brush-like circle and growing was limited to it. The wheel now zooms; Shift+wheel changes the analysis area.',
    'Fix: “All inside boundary” via the Creation Panel button now also switches outlier removal off (as the Parameters checkbox does) – before, bumps were dropped again and flatness ignored them.',
    'Desktop navigation pause: press Space in any tool to rotate/pan/zoom freely (indicator “Navigation (Space to resume)”); Space again continues with exactly the same tool, panel and selection. Ignored while typing.',
    'Re-extraction: the zone is exactly the original region by default (lateral extension 0, no hidden margin); Boundary exclusion distance ± (positive shrinks, negative grows the zone); Enter in a field updates the preview at once; button renamed “Apply extraction”.',
    'Extraction zone is only shown while the feature dialog / Creation Panel is open; “Show extraction zone” (dialog checkbox, View › Zone, ⚙ menu) is a remembered global preference.',
    'Cylinder, cone, sphere: “＋ Add region” (union of several clicked regions) and Parameters › “Boundary from: Point selection / Fitted geometry” – a zone around the fitted shape collects all points of the surface; Boundary exclusion distance ± shortens/extends it.',
    'Datum controls: new controls start with only the Primary slot (required, no automatic prefill); Secondary appears after Primary, Tertiary after Secondary.',
    'Coordinate system creation: three slots Primary / Secondary / Tertiary, each with a geometry and an Axis (±X/±Y/±Z); smart defaults (primary plane normal → +Z out of the material, secondary → X, tertiary → remaining axis); the triad follows each step; Flip and Rotate 90° buttons; origin/offsets under Advanced.',
  ] },
  { version: '2026.0.19', date: '2026-10-18', items: [
    'Re-extraction: ONE search region instead of three distances – “Search distance ± [mm]” (thickness normal to the geometry, also the band of All inside boundary, now a checkbox) and, under Advanced, “Lateral extension [mm]” (beyond the actual contour; empty = automatic). Old projects are migrated. Creation Panel uses the same term.',
    '“Show search region” draws a closed body: plane → prism with side faces along the contour, cylinder/cone → shell with end rings, circle/slot → closed ring body, line → closed tube, sphere/torus → shell.',
    '“σ filter (n·σ)” renamed to “Exclude outliers beyond [n × RMS]” (0 = off, keep all points); tooltip explains that the points with the largest deviation are removed.',
    'iPhone keypad without minus: numeric fields now accept “,” and “.”; fields that may be negative (TEDs, nominal, Tol+, Tol−, CS offsets, construction parameters) get a ± button that flips the sign; magnitude fields (± bands, search distance, zone tolerances, radii) drop a typed sign. Tol−: a plain number is the minus deviation, ± makes it “+”.',
    '“Exclude raised” has a clear tooltip and a “?” that opens the new documentation section “All inside boundary & Exclude raised” with an explanatory picture; Re-extraction offers Exclude raised too. Fit parameters use the same terms (Search distance ±, Exclude outliers beyond n × RMS).',
    'Actual geometry info (type, method, points, RMS, flatness, max ±, XYZ, IJK, aux plane) moved out of the Dialog into ⓘ Properties… (right-click / long-press in the tree, or the link in the Dialog). The Dialog keeps extraction and fit parameters.',
    'Fix (high priority): “All inside boundary” on plates with edge fillets / side walls – the outer contour is now the boundary of the grown region itself (interior holes/islands filled), never beyond it; near the outer edge points with strongly deviating normals are rejected. Walls and fillets no longer enter the plane (before e.g. flatness 3.049 instead of ~0.1).',
    'Search distance default for All inside boundary is automatic: 3 × RMS of the region-grown fit, at least 0.1 mm (field empty = “auto …”), instead of 2 mm.',
    'Unified extraction parameters – identical in the Creation Panel (new collapsible “Parameters” section, compact on phones) and in the Re-extraction (Dialog): Use outer contour, Include detected islands, Boundary exclusion distance [mm], Search distance ± (lateral extension under Advanced), Normal angle (checkbox + value), Outlier removal (checkbox + n × std. dev. – unchecked = nothing removed). New docs section with picture.',
    'Live preview: every parameter change updates the preview (points, contour, search region) immediately in the background, confirmed by a short “updated” badge. Re-extraction shows points/RMS/flatness before applying; “Apply re-extraction” only commits.',
    'Phone layout: the Dialog is a compact bottom panel (max ~45 % height) so the 3D view stays visible above it; on desktop it stays beside the 3D view.',
  ] },
  { version: '2026.0.18', date: '2026-10-18', items: [
    'Tester checklist page: Help › ☑ Test checklist (also linked at the top of the documentation) opens test.html – status per item, comments, copy the result; works in iPhone Safari.',
  ] },
  { version: '2026.0.17', date: '2026-10-18', items: [
    'Fix: TED suggestions are computed in the same datum frame as the evaluation (contact datums). Before, they came from the least-squares datums, so an accepted suggestion could show a position error (e.g. 1.966 NOK) instead of ~0. If you confirmed (✓) suggestions in 0.16, clear those fields once to get the corrected suggestion.',
    'TED fields are labelled by drawing meaning (“from B”, “from C”); the tooltip shows the DRF axis and its direction in the display CS, and a DRF triad is drawn while the control is selected.',
    'Fix: “All inside boundary” keeps interior islands (spatter rings around holes, bump patches, strips next to slots). Band 2 mm plus the tips of taller bumps; the outer contour is drawn as a bold blue line; raised features (boss, sphere, pad) show in magenta and stay in unless you choose ⛰ Exclude raised.',
    'Circle / slot / line: Creation Panel now has ▱ Full plane | ◎ Local ring (with gap/width) for the aux plane, plus ⬚ All inside boundary for the full aux plane – live preview.',
    'Ⓜ/Ⓛ bonus made explicit: “tol 0.100 + bonus 0.030 = 0.130” in table, Control Properties, annotation and Analyze; per-hole table shows the mating size; tooltip explains hole/shaft, mating size vs Gauss Ø, MMC/LMC and why there is no bonus; bonus capped at the size tolerance range. Fix: a pattern on a bolt circle was shown as a single circle position.',
    'Position on a circle (or slot): only the fitted centre counts; the zone is a cylinder Øt perpendicular to the circle’s auxiliary plane at the TED point (as in PolyWorks); value = 2 × centre offset. New Analyze view “Circle position”: nominal point, actual centre, zone cylinder, offset arrow with value, Location × exaggeration, DRF triad.',
    'Annotations: a dragged annotation stays pinned (🔒); tap the 🔒 to unpin. View › ↺ Reset positions (also in the ⚙ menu): selected or all.',
    'Phones: nav cube, ⚙ menu and CS indicator stay visible above an open Control Properties panel.',
    'The 0.16 preview features are finished and verified on desktop and iPhone:',
    'Ⓜ/Ⓛ and patterns: per-hole table (Ø, t + bonus, permitted, margin) in Control Properties and the analysis panel; ▶ marks the hole with the smallest margin, which decides OK/NOK.',
    'Pattern position in the axis view: each hole is shown against its own nominal axis (after the best fit of the pattern) with its permitted zone; the label names the hole (k of n), bonus and margin.',
    'Datum slots (primary → secondary → tertiary, with Ⓜ/Ⓛ) also in the analysis panel – changes recompute immediately.',
    'Analyze closes an open construction mode without preview (the analysis panel was hidden behind it).',
  ] },
  { version: '2026.0.16', date: '2026-10-18', items: [
    'TEDs: the actual value is pre-filled as a suggestion (grey, italic) – computed but flagged “Nominal unconfirmed” until you tick ✓ (or ✓ all) or type the drawing value. Also for θ/φ and the angularity angle.',
    'TED fields follow the situation: only coordinates ⟂ to the axis that the datums lock are required; along the axis not shown; free directions greyed as not applicable – each with a tooltip why.',
    'Datum reference frame as slots: primary → secondary → tertiary dropdowns of the defined datums (no more typing A|B|C).',
    'Creation Panel (Action Bar while creating a feature): assign a datum label directly.',
    'Planes: “All inside boundary” – region growing gives the outer contour, then all points inside it within a band are used (bumps, spatter, burrs, craters for flatness); openings and walls stay out. Also in the Feature dialog and Re-extraction.',
    'Axis view: ▭ Zones and ◎ Envelope toggles; the envelope (minimum-zone cylinder around the median line) is drawn in purple.',
    'Analyze hides annotations of unrelated features (🏷 Show other annotations); restored on exit.',
    'Help/docs overlay: big ✕, tap outside or Esc closes it (iPhone).',
    'Also included (preview of the next release, still being polished): bolt-circle pattern position (CZ/SZ), pattern as datum, free datum DOF, Ⓜ/Ⓛ bonus and datum shift, Polyline feature and Derive feature from Analyze, Hide mesh in the axis view.',
  ] },
  { version: '2026.0.15', date: '2026-10-18', items: [
    'Datums per ISO 5459: tangent plane (minimax, outside the material), maximum inscribed cylinder for holes, minimum circumscribed for shafts; secondary/tertiary constrained to the previous datums; 3σ spike filter for scan data. Controls › Datum simulation (ISO 5459 / least squares) and Datum info. Note: values of existing projects can change.',
    'Oblique nominal directions: Position accepts TED angles θ (from Z) and φ (about Z) in the datum system – no snapping to the nearest axis.',
    'Orientation zone shape: Ø button per control for axes (cylinder zone) vs. two parallel planes; sensible defaults per case.',
    'Axis view: median line coloured by its deviation (0 … t/2) with a colour bar in the legend.',
  ] },
  { version: '2026.0.14', date: '2026-10-18', items: [
    'Axis analysis: the median line is drawn at its true location; only its bend is exaggerated (Form ×). Nominal axis and tolerance zone are drawn separately; the position offset is a labelled arrow; optional Location × is always labelled.',
    'TED (basic dimensions) are no longer prefilled: fields are empty and required, the control shows “Nominal missing” until they are entered. “Use actual as nominal” is in the ⋯ menu.',
    'Analyze per control: tree right-click › Analyze (one entry per control), Analyze › Per control picker, ◐ button and right-click in the Controls list. One control at a time; tolerance and TED editable live in the Action Bar.',
    'New control “Straightness of axis” (cylinder/cone) with minimum-zone evaluation (zone may tilt). Perpendicularity, parallelism, angularity and coaxiality of axes now use the derived median line in the table too – same values as the axis view.',
  ] },
  { version: '2026.0.13', date: '2026-10-16', items: [
    'Docs: new pages “Derived median line” and “Datum reference frame (A|B|C) and position” with illustrations.',
  ] },
  { version: '2026.0.12', date: '2026-10-16', items: [
    'New sample: CAD surface model (IGES, 138 faces) – opens directly in CAD trimming.',
    'CAD trimming fixes: right-click no longer adds an extra point before closing the polygon; double-click/tap no longer creates duplicate points; Enter closes the polygon like ✓; boundary offset faster on faces with many edges (no corner spheres at smooth joints).',
    'Control table: Position of cylinders/cones is now evaluated on the derived median line (section centres) instead of the axis end points.',
  ] },
  { version: '2026.0.11', date: '2026-10-15', items: [
    'Re-extraction: the search region now follows the geometry (prism over a plane’s contour, shell for cylinder/cone/sphere/torus, band for circle/slot, tube for line) and can be shown as a transparent body before running.',
    'Axis analysis: derived median line (sections ⟂ fitted axis), floating zone for orientation, position against the full datum reference frame incl. basic dimensions, median-line straightness; side view by default.',
    'Trimmed display for circles, slots and lines (only the covered arc/segment) and tori.',
    'Coordinate systems: steps can be filled in any order. Deleting a feature removes what is computed from it (provenance); aux-plane references are kept.',
  ] },
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
  el.innerHTML = `<div class="wn-box" role="dialog"><div class="ov-top"><h3>${t("What's new")}</h3><button class="ov-x" data-x title="${t('Close')}">✕</button></div><p class="note">${versionText()}</p>
    ${CHANGELOG.map((c) => `<h4>${c.version} <span class="sub">· ${c.date}</span></h4><ul>${c.items.map((i) => `<li>${t(i)}</li>`).join('')}</ul>`).join('')}
    <div class="row"><button class="btn primary" data-ok>${t('OK')}</button></div></div>`;
  const close = () => el.remove();
  el.querySelectorAll<HTMLButtonElement>('[data-ok], [data-x]').forEach((b) => (b.onclick = close));
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  bindEscClose(el, close); bindSwipeClose(el.querySelector('.wn-box')!, close, el.querySelector('.wn-box'));
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
