"""Docs explainer: 'Boundary exclusion distance' – synthetic plate (generic geometry only): top view + edge cross-section."""
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, FancyBboxPatch, PathPatch
from matplotlib.path import Path
rng = np.random.default_rng(3)
D = 3.0  # exclusion distance (illustration scale)
fig = plt.figure(figsize=(16, 11), dpi=100)
fig.suptitle('Boundary exclusion distance – points near the boundary are excluded', fontsize=22, fontweight='bold', y=0.975)
ax = fig.add_axes([0.04, 0.30, 0.52, 0.6]); bx = fig.add_axes([0.60, 0.42, 0.37, 0.42])
# ---- top view
W, Hh, hc, hr = 60, 40, (40, 20), 6
isl = (12, 26, 10, 7)  # island (x, y, w, h): region inside the contour not reached by region growing
ax.add_patch(Rectangle((0, 0), W, Hh, color='#d9dee4', zorder=0))
ax.add_patch(Rectangle((0, 0), W, Hh, fill=False, ec='#1565c0', lw=3, zorder=5))
ax.add_patch(Rectangle((D, D), W - 2 * D, Hh - 2 * D, fill=False, ec='#1565c0', lw=1.5, ls='--', zorder=5))
ax.add_patch(Circle(hc, hr, color='white', zorder=4)); ax.add_patch(Circle(hc, hr, fill=False, ec='#1565c0', lw=3, zorder=5))
ax.add_patch(Circle(hc, hr + D, fill=False, ec='#1565c0', lw=1.5, ls='--', zorder=5))
ax.add_patch(Rectangle(isl[:2], isl[2], isl[3], fill=False, ec='#ef6c00', lw=2, zorder=5))
ax.add_patch(Rectangle((isl[0] - D, isl[1] - D), isl[2] + 2 * D, isl[3] + 2 * D, fill=False, ec='#ef6c00', lw=1.3, ls=':', zorder=5))
p = rng.uniform([0, 0], [W, Hh], (4200, 2))
r = np.hypot(p[:, 0] - hc[0], p[:, 1] - hc[1]); p = p[r > hr]; r = r[r > hr]
edge = np.minimum.reduce([p[:, 0], p[:, 1], W - p[:, 0], Hh - p[:, 1]])
inIsl = (p[:, 0] > isl[0]) & (p[:, 0] < isl[0] + isl[2]) & (p[:, 1] > isl[1]) & (p[:, 1] < isl[1] + isl[3])
dIsl = np.hypot(np.maximum(0, np.maximum(isl[0] - p[:, 0], p[:, 0] - isl[0] - isl[2])), np.maximum(0, np.maximum(isl[1] - p[:, 1], p[:, 1] - isl[1] - isl[3])))
exO = edge < D; exH = (r - hr) < D
ok = ~exO & ~exH
ax.scatter(p[ok & ~inIsl, 0], p[ok & ~inIsl, 1], s=5, color='#2e7d32', zorder=3)
ax.scatter(p[ok & inIsl, 0], p[ok & inIsl, 1], s=6, color='#ef6c00', zorder=3)
ax.scatter(p[~ok, 0], p[~ok, 1], s=7, color='#9e9e9e', marker='x', zorder=3)
ax.annotate('', (0, 33), (D, 33), arrowprops=dict(arrowstyle='<->', color='#c62828', lw=2), zorder=6)
ax.text(D + 0.6, 34.2, 'd', color='#c62828', fontsize=16, fontweight='bold', zorder=6)
ax.annotate('', (hc[0] + hr, hc[1]), (hc[0] + hr + D, hc[1]), arrowprops=dict(arrowstyle='<->', color='#c62828', lw=2), zorder=6)
ax.text(hc[0] + hr + 0.4, hc[1] + 1.1, 'd', color='#c62828', fontsize=16, fontweight='bold', zorder=6)
ax.text(hc[0], hc[1], 'hole', ha='center', va='center', fontsize=12, color='#444', zorder=6)
ax.text(isl[0] + isl[2] / 2, isl[1] + isl[3] + 1.2 + D, 'island', ha='center', fontsize=12, color='#ef6c00', fontweight='bold', zorder=6)
ax.text(W / 2, -3, 'outer contour (from the grown region)', ha='center', color='#1565c0', fontsize=13, fontweight='bold')
ax.set_xlim(-2, W + 2); ax.set_ylim(-5, Hh + 2); ax.set_aspect('equal'); ax.axis('off')
ax.set_title('Top view: strip of width d inside the outer contour and around holes is excluded', fontsize=14, loc='left')
# ---- cross-section of an edge with a fillet
x = np.linspace(-14, 4, 600); R = 3.0
z = np.where(x < -R, 0.0, np.where(x < 0, np.sqrt(np.clip(R * R - (x + R) ** 2, 0, None)) - R, np.nan))
bx.add_patch(PathPatch(Path(np.c_[np.r_[x[x < 0], 0, 0, -14], np.r_[z[x < 0], -R, -10, -10]]), color='#d9dee4', zorder=0))
wall = np.linspace(-R, -10, 40)
pts_x = np.r_[x[x < 0][::6], np.zeros(40)]; pts_z = np.r_[z[x < 0][::6], wall] + rng.normal(0, 0.04, len(x[x < 0][::6]) + 40)
xc = -R - 0.2  # where region growing stops (normal deviates) = outer contour
ex = pts_x > xc - D
bx.scatter(pts_x[~ex], pts_z[~ex], s=12, color='#2e7d32', zorder=3, label='kept (plane)')
bx.scatter(pts_x[ex & (pts_x < xc)], pts_z[ex & (pts_x < xc)], s=22, color='#9e9e9e', marker='x', zorder=3, label='excluded by d (start of the fillet, burr)')
bx.scatter(pts_x[pts_x >= xc], pts_z[pts_x >= xc], s=12, color='#bdbdbd', zorder=2, label='fillet / side wall – never part of the plane')
bx.axvline(xc, color='#1565c0', lw=3); bx.axvline(xc - D, color='#1565c0', lw=1.5, ls='--')
bx.annotate('', (xc - D, 1.2), (xc, 1.2), arrowprops=dict(arrowstyle='<->', color='#c62828', lw=2)); bx.text(xc - D / 2, 1.6, 'd', color='#c62828', fontsize=16, fontweight='bold', ha='center')
bx.text(xc + 0.2, -9.2, 'outer\ncontour', color='#1565c0', fontsize=12, fontweight='bold')
bx.set_xlim(-14, 3); bx.set_ylim(-10.5, 3); bx.set_aspect('equal'); bx.axis('off')
bx.set_title('Cross-section at the edge (fillet + side wall)', fontsize=14, loc='left')
bx.legend(loc='upper left', bbox_to_anchor=(0, -0.02), fontsize=12)
h = [plt.Line2D([], [], marker='o', ls='', color='#2e7d32', label='kept'), plt.Line2D([], [], marker='x', ls='', color='#9e9e9e', label='excluded (closer than d to the boundary)'),
     plt.Line2D([], [], marker='o', ls='', color='#ef6c00', label='island: kept with “Include detected islands”; islands off → island + strip d around it excluded')]
ax.legend(handles=h, loc='upper left', bbox_to_anchor=(0, -0.06), fontsize=12)
fig.text(0.5, 0.06, 'Boundary exclusion distance d [mm]: points closer than d to the outer contour and to holes/openings are excluded\n(with islands off also near island edges). Removes edge roundings, burrs and chamfer starts. 0 = off.',
         ha='center', va='center', fontsize=14, bbox=dict(boxstyle='round,pad=0.6', fc='#eef2f7', ec='#8a99aa'))
fig.savefig('public/docs/excl_inset.png', dpi=100); print('ok')
