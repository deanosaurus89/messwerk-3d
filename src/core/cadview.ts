/** Reference CAD opacity, separate from the data object. Off is fully opaque. */
export function referenceOpacity(on: boolean, amt: number): number {
  if (!on) return 1;
  const a = Math.min(95, Math.max(5, Math.round(Number.isFinite(amt) ? amt : 60)));
  return 1 - a / 100;
}

/**
 * Material for that opacity.
 * Fully opaque: depth write on, both sides (the ochre back face stays an orientation cue).
 * Transparent: front side only. A double-sided shell with depth write off shows the back
 * face through every face, so the model looks ghosted at every slider stop except the ends.
 */
export function materialForOpacity(opacity: number): { opacity: number; transparent: boolean; depthWrite: boolean; side: 'double' | 'front' } {
  if (!(opacity < 0.999)) return { opacity: 1, transparent: false, depthWrite: true, side: 'double' };
  return { opacity, transparent: true, depthWrite: false, side: 'front' };
}
