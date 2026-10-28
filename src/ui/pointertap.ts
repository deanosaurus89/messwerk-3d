/** Screen gesture that should pick (a click or a finger tap), not orbit.
 *  Mouse, and a touch that is already orbiting, keep the original 8 px / 700 ms window.
 *  While a pick tool is active the finger does not orbit until it has moved past `tapSlop('touch')`,
 *  so that wider window is a tap (`wide`). A second finger (pinch / pan) is never a pick. */
export function tapSlop(pointerType: string): number {
  return pointerType === 'mouse' ? 8 : 24;
}
export function tapMaxMs(pointerType: string): number {
  return pointerType === 'mouse' ? 700 : 900;
}
export function isPickTap(o: { pointerType: string; moved: number; dt: number; multi: boolean; wide?: boolean }): boolean {
  if (o.multi) return false;
  const wide = !!o.wide && o.pointerType !== 'mouse';
  const slop = wide ? tapSlop('touch') : tapSlop('mouse');
  const max = wide ? tapMaxMs('touch') : tapMaxMs('mouse');
  if (!(o.dt >= 0) || o.dt > max) return false;
  return o.moved <= slop;
}
/** A pick: the gesture is a tap and was not handed to orbit. */
export function pickGesture(o: { pointerType: string; moved: number; dt: number; multi: boolean; dragged: boolean; wide?: boolean }): 'pick' | 'ignore' {
  if (o.dragged) return 'ignore';
  return isPickTap(o) ? 'pick' : 'ignore';
}
