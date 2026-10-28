/** Screen offsets (px) for a CAD ray. The exact point is first.
 *  Touch also tries a small ring: the display mesh is chord-limited (≤ 0.75 mm) and a finger
 *  can land in the crack between two coarse faces, which a mouse hover rarely does. */
export function cadPickSamples(soften: boolean): [number, number][] {
  if (!soften) return [[0, 0]];
  return [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10], [8, 8], [-8, 8], [8, -8], [-8, -8]];
}
