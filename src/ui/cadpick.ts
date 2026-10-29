/** Screen offsets (px) for a CAD ray. The exact point is first.
 *  Touch also tries a small ring: the display mesh is chord-limited (≤ 0.75 mm) and a finger
 *  can land in the crack between two coarse faces, which a mouse hover rarely does. */
export function cadPickSamples(soften: boolean): [number, number][] {
  if (!soften) return [[0, 0]];
  return [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10], [8, 8], [-8, 8], [8, -8], [-8, -8]];
}

/**
 * Edge window in millimetres. A mouse keeps `baseMm`. A finger adds about 10 px,
 * and never more than 10 mm, so the middle of a face stays a surface on a phone.
 */
export function edgeWindowMm(baseMm: number, mmPerPx: number, touch: boolean): number {
  if (!touch || !(mmPerPx > 0) || !(baseMm > 0)) return baseMm;
  const finger = mmPerPx * 10;
  const cap = Math.max(baseMm, 10);
  return Math.min(cap, Math.max(baseMm, finger));
}
