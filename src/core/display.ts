// Display precision (Options ▸ Decimal places, View ribbon ▸ Decimals): number of decimal places of all DISPLAYED values
// (annotations, panels, tree properties, report/CSV). Internal values and input fields are never rounded.
// Core default 4 (tests, headless); the app sets the user preference (default 2) at start-up.
let DEC = 4;
export const DEC_MIN = 0, DEC_MAX = 6;
export const getDec = () => DEC;
export function setDec(n: number) { DEC = Math.max(DEC_MIN, Math.min(DEC_MAX, Math.round(n))); return DEC; }
/** decimals for a value that the code would show with `d` places: lengths/deviations/angles (2…4) follow the setting;
 *  1-place parameter displays stay; unit direction vectors (≥ 5) keep at least their places (2 decimals would hide a tilt). */
export const decFor = (d: number) => (d >= 5 ? Math.max(d, DEC) : d >= 2 ? DEC : d);
