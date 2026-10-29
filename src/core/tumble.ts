// Screen-space tumble. Azimuth (vertical screen axis) already turns freely in a
// spherical orbit. Pitch about the horizontal screen axis used to stop at the
// poles because polar angle is clamped to (0, π). These turns are quaternion
// increments, so the camera can tumble several full revolutions.
import { Vec3, add, cross, dot, norm, scale, unit } from './linalg';

export interface TumblePose { offset: Vec3; up: Vec3 }

/** Rotate the camera offset (camera − target) by `dx` about the vertical screen
 *  axis and `dy` about the horizontal screen axis. Angles are radians.
 *  Positive `dy` pitches without a polar clamp. */
export function tumble(offset: Vec3, up: Vec3, dx: number, dy: number): TumblePose {
  let o: Vec3 = [offset[0], offset[1], offset[2]];
  let u: Vec3 = unit(up);
  const apply = (axis: Vec3, ang: number) => {
    if (!ang || norm(axis) < 1e-12) return;
    const a = unit(axis), c = Math.cos(ang), s = Math.sin(ang);
    const rot = (v: Vec3): Vec3 => add(add(scale(v, c), scale(cross(a, v), s)), scale(a, dot(a, v) * (1 - c)));
    o = rot(o); u = unit(rot(u));
  };
  // view looks from the camera toward the target
  const view = scale(unit(o), -1);
  const right = cross(view, u);
  const screenUp = cross(right, view);
  apply(screenUp, -dx);
  const view2 = scale(unit(o), -1);
  const right2 = cross(view2, u);
  apply(right2, -dy);
  if (norm(o) < 1e-9) o = offset;
  return { offset: o, up: u };
}
