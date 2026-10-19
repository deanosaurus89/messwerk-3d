// Bericht ("Tabelle erzeugen"): eingefrorene Momentaufnahme aller Merkmale und Prüfmerkmale.
import { dirLocal, toLocal } from './csys';
import { Control, Feature, FORM_NAME, DEG, controlLabel, evaluate, datumText, EvalCtx } from './features';

export interface ReportFeatureRow { name: string; type: string; x: number; y: number; z: number; i: number; j: number; k: number;
  size: string; form: number | null; formName: string; rms: number | null; points: number; aux: string; }
export interface ReportControlRow { feature: string; control: string; nominal: number | null; measured: number | null; deviation: number | null;
  tolUp: number; tolLo: number; status: string; tolSrc?: string; }
export interface Report { id: number; name: string; created: string; source: string; features: ReportFeatureRow[]; controls: ReportControlRow[]; io: number; nio: number; }

export const statusText = (s: string) => (s === 'IO' ? 'OK' : s === 'NIO' ? 'NOK' : s);
const TYPE_EN: Record<string, string> = { Ebene: 'Plane', Kreis: 'Circle', Zylinder: 'Cylinder', Langloch: 'Slot', Kegel: 'Cone', Kugel: 'Sphere', Torus: 'Torus', Punkt: 'Point', Linie: 'Line', Freiformfläche: 'Freeform surface', Abstand: 'Distance', Winkel: 'Angle' };
const f4 = (v: number | null | undefined, d = 4) => (v == null || !isFinite(v) ? '' : v.toFixed(d));

export function sizeText(f: Feature): string {
  const m = f.measured!;
  switch (f.type) {
    case 'Kreis': case 'Zylinder': case 'Kugel': return `⌀ ${f4(m.diameter)}`;
    case 'Kegel': return `∢ ${f4(2 * m.halfAngle! * DEG, 3)}° / ⌀ ${f4(m.diameter)}`;
    case 'Langloch': return `${f4(m.length)} × ${f4(m.width)}`;
    case 'Torus': return `⌀ ${f4(m.diameter)} / tube ⌀ ${f4(2 * m.minorRadius!)}`;
    case 'Abstand': return `${f4(m.distance)}`;
    case 'Linie': case 'Linienzug': return `L ${f4(m.length)}`;
    case 'Winkel': return `∠ ${f4(m.angle)}°`;
    default: return '';
  }
}

export function buildReport(id: number, features: Feature[], controls: Control[], source: string, now = new Date(), ctx: EvalCtx = {}): Report {
  const fm = new Map(features.map((f) => [f.id, f]));
  const frows: ReportFeatureRow[] = features.map((f) => {
    const m = f.measured!;
    const isD = f.type === 'Abstand';
    const fr = ctx.frame, C = fr ? toLocal(fr, m.center) : m.center, N = fr ? dirLocal(fr, m.normal) : m.normal;
    return { name: f.name + (f.datum ? ` [${f.datum}]` : ''), type: TYPE_EN[f.type] ?? f.type, x: C[0], y: C[1], z: C[2], i: N[0], j: N[1], k: N[2],
      size: sizeText(f), form: isD ? null : m.form, formName: isD ? '' : FORM_NAME[f.type] + (m.crit && m.crit !== 'lsq' ? ` (${({ mz: 'min. zone', mcc: 'circumscribed', mic: 'inscribed' } as Record<string, string>)[m.crit]})` : ''), rms: isD ? null : m.rms, points: f.pointCount,
      aux: f.aux ? `Aux. plane (${f.aux.source}, flatness ${f4(f.aux.plane.form)})` : '' };
  });
  let io = 0, nio = 0;
  const crows: ReportControlRow[] = controls.map((c) => {
    const f = fm.get(c.featureIds[0]); const r = evaluate(c, fm, ctx);
    if (r.status === 'IO') io++; if (r.status === 'NIO') nio++;
    const dt = datumText(c, fm);
    return { feature: f?.name ?? '?', control: controlLabel(c, f) + (dt ? ` |${dt}|` : '') + (r.flag ? ` ⚠ ${r.flag}` : ''), nominal: c.nominal, measured: r.measured, deviation: r.deviation, tolUp: c.tolUp, tolLo: c.tolLo, status: r.status, tolSrc: c.tolSrc === 'manual' ? 'manual' : c.tolSrc ?? '' };
  });
  return { id, name: `Table ${id}`, created: now.toLocaleString('en-GB'), source, features: frows, controls: crows, io, nio };
}

