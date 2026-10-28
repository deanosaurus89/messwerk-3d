// One-off timing of the public CAD sample. Run with CAD_PERF=1. Not part of the default suite.
import { describe, it } from 'vitest';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import * as C from '../src/cad/occcore';

const on = process.env.CAD_PERF === '1';
describe.skipIf(!on)('CAD import timing', () => {
  it('compares the old per-face fine mesh + exact area with the display load', async () => {
    const oc = await (await import('opencascade.js/dist/node.js' as any)).default();
    const raw = gunzipSync(new Uint8Array(fs.readFileSync('public/samples/cad-sample.igs.gz')));
    let t = performance.now();
    const sh = C.readCAD(oc, raw, 'cad-sample.igs');
    const read = performance.now() - t;
    const fs_ = C.faces(oc, sh);
    const diag = C.bboxDiag(oc, sh);
    const N = Math.min(fs_.length, Number(process.env.CAD_N || fs_.length));
    oc.BRepTools.Clean(sh, true);
    t = performance.now();
    let tris = 0;
    for (let i = 0; i < N; i++) {
      const f = fs_[i];
      tris += C.tessellate(oc, f, diag / 1500).indices.length / 3;
      C.faceInfo(oc, f, i);
    }
    const oldMs = performance.now() - t;
    oc.BRepTools.Clean(sh, true);
    t = performance.now();
    const neu = C.loadDisplayFaces(oc, sh);
    const newMs = performance.now() - t;
    const newTris = neu.faces.reduce((s, f) => s + f.tess.indices.length / 3, 0);
    const line = `faces ${fs_.length} (timed ${N}) diag ${diag.toFixed(1)} read ${read.toFixed(0)} ms | old fine+area ${(oldMs / 1000).toFixed(2)} s tris ${tris} | display ${(newMs / 1000).toFixed(2)} s tris ${newTris} defl ${neu.defl.linear.toFixed(3)}/${neu.defl.angular} speedup ${(oldMs / Math.max(1, newMs)).toFixed(1)}x`;
    console.log(line);
    if (process.env.CAD_TRIALS !== '1') { fs.appendFileSync('/tmp/cad-perf.txt', line + '\n'); expect(neu.faces.length).toBe(fs_.length); return; }
    const count = () => { let tr = 0, empty = 0; for (const f of fs_) { const loc = new oc.TopLoc_Location_1(); const h = oc.BRep_Tool.Triangulation(f, loc, 0); if (h.IsNull()) empty++; else tr += h.get().NbTriangles(); loc.delete?.(); } return { tr, empty }; };
    const meshParams = (lin: number, ang: number, ctrl: boolean, minSize = -1) => {
      const p = new oc.IMeshTools_Parameters();
      p.Deflection = lin; p.Angle = ang; p.ControlSurfaceDeflection = ctrl; p.InParallel = false; p.Relative = false; p.CleanModel = true; p.AllowQualityDecrease = true; p.MinSize = minSize;
      const m = new oc.BRepMesh_IncrementalMesh_3(sh, p, new oc.Message_ProgressRange_1());
      m.delete?.(); p.delete?.();
    };
    for (const [name, lin, ang, ctrl, minS] of [
      ['whole ctrl 0.75/0.55', 0.75, 0.55, true, -1],
      ['whole nocontrol 0.75/0.8', 0.75, 0.8, false, -1],
      ['whole nocontrol 1.5/0.9 min0.4', 1.5, 0.9, false, 0.4],
      ['whole ctrl 1.5/0.9', 1.5, 0.9, true, -1],
      ['whole nocontrol 2/1.2', 2, 1.2, false, 0.5],
    ] as [string, number, number, boolean, number][]) {
      oc.BRepTools.Clean(sh, true);
      t = performance.now();
      meshParams(lin, ang, ctrl, minS);
      const ms = performance.now() - t;
      const c = count();
      console.log(`${name}: ${ms.toFixed(0)} ms tris ${c.tr} empty ${c.empty}`);
    }
    oc.BRepTools.Clean(sh, true);
    t = performance.now();
    const p = new oc.IMeshTools_Parameters();
    p.Deflection = 1; p.Angle = 0.8; p.ControlSurfaceDeflection = false; p.InternalVerticesMode = false; p.Relative = false; p.CleanModel = true; p.AllowQualityDecrease = true;
    const m = new oc.BRepMesh_IncrementalMesh_3(sh, p, new oc.Message_ProgressRange_1());
    console.log(`no interior verts: ${(performance.now() - t).toFixed(0)} ms`, count());
    m.delete?.(); p.delete?.();
    const types: Record<string, number> = {};
    t = performance.now();
    for (const f of fs_) { const c = C.faceClass(oc, f); types[c.type + (c.detail ? '/' + c.detail : '')] = (types[c.type + (c.detail ? '/' + c.detail : '')] ?? 0) + 1; }
    console.log('types', types, `${(performance.now() - t).toFixed(0)} ms`);
    fs.appendFileSync('/tmp/cad-perf.txt', line + '\n');
    expect(neu.faces.length).toBe(fs_.length);
  }, 900000);
});
