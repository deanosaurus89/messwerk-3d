// Bericht ("Tabelle erzeugen"): eingefrorene Momentaufnahme aller Merkmale und Prüfmerkmale.
import { Control, Feature, FORM_NAME, DEG, controlLabel, evaluate, datumText, EvalCtx } from './features';

export interface ReportFeatureRow { name: string; type: string; x: number; y: number; z: number; i: number; j: number; k: number;
  size: string; form: number | null; formName: string; rms: number | null; points: number; aux: string; }
export interface ReportControlRow { feature: string; control: string; nominal: number | null; measured: number | null; deviation: number | null;
  tolUp: number; tolLo: number; status: string; }
export interface Report { id: number; name: string; created: string; source: string; features: ReportFeatureRow[]; controls: ReportControlRow[]; io: number; nio: number; }

const f4 = (v: number | null | undefined, d = 4) => (v == null || !isFinite(v) ? '' : v.toFixed(d));

export function sizeText(f: Feature): string {
  const m = f.measured!;
  switch (f.type) {
    case 'Kreis': case 'Zylinder': case 'Kugel': return `⌀ ${f4(m.diameter)}`;
    case 'Kegel': return `∢ ${f4(2 * m.halfAngle! * DEG, 3)}° / ⌀ ${f4(m.diameter)}`;
    case 'Langloch': return `${f4(m.length)} × ${f4(m.width)}`;
    case 'Torus': return `⌀ ${f4(m.diameter)} / Rohr ⌀ ${f4(2 * m.minorRadius!)}`;
    case 'Abstand': return `${f4(m.distance)}`;
    default: return '';
  }
}

export function buildReport(id: number, features: Feature[], controls: Control[], source: string, now = new Date(), ctx: EvalCtx = {}): Report {
  const fm = new Map(features.map((f) => [f.id, f]));
  const frows: ReportFeatureRow[] = features.map((f) => {
    const m = f.measured!;
    const isD = f.type === 'Abstand';
    return { name: f.name + (f.datum ? ` [${f.datum}]` : ''), type: f.type, x: m.center[0], y: m.center[1], z: m.center[2], i: m.normal[0], j: m.normal[1], k: m.normal[2],
      size: sizeText(f), form: isD ? null : m.form, formName: isD ? '' : FORM_NAME[f.type], rms: isD ? null : m.rms, points: f.pointCount,
      aux: f.aux ? `Hilfsebene (${f.aux.source}, Ebenheit ${f4(f.aux.plane.form)})` : '' };
  });
  let io = 0, nio = 0;
  const crows: ReportControlRow[] = controls.map((c) => {
    const f = fm.get(c.featureIds[0]); const r = evaluate(c, fm, ctx);
    if (r.status === 'IO') io++; if (r.status === 'NIO') nio++;
    const dt = datumText(c, fm);
    return { feature: f?.name ?? '?', control: controlLabel(c, f) + (dt ? ` |${dt}|` : '') + (r.flag ? ` ⚠ ${r.flag}` : ''), nominal: c.nominal, measured: r.measured, deviation: r.deviation, tolUp: c.tolUp, tolLo: c.tolLo, status: r.status };
  });
  return { id, name: `Tabelle ${id}`, created: now.toLocaleString('de-DE'), source, features: frows, controls: crows, io, nio };
}

const csvCell = (v: string | number | null) => (typeof v === 'number' ? f4(v).replace('.', ',') : (v ?? '')).toString().replace(/;/g, ',');

