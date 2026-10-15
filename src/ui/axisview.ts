// Axis analysis camera: side view (⟂ nominal axis) so tilt and the derived median line are visible at once.
import type { Viewer } from '../viewer';
import type { AxisAnalysis } from '../core/axisan';
import { Vec3, add, basis, cross, dot, norm, scale, sub, unit } from '../core/linalg';

export function sideView(viewer: Viewer, ax: AxisAnalysis[]) {
  const x = ax[0], d = x.dir, c = viewer.getCamera(); const v: Vec3 = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
  let w = sub(v, scale(d, dot(v, d))); if (norm(w) < 1e-6) w = basis(d)[0];
  // prefer the side in which the tilt shows (actual axis deviates within the view plane)
  const t = sub(x.actualDir, scale(d, dot(x.actualDir, d))); if (norm(t) > 1e-9) { const s = cross(d, unit(t)); w = dot(s, w) < 0 ? scale(s, -1) : s; }
  const mid = scale(add(x.actualTop, x.actualBot), 0.5);
  viewer.focus(mid as [number, number, number], Math.max(x.length / 2, x.radius) * 1.2, w as [number, number, number]);
}
