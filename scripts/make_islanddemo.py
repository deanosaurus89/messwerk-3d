"""Islands demo (Phase 1, step 4): plate 80 × 60 × 10 with a bolt circle 6 × Ø8 on PCD 40 around (40, 30) and a centre
bore Ø14. Generic synthetic part (not a customer part). Top face z = 10 with:
- raised rims (burr rings, 0.25 mm high, ~1 mm wide) around bolt holes 1, 3, 5 (0°, 120°, 240°)
- a spatter ring of small bumps around bolt hole 2 (60°)
- one local bump (h 0.5, σ 0.55 mm) at (12, 48) and a flat swell (h 0.12, σ 2.5 mm) at (68, 10)
- one scan gap Ø1.6 (no surface, no wall) at (15, 12)
Noise σ = 8 µm normal to the surface. Mesh: Delaunay of a jittered 0.4 mm grid + exact hole rings, walls stitched.
Run: python scripts/make_islanddemo.py public/samples   (numpy + scipy, development only)."""
import sys, gzip, struct, numpy as np
from scipy.spatial import Delaunay
rng = np.random.default_rng(31)
L, W, T, h = 80.0, 60.0, 10.0, 0.4
C = np.array([40.0, 30.0])
bolts = [(C + 20 * np.array([np.cos(a), np.sin(a)]), 4.0) for a in np.radians(np.arange(0, 360, 60))]
holes = bolts + [(C, 7.0)]
gaps = [(np.array([15.0, 12.0]), 0.8)]
# --- 2D points of the top / bottom face
gx, gy = np.meshgrid(np.arange(0, L + 1e-9, h), np.arange(0, W + 1e-9, h)); P = np.c_[gx.ravel(), gy.ravel()]
inner = (P[:, 0] > 1e-6) & (P[:, 0] < L - 1e-6) & (P[:, 1] > 1e-6) & (P[:, 1] < W - 1e-6)
P[inner] += rng.uniform(-0.12 * h, 0.12 * h, (inner.sum(), 2))
keep = np.ones(len(P), bool)
for c, r in holes + gaps: keep &= np.hypot(*(P - c).T) > r + 0.45 * h
P = P[keep]
rings = []
for c, r in holes + gaps:
    n = int(np.ceil(2 * np.pi * r / h)); a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    rings.append((len(P), n)); P = np.r_[P, c + r * np.c_[np.cos(a), np.sin(a)]]
tri = Delaunay(P).simplices
cen = P[tri].mean(1); ok = np.ones(len(tri), bool)
for c, r in holes + gaps: ok &= np.hypot(*(cen - c).T) > r
tri = tri[ok]
# --- top height field
def height(q):
    z = np.full(len(q), T)
    for i, (c, r) in enumerate(bolts):
        d = np.hypot(*(q - c).T)
        if i in (0, 2, 4): z += 0.25 * np.exp(-((d - r - 0.6) / 0.38) ** 2) * (d >= r)
    c, r = bolts[1]; rs = np.random.default_rng(5)
    for k in range(12):
        a = rs.uniform(0, 2 * np.pi); rr = r + rs.uniform(0.8, 2.2); p = c + rr * np.array([np.cos(a), np.sin(a)])
        z += rs.uniform(0.12, 0.35) * np.exp(-np.sum((q - p) ** 2, 1) / (2 * rs.uniform(0.25, 0.45) ** 2))
    z += 0.5 * np.exp(-np.sum((q - [12, 48]) ** 2, 1) / (2 * 0.55 ** 2)) + 0.12 * np.exp(-np.sum((q - [68, 10]) ** 2, 1) / (2 * 2.5 ** 2))
    return z
nP = len(P)
Vt = np.c_[P, height(P) + rng.normal(0, 0.008, nP)]
Vb = np.c_[P, rng.normal(0, 0.008, nP)]
V = [Vt, Vb]; F = [tri, tri[:, ::-1] + nP]; off = 2 * nP
def strip(top_idx, bot_idx, ring_xy, outward):
    """stitch two closed loops (same xy) by intermediate rings; outward = desired normal direction per loop point"""
    global off
    nz = int(np.ceil(T / h)); zs = np.linspace(T, 0, nz + 1)[1:-1]; n = len(ring_xy)
    cols = [top_idx]
    for z in zs:
        q = np.c_[ring_xy + outward * rng.normal(0, 0.008, (n, 1)), np.full(n, z)]; V.append(q); cols.append(np.arange(off, off + n)); off += n
    cols.append(bot_idx); tris = []
    for a, b in zip(cols[:-1], cols[1:]):
        for k in range(n):
            k2 = (k + 1) % n; tris += [[a[k], b[k], a[k2]], [a[k2], b[k], b[k2]]]
    F.append(np.array(tris))
for (c, r), (s, n) in zip(holes, rings[:len(holes)]):
    idx = np.arange(s, s + n); xy = P[idx]; strip(idx, idx + nP, xy, (c - xy) / r)
# outer sides: boundary loop of the rectangle in order (counter-clockwise)
on = np.where((np.abs(P[:, 0]) < 1e-6) | (np.abs(P[:, 0] - L) < 1e-6) | (np.abs(P[:, 1]) < 1e-6) | (np.abs(P[:, 1] - W) < 1e-6))[0]
ang = np.arctan2(P[on, 1] - W / 2, P[on, 0] - L / 2); on = on[np.argsort(ang)]
xy = P[on]; nrm = np.where(np.abs(xy[:, :1]) < 1e-6, [-1, 0], np.where(np.abs(xy[:, :1] - L) < 1e-6, [1, 0], np.where(np.abs(xy[:, 1:]) < 1e-6, [0, -1], [0, 1])))
strip(on, on + nP, xy, nrm.astype(float))
V = np.vstack(V); F = np.vstack(F); t = V[F]
# orient: top +z, bottom −z, walls by outward hint (centroid vs nearest hole / box)
n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]); cz = t[:, :, 2].mean(1); cxy = t[:, :, :2].mean(1)
want = np.zeros_like(n)
want[:len(tri)] = [0, 0, 1]; want[len(tri):2 * len(tri)] = [0, 0, -1]
wall = np.arange(2 * len(tri), len(F))
for i in wall:
    p = cxy[i]; d = [np.hypot(*(p - c)) - r for c, r in holes]; k = int(np.argmin(d))
    if abs(d[k]) < 0.3: want[i, :2] = holes[k][0] - p
    else: want[i, :2] = p - [L / 2, W / 2] if False else [(-1 if p[0] < 0.3 else 1 if p[0] > L - 0.3 else 0), (-1 if p[1] < 0.3 else 1 if p[1] > W - 0.3 else 0)]
flip = np.sum(n * want, 1) < 0; t[flip] = t[flip][:, ::-1]
nn = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]); nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-12)
dt = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]); a = np.zeros(len(t), dt); a["n"] = nn; a["v"] = t
out = (sys.argv[1] if len(sys.argv) > 1 else "public/samples") + "/inseldemo.stl.gz"
with gzip.open(out, "wb", 9) as f: f.write(b"MessWerk islands demo (synthetic)".ljust(80, b" ")); f.write(struct.pack("<I", len(t))); f.write(a.tobytes())
print(out, len(t), "triangles")
