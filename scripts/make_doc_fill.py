"""Docs explainer: 'All inside boundary & Exclude raised' – synthetic plate cross-section (generic geometry only)."""
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle
rng = np.random.default_rng(7)
BAND = 2.0
def surface(x):
    z = 0.05 * np.sin(x / 7) + rng.normal(0, 0.03, x.size)
    z += 1.2 * np.exp(-((x - 18) / 2.2) ** 2)          # bump
    z += 0.8 * np.exp(-((x - 30) / 0.7) ** 2)          # spatter
    z += 0.6 * np.exp(-((x - 54.5) / 0.6) ** 2)        # spatter ring next to the hole
    z += 0.6 * np.exp(-((x - 65.5) / 0.6) ** 2)
    return z
fig, axs = plt.subplots(2, 1, figsize=(16, 11), dpi=100, gridspec_kw={'hspace': 0.42})
fig.suptitle('All inside boundary & Exclude raised – plate cross-section', fontsize=22, fontweight='bold', y=0.975)
for ax, on in zip(axs, [False, True]):
    x = np.linspace(2, 98, 1100); z = surface(x)
    hole = (x > 56) & (x < 64); boss = (x > 77) & (x < 89)
    xs, zs = x[~hole & ~boss], z[~hole & ~boss]
    # part body
    ax.add_patch(Rectangle((2, -10), 54, 10, color='#d9dee4', zorder=0)); ax.add_patch(Rectangle((64, -10), 34, 10, color='#d9dee4', zorder=0))
    ax.add_patch(Rectangle((79, 0), 8, 5, color='#d9dee4', zorder=0))
    # band ± search distance
    ax.axhspan(-BAND, BAND, xmin=0, xmax=1, color='#1e88e5', alpha=0.08, zorder=1)
    ax.axhline(BAND, color='#1e88e5', ls='--', lw=1.2); ax.axhline(-BAND, color='#1e88e5', ls='--', lw=1.2)
    # plane points (kept), incl. bumps/spatter
    keep = ~((xs > 76) & (xs < 90))
    ax.scatter(xs[keep], zs[keep], s=7, color='#2e7d32', zorder=3, label='Plane points inside the outer contour – kept (incl. bumps, spatter)')
    # boss: fillet foot + walls + top (magenta), walls above the band never count
    fx = np.concatenate([np.linspace(76, 79, 30), np.linspace(87, 90, 30)]); fz = np.concatenate([0.5 * np.exp(-((fx[:30] - 79) / 1.2) ** 2) * 2, 0.5 * np.exp(-((fx[30:] - 87) / 1.2) ** 2) * 2])
    wz = np.linspace(0, 5, 40); top = np.linspace(79, 87, 60)
    bx = np.concatenate([fx, np.full(40, 79), np.full(40, 87), top]); bz = np.concatenate([fz, wz, wz, np.full(60, 5) + rng.normal(0, 0.03, 60)])
    inb = np.abs(bz) <= BAND
    if on: ax.scatter(bx[inb], bz[inb], s=16, color='#d81b60', marker='x', alpha=0.5, zorder=4)
    else: ax.scatter(bx[inb], bz[inb], s=10, color='#d81b60', zorder=4, label='Raised feature (boss) points in the band – magenta: count to the plane when OFF, excluded (×) when ON')
    ax.scatter(bx[~inb], bz[~inb], s=7, color='#bbbbbb', zorder=2, label='Outside the band – never part of the plane')
    if on:
        ax.add_patch(Rectangle((75.5, -1.6), 15, 7.2, fill=False, ec='#d81b60', lw=2.2, ls='-', zorder=5))
        ax.text(83, 6.1, 'excluded as a whole', ha='center', color='#d81b60', fontsize=13, fontweight='bold')
    # through hole walls
    hw = np.linspace(-9.5, 0, 50)
    ax.scatter(np.concatenate([np.full(50, 56), np.full(50, 64)]), np.concatenate([hw, hw]), s=7, color='#9e9e9e', zorder=2)
    ax.text(60, -6.2, 'through hole:\nno surface, walls deeper\nthan the band → excluded', ha='center', va='center', fontsize=11.5, color='#444', bbox=dict(boxstyle='round,pad=0.3', fc='white', ec='#bbb'), zorder=6)
    # outer contour
    for xc in (2, 98): ax.axvline(xc, color='#1565c0', lw=3)
    ax.text(3, -8.7, 'outer contour', color='#1565c0', fontsize=13, fontweight='bold'); ax.text(97, -8.7, 'outer contour', color='#1565c0', fontsize=13, fontweight='bold', ha='right')
    ax.annotate('bump', (18, 1.3), (14, 3.6), fontsize=12, arrowprops=dict(arrowstyle='->', color='#333'))
    ax.annotate('spatter', (30, 0.9), (32, 3.6), fontsize=12, arrowprops=dict(arrowstyle='->', color='#333'))
    ax.annotate('spatter ring', (54.5, 0.7), (44, 3.6), fontsize=12, arrowprops=dict(arrowstyle='->', color='#333'))
    ax.annotate('', (42, BAND), (42, -BAND), arrowprops=dict(arrowstyle='<->', color='#1e88e5', lw=1.5))
    ax.text(42.6, -1.5, '± search distance', color='#1e88e5', fontsize=12)
    ax.set_xlim(0, 100); ax.set_ylim(-10, 7.5); ax.set_xticks([]); ax.set_yticks([]); ax.set_aspect('auto')
    for s in ax.spines.values(): s.set_visible(False)
    ax.set_title(f'Exclude raised: {"ON – the boss is removed (flatness of the plane alone)" if on else "OFF (default) – everything inside the contour and the band counts, e.g. flatness incl. bumps/spatter"}', fontsize=15, loc='left')
axs[0].legend(loc='upper left', bbox_to_anchor=(0.0, -0.02), fontsize=12, frameon=True, ncol=1)
fig.text(0.5, 0.035, 'Region growing only finds the outer contour; then every point inside it within ± search distance belongs to the plane.\nOnly true openings stay out. Raised features (boss, sphere, step) are shown magenta and removed only with “Exclude raised”.',
         ha='center', va='center', fontsize=14, bbox=dict(boxstyle='round,pad=0.6', fc='#eef2f7', ec='#8a99aa'))
fig.savefig('public/docs/fill_raised.png', dpi=100); print('ok')
