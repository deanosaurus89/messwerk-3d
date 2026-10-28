import { describe, expect, it } from 'vitest';
import { cadPickSamples } from '../src/ui/cadpick';
import { cellCenter, gridMetrics, overlapSum, placeLabels, type LayItem } from '../src/ui/labellayout';
import { isPickTap, pickGesture, tapSlop } from '../src/ui/pointertap';

const free = (id: number, ax = 200, ay = 180): LayItem => ({ id, ax, ay, w: 120, h: 36, pinned: false, px: 0, py: 0, choice: -1 });

describe('CAD nominal tap (mobile)', () => {
  it('accepts a finger tap that would have been thrown away as a mouse drag', () => {
    expect(tapSlop('mouse')).toBe(8);
    expect(tapSlop('touch')).toBeGreaterThan(8);
    const finger = { pointerType: 'touch', moved: 18, dt: 180, multi: false, wide: true };
    expect(isPickTap(finger)).toBe(true);
    expect(isPickTap({ ...finger, wide: false })).toBe(false);
    expect(isPickTap({ ...finger, pointerType: 'mouse', wide: true })).toBe(false);
    expect(pickGesture({ ...finger, dragged: false })).toBe('pick');
  });
  it('ignores a drag that was handed to orbit, a pinch, and a long press', () => {
    expect(pickGesture({ pointerType: 'touch', moved: 10, dt: 120, multi: false, dragged: true })).toBe('ignore');
    expect(pickGesture({ pointerType: 'touch', moved: 4, dt: 80, multi: true, dragged: false })).toBe('ignore');
    expect(pickGesture({ pointerType: 'touch', moved: 2, dt: 1200, multi: false, dragged: false })).toBe('ignore');
    expect(pickGesture({ pointerType: 'mouse', moved: 3, dt: 90, multi: false, dragged: false })).toBe('pick');
  });
  it('searches a few pixels around a touch miss and keeps an exact hit first', () => {
    expect(cadPickSamples(false)).toEqual([[0, 0]]);
    const soft = cadPickSamples(true);
    expect(soft[0]).toEqual([0, 0]);
    expect(soft.length).toBeGreaterThan(1);
    expect(soft.some(([x, y]) => x !== 0 || y !== 0)).toBe(true);
  });
});

describe('annotation layout', () => {
  it('leaves a dragged label fixed when the layout changes or more labels appear', () => {
    const pinned: LayItem = { id: 1, ax: 220, ay: 160, w: 100, h: 32, pinned: true, px: 40, py: 28, choice: 3 };
    const crowd = [pinned, free(2), free(3, 230, 170), free(4, 210, 190), free(5, 240, 150)];
    for (const mode of ['auto', 'spread', 'grid'] as const) {
      const hit = placeLabels(crowd, 800, 600, mode).find((p) => p.id === 1)!;
      expect(hit.cx).toBe(40);
      expect(hit.cy).toBe(28);
    }
  });
  it('snaps free labels onto the screen raster and keeps them off one another when there is room', () => {
    const items = [1, 2, 3, 4].map((id) => free(id, 180, 140));
    const W = 800, H = 600;
    const placed = placeLabels(items, W, H, 'grid');
    const m = gridMetrics(items, W, H);
    const cells = [];
    for (let row = 0; row < m.rows; row++) for (let col = 0; col < m.cols; col++) cells.push(cellCenter(m, col, row));
    for (const p of placed) expect(cells.some((c) => c.cx === p.cx && c.cy === p.cy)).toBe(true);
    expect(new Set(placed.map((p) => `${p.cx},${p.cy}`)).size).toBe(placed.length);
    expect(overlapSum(items, placed)).toBe(0);
  });
  it('spreads a crowded stack farther apart than the short-leader layout', () => {
    const items = [1, 2, 3, 4, 5, 6].map((id) => free(id, 180, 140));
    const W = 420, H = 320;
    const auto = placeLabels(items, W, H, 'auto');
    const spread = placeLabels(items, W, H, 'spread');
    const sep = (ps: { cx: number; cy: number }[]) => {
      let s = 0;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) s += Math.hypot(ps[i].cx - ps[j].cx, ps[i].cy - ps[j].cy);
      return s;
    };
    expect(overlapSum(items, spread)).toBeLessThanOrEqual(overlapSum(items, auto));
    expect(sep(spread)).toBeGreaterThan(sep(auto));
  });
});
