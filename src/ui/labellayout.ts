/** Screen placement of feature annotations.
 *  `auto` — short leader, the historical ring around the anchor.
 *  `spread` — search farther and along the screen so more labels sit without covering each other.
 *  `grid` — snap free labels onto one screen raster.
 *  A pinned label (the user dragged it) is copied through unchanged in every mode. */
export type LabelLayoutMode = 'auto' | 'spread' | 'grid';

export interface LayItem {
  id: number;
  /** anchor on screen */
  ax: number; ay: number;
  w: number; h: number;
  pinned: boolean;
  /** pinned center; ignored unless pinned */
  px: number; py: number;
  /** previous candidate index, kept when it is still a good slot */
  choice: number;
}
export interface LayOut { id: number; cx: number; cy: number; choice: number }
interface Box { x: number; y: number; w: number; h: number }

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const box = (cx: number, cy: number, w: number, h: number): Box => ({ x: cx - w / 2, y: cy - h / 2, w, h });
const offscreen = (r: Box, W: number, H: number) =>
  Math.max(0, -r.x) + Math.max(0, r.x + r.w - W) + Math.max(0, -r.y) + Math.max(0, r.y + r.h - H);

export function gridMetrics(items: { w: number; h: number }[], W: number, H: number) {
  const cw = Math.max(72, ...items.map((i) => i.w), 0) + 8;
  const ch = Math.max(28, ...items.map((i) => i.h), 0) + 8;
  const pad = 6;
  const cols = Math.max(1, Math.floor((W - 2 * pad) / cw));
  const rows = Math.max(1, Math.floor((H - 2 * pad) / ch));
  return { cw, ch, pad, cols, rows };
}
export function cellCenter(m: { cw: number; ch: number; pad: number }, col: number, row: number) {
  return { cx: m.pad + m.cw / 2 + col * m.cw, cy: m.pad + m.ch / 2 + row * m.ch };
}

function freeCandidates(it: LayItem, W: number, H: number, mode: 'auto' | 'spread'): { x: number; y: number; near: boolean }[] {
  const dists = mode === 'auto' ? [46, 96] : [40, 78, 124, 180, 250];
  const out: { x: number; y: number; near: boolean }[] = [];
  for (const dist of dists) for (let i = 0; i < 8; i++) {
    const ang = (-Math.PI / 4) + i * (Math.PI / 4);
    out.push({ x: it.ax + Math.cos(ang) * (dist + it.w / 2), y: it.ay + Math.sin(ang) * (dist + it.h / 2), near: dist <= 50 });
  }
  if (mode === 'spread') {
    const m = 8;
    const edge: [number, number][] = [[W / 2, m + it.h / 2], [W / 2, H - m - it.h / 2], [m + it.w / 2, H / 2], [W - m - it.w / 2, H / 2],
      [m + it.w / 2, m + it.h / 2], [W - m - it.w / 2, m + it.h / 2], [m + it.w / 2, H - m - it.h / 2], [W - m - it.w / 2, H - m - it.h / 2]];
    for (const [x, y] of edge) out.push({ x, y, near: false });
  }
  return out;
}

function placeFree(it: LayItem, placed: Box[], W: number, H: number, mode: 'auto' | 'spread'): { cx: number; cy: number; choice: number } {
  const cand = freeCandidates(it, W, H, mode);
  let best = Infinity, bi = 0, bx = it.ax, by = it.ay;
  cand.forEach((c, k) => {
    const r = box(c.x, c.y, it.w, it.h);
    let sc = 0;
    for (const p of placed) sc += overlap(r, p);
    const out = offscreen(r, W, H);
    if (mode === 'spread') {
      sc = sc * 24 + out * 900;
      for (const p of placed) {
        const d = Math.hypot((r.x + r.w / 2) - (p.x + p.w / 2), (r.y + r.h / 2) - (p.y + p.h / 2));
        if (d < 180) sc += (180 - d) * 0.2;
      }
      if (k === it.choice) sc -= 8;
    } else sc += out * 400 + (c.near ? 0 : 50) + k + (k === it.choice ? -30 : 0);
    if (sc < best) { best = sc; bi = k; bx = c.x; by = c.y; }
  });
  return { cx: bx, cy: by, choice: bi };
}

function placeGrid(it: LayItem, placed: Box[], W: number, H: number, items: LayItem[]): { cx: number; cy: number; choice: number } {
  const m = gridMetrics(items, W, H);
  let best = Infinity, pick = { cx: it.ax, cy: it.ay, choice: -1 };
  for (let row = 0; row < m.rows; row++) for (let col = 0; col < m.cols; col++) {
    const c = cellCenter(m, col, row);
    const r = box(c.cx, c.cy, it.w, it.h);
    let sc = offscreen(r, W, H) * 900;
    for (const p of placed) sc += overlap(r, p) * 24;
    sc += Math.hypot(c.cx - it.ax, c.cy - it.ay) * 0.05;
    const k = row * m.cols + col;
    if (k === it.choice) sc -= 8;
    if (sc < best) { best = sc; pick = { cx: c.cx, cy: c.cy, choice: k }; }
  }
  return pick;
}

export function placeLabels(items: LayItem[], W: number, H: number, mode: LabelLayoutMode): LayOut[] {
  const placed: Box[] = items.map((it) => ({ x: it.ax - 6, y: it.ay - 6, w: 12, h: 12 }));
  const order = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const out: LayOut[] = [];
  for (const it of order) {
    if (it.pinned) {
      placed.push(box(it.px, it.py, it.w, it.h));
      out.push({ id: it.id, cx: it.px, cy: it.py, choice: it.choice });
      continue;
    }
    const spot = mode === 'grid' ? placeGrid(it, placed, W, H, items) : placeFree(it, placed, W, H, mode);
    placed.push(box(spot.cx, spot.cy, it.w, it.h));
    out.push({ id: it.id, cx: spot.cx, cy: spot.cy, choice: spot.choice });
  }
  return out;
}

/** Sum of pairwise overlap areas. A pinned box is included so a free label that covers it counts. */
export function overlapSum(items: LayItem[], placed: LayOut[]): number {
  const boxes = placed.map((p) => { const it = items.find((i) => i.id === p.id)!; return box(p.cx, p.cy, it.w, it.h); });
  let s = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) s += overlap(boxes[i], boxes[j]);
  return s;
}