export function reportCSV(r: Report): string {
  const L: (string | number | null)[][] = [
    [r.name], ['Erstellt', r.created], ['Datei', r.source], [],
    ['Merkmale'], ['Name', 'Typ', 'X', 'Y', 'Z', 'I', 'J', 'K', 'Maß', 'Form', 'Formwert', 'RMS', 'Punkte', 'Hilfsebene'],
    ...r.features.map((f) => [f.name, f.type, f.x, f.y, f.z, f.i, f.j, f.k, f.size, f.formName, f.form, f.rms, f.points, f.aux]),
    [], ['Prüfmerkmale', `${r.io} IO`, `${r.nio} NIO`],
    ['Merkmal', 'Prüfmerkmal', 'Soll', 'Ist', 'Abweichung', 'Tol +', 'Tol -', 'Status'],
    ...r.controls.map((c) => [c.feature, c.control, c.nominal, c.measured, c.deviation, c.tolUp, c.tolLo, c.status]),
  ];
  return '\ufeff' + L.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function reportTablesHTML(r: Report): string {
  const n = (v: number | null, d = 4) => (v == null ? '—' : v.toFixed(d));
  return `<h2>${esc(r.name)}</h2><p class="meta">Erstellt: ${esc(r.created)} · Datei: ${esc(r.source)} · ${r.features.length} Merkmale · ${r.controls.length} Prüfmerkmale
    (<span class="io">${r.io} IO</span>, <span class="nio">${r.nio} NIO</span>)</p>
  <h3>Merkmale</h3><table><thead><tr><th>Name</th><th>Typ</th><th>X</th><th>Y</th><th>Z</th><th>Maß</th><th>Form</th><th>RMS</th><th>Punkte</th></tr></thead><tbody>
  ${r.features.map((f) => `<tr><td>${esc(f.name)}${f.aux ? `<div class="aux">${esc(f.aux)}</div>` : ''}</td><td>${f.type}</td><td class="n">${n(f.x, 3)}</td><td class="n">${n(f.y, 3)}</td><td class="n">${n(f.z, 3)}</td>
    <td class="n">${esc(f.size)}</td><td class="n">${f.form == null ? '' : `${f.formName} ${n(f.form)}`}</td><td class="n">${n(f.rms)}</td><td class="n">${f.points}</td></tr>`).join('')}
  </tbody></table>
  <h3>Prüfmerkmale</h3><table><thead><tr><th>Merkmal</th><th>Prüfmerkmal</th><th>Soll</th><th>Ist</th><th>Abw.</th><th>Tol +</th><th>Tol −</th><th>Status</th></tr></thead><tbody>
  ${r.controls.length ? r.controls.map((c) => `<tr><td>${esc(c.feature)}</td><td>${esc(c.control)}</td><td class="n">${n(c.nominal)}</td><td class="n">${n(c.measured)}</td>
    <td class="n ${c.status}">${n(c.deviation)}</td><td class="n">${n(c.tolUp)}</td><td class="n">${n(c.tolLo)}</td><td><span class="st ${c.status === '—' ? 'none' : c.status}">${c.status}</span></td></tr>`).join('')
    : '<tr><td colspan="8">Keine Prüfmerkmale gewählt.</td></tr>'}
  </tbody></table>`;
}

export function reportHTML(r: Report): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(r.name)} – MessWerk 3D</title><style>
  body{font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;color:#1d2833;margin:18px}
  h2{margin:0 0 4px}h3{margin:16px 0 6px}.meta{color:#55626f}table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #c9d0d8;padding:3px 6px;text-align:left}th{background:#eef2f6}td.n{text-align:right;font-variant-numeric:tabular-nums}
  .io{color:#1a9b3c}.nio{color:#d32f2f}td.IO{color:#1a9b3c;font-weight:600}td.NIO{color:#d32f2f;font-weight:600}
  .st{color:#fff;border-radius:3px;padding:1px 6px;font-weight:600}.st.IO{background:#1a9b3c}.st.NIO{background:#d32f2f}.st.none{background:#9aa5b1}
  .aux{color:#55626f;font-size:11px}@media print{body{margin:8mm}}</style></head><body>
  <div style="font-weight:600;color:#1f5fa8">◆ MessWerk 3D – Prüfbericht</div>${reportTablesHTML(r)}</body></html>`;
}
