// Central UI strings. All user-visible text goes through t() (gettext style: the English source text is the key),
// so a translation catalog can be added later without touching the UI code. `npm run i18n` lists every key (scripts/i18n-extract.mjs).
import type { GeomType } from './core/fit';
type Catalog = Record<string, string>;
const CATALOGS: Record<string, Catalog> = { en: {} };
let lang = 'en';
export const setLang = (l: string, cat?: Catalog) => { if (cat) CATALOGS[l] = cat; lang = l; };
export const getLang = () => lang;
/** Translate; {0}, {1} … are replaced by the arguments. */
export function t(s: string, ...a: (string | number)[]): string {
  const x = CATALOGS[lang]?.[s] ?? s;
  return a.length ? x.replace(/\{(\d+)\}/g, (_, i) => String(a[+i] ?? '')) : x;
}
/** Display names of the internal feature types (internal keys stay stable for project files). */
const TYPE: Record<string, string> = {
  auto: 'Auto', Ebene: 'Plane', Kreis: 'Circle', Zylinder: 'Cylinder', Langloch: 'Slot', Kegel: 'Cone', Kugel: 'Sphere', Torus: 'Torus',
  Punkt: 'Point', Linie: 'Line', Linienzug: 'Polyline', Freiformfläche: 'Freeform surface', Abstand: 'Distance', Winkel: 'Angle',
};
export const typeName = (x: GeomType | 'auto' | string) => t(TYPE[x] ?? x);
/** Display names of the internal control kinds. */
const KIND: Record<string, string> = {
  Durchmesser: 'Diameter', Radius: 'Radius', X: 'Position X', Y: 'Position Y', Z: 'Position Z', Länge: 'Length', Breite: 'Width', Kegelwinkel: 'Cone angle',
  Form: 'Form', 'Winkel X': 'Angle to X axis', 'Winkel Y': 'Angle to Y axis', 'Winkel Z': 'Angle to Z axis', 'Std.-Abw.': 'Standard deviation',
  Rohrdurchmesser: 'Tube Ø (2r)', Rohrradius: 'Tube radius r', 'Abstand 3D': 'Distance 3D', 'Abstand X': 'Distance X', 'Abstand Y': 'Distance Y', 'Abstand Z': 'Distance Z',
  Parallelität: 'Parallelism', Rechtwinkligkeit: 'Perpendicularity', Neigung: 'Angularity', Position: 'Position', Koaxialität: 'Coaxiality', Konzentrizität: 'Concentricity',
  Symmetrie: 'Symmetry', Rundlauf: 'Circular run-out', Gesamtrundlauf: 'Total run-out', 'Profil (Bezug)': 'Surface profile with datum', Geradheit: 'Straightness', 'Geradheit Achse': 'Straightness of axis', Winkelwert: 'Angle', Teilung: 'Pitch deviation',
};
export const kindName = (k: string) => t(KIND[k] ?? k);
/** Method names (internal keys 'Klick' | 'Pinsel' | 'Konstruiert'). */
const METHOD: Record<string, string> = { Klick: 'Click & grow', Pinsel: 'Brush', Konstruiert: 'Construction', Anker: 'Anchor', Abgeleitet: 'Derived from Analyze', 'aus CAD': 'From CAD', 'aus Soll': 'From nominal' };
export const methodName = (m: string) => t(METHOD[m] ?? m);