const csvCell = (v: string | number | null) => (typeof v === 'number' ? f4(v).replace('.', ',') : (v ?? '')).toString().replace(/;/g, ',');

export function reportCSV(r: Report): string {
  const L: (string | number | null)[][] = [
    [r.name], ['Created', r.created], ['File', r.source], [],
    ['Features'], ['Name', 'Type', 'X', 'Y', 'Z', 'I', 'J', 'K', 'Size', 'Form', 'Form value', 'RMS', 'Points', 'Aux. plane'],
    ...r.features.map((f) => [f.name, f.type, f.x, f.y, f.z, f.i, f.j, f.k, f.size, f.formName, f.form, f.rms, f.points, f.aux]),
    [], ['Controls', `${r.io} OK`, `${r.nio} NOK`],
    ['Feature', 'Control', 'Nominal', 'Actual', 'Deviation', 'Tol +', 'Tol -', 'Tol. source', 'Status'],
    ...r.controls.map((c) => [c.feature, c.control, c.nominal, c.measured, c.deviation, c.tolUp, c.tolLo, c.tolSrc ?? '', statusText(c.status)]),
  ];
  return '\ufeff' + L.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function reportTablesHTML(r: Report): string {
  const n = (v: number | null, d = 4) => (v == null ? '—' : v.toFixed(d));
  return `<h2>${esc(r.name)}</h2><p class="meta">Created: ${esc(r.created)} · File: ${esc(r.source)} · ${r.features.length} features · ${r.controls.length} controls
    (<span class="io">${r.io} OK</span>, <span class="nio">${r.nio} NOK</span>)</p>
  <h3>Features</h3><table><thead><tr><th>Name</th><th>Type</th><th>X</th><th>Y</th><th>Z</th><th>Size</th><th>Form</th><th>RMS</th><th>Points</th></tr></thead><tbody>
  ${r.features.map((f) => `<tr><td>${esc(f.name)}${f.aux ? `<div class="aux">${esc(f.aux)}</div>` : ''}</td><td>${f.type}</td><td class="n">${n(f.x, 3)}</td><td class="n">${n(f.y, 3)}</td><td class="n">${n(f.z, 3)}</td>
    <td class="n">${esc(f.size)}</td><td class="n">${f.form == null ? '' : `${f.formName} ${n(f.form)}`}</td><td class="n">${n(f.rms)}</td><td class="n">${f.points}</td></tr>`).join('')}
  </tbody></table>
  <h3>Controls</h3><table><thead><tr><th>Feature</th><th>Control</th><th>Nominal</th><th>Actual</th><th>Dev.</th><th>Tol +</th><th>Tol −</th><th>Tol. source</th><th>Status</th></tr></thead><tbody>
  ${r.controls.length ? r.controls.map((c) => `<tr><td>${esc(c.feature)}</td><td>${esc(c.control)}</td><td class="n">${n(c.nominal)}</td><td class="n">${n(c.measured)}</td>
    <td class="n ${c.status}">${n(c.deviation)}</td><td class="n">${n(c.tolUp)}</td><td class="n">${n(c.tolLo)}</td><td class="src">${esc(c.tolSrc ?? '')}</td><td><span class="st ${c.status === '—' ? 'none' : c.status}">${statusText(c.status)}</span></td></tr>`).join('')
    : '<tr><td colspan="9">No controls selected.</td></tr>'}
  </tbody></table>`;
}

export function reportHTML(r: Report): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.name)} – MessWerk 3D</title><style>
  body{font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;color:#1d2833;margin:18px}
  h2{margin:0 0 4px}h3{margin:16px 0 6px}.meta{color:#55626f}table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #c9d0d8;padding:3px 6px;text-align:left}th{background:#eef2f6}td.n{text-align:right;font-variant-numeric:tabular-nums}
  .io{color:#1a9b3c}.nio{color:#d32f2f}td.IO{color:#1a9b3c;font-weight:600}td.NIO{color:#d32f2f;font-weight:600}
  .st{color:#fff;border-radius:3px;padding:1px 6px;font-weight:600}.st.IO{background:#1a9b3c}.st.NIO{background:#d32f2f}.st.none{background:#9aa5b1}
  .aux{color:#55626f;font-size:11px}@media print{body{margin:8mm}}</style></head><body>
  <div style="font-weight:600;color:#1f5fa8">◆ MessWerk 3D – Inspection report</div>${reportTablesHTML(r)}</body></html>`;
}
