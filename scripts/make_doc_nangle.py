"""Docs explainer: 'Normal angle' of Click & grow – generic cross-section (plate edge with fillet + chamfer), no part data."""
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
A = 20  # normal angle limit [deg] (illustration)
fig, ax = plt.subplots(figsize=(16, 8), dpi=100)
fig.suptitle('Normal angle – region growing stops where the surface normal bends more than the limit', fontsize=20, fontweight='bold', y=0.97)
# profile: flat top (y=10) from x=0..30, fillet R=4 to the vertical wall x=34, chamfer on the left at x=0..3
t = np.linspace(0, np.pi / 2, 40)
top = np.c_[np.linspace(3, 30, 60), np.full(60, 10.0)]
fil = np.c_[30 + 4 * np.sin(t), 6 + 4 * np.cos(t)]
wall = np.c_[np.full(20, 34.0), np.linspace(6, -2, 20)]
ch = np.c_[np.linspace(0, 3, 10), np.linspace(7, 10, 10)]
lw = np.c_[np.full(15, 0.0), np.linspace(-2, 7, 15)]
prof = np.vstack([lw, ch, top, fil, wall])
ax.fill(np.r_[prof[:, 0], 34, 0], np.r_[prof[:, 1], -2, -2], color='#d9dee4', zorder=0)
ax.plot(prof[:, 0], prof[:, 1], color='#455a64', lw=2, zorder=1)
def normals(P):
    d = np.gradient(P, axis=0); n = np.c_[-d[:, 1], d[:, 0]]; n /= np.linalg.norm(n, axis=1)[:, None]; return n
n = normals(prof); ang = np.degrees(np.arccos(np.clip(n[:, 1], -1, 1)))  # deviation from the seed normal (0,1)
ok = ang <= A
seed = np.argmin(np.abs(prof[:, 0] - 15) + np.abs(prof[:, 1] - 10))
ax.scatter(prof[ok, 0], prof[ok, 1], s=28, color='#2e7d32', zorder=3, label=f'taken: normal within {A}°')
ax.scatter(prof[~ok, 0], prof[~ok, 1], s=28, color='#c62828', zorder=3, label=f'stop: normal bends > {A}° (fillet, chamfer, wall)')
for i in range(0, len(prof), 3):
    c = '#2e7d32' if ok[i] else '#c62828'
    ax.annotate('', xy=prof[i] + 1.6 * n[i], xytext=prof[i], arrowprops=dict(arrowstyle='->', color=c, lw=1.2), zorder=2)
ax.scatter(*prof[seed], s=260, facecolor='none', edgecolor='#1565c0', lw=3, zorder=4)
ax.text(prof[seed][0], prof[seed][1] + 2.6, 'click (seed)', ha='center', color='#1565c0', fontsize=15, fontweight='bold')
# limit cone at the fillet start
k = np.argmax((~ok) & (prof[:, 0] > 29)); p = prof[k]
for s in (-1, 1):
    a = np.radians(90 + s * A); ax.plot([p[0], p[0] + 3.2 * np.cos(a)], [p[1], p[1] + 3.2 * np.sin(a)], color='#1565c0', lw=1.3, ls='--')
ax.text(p[0] + 0.6, p[1] + 3.6, f'±{A}°', color='#1565c0', fontsize=14)
ax.set_aspect('equal'); ax.set_xlim(-2, 38); ax.set_ylim(-3, 15); ax.axis('off')
ax.legend(loc='lower center', fontsize=14, frameon=False, ncol=2, bbox_to_anchor=(0.5, -0.06))
fig.text(0.5, 0.02, 'Smaller angle = stops earlier at roundings; larger angle = grows further over soft transitions. Adding regions (+ Add region) joins further areas.', ha='center', fontsize=13, color='#37474f')
fig.savefig('public/docs/nangle.png', bbox_inches='tight', facecolor='white')
