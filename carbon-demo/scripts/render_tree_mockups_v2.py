"""Round 2 of species tree mockups, focusing on visual quality.

D. tree + alignment tracks (iTOL / Nature 2025 style)
E. editorial Hillis (rounded thick branches, airy)
F. radial with kingdom arcs as background bands
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.path import Path
from matplotlib import font_manager
import numpy as np
from scipy.cluster.hierarchy import dendrogram, leaves_list

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
OUT = os.path.join(DATA, "mockups")
os.makedirs(OUT, exist_ok=True)

PAPER = "#fbfaf6"
INK = "#1f1f1d"
MUTED = "#888888"
SOFT = "#bbb8ad"
GRID = "#e5e3da"

# Less saturated kingdom palette (Krzywinski-style: muted, only one accent)
KINGDOM_COLOR = {
    "vertebrates":   "#1f1f1d",  # ink (the "main" cohort)
    "invertebrates": "#7a6242",
    "plants":        "#317f3f",
    "fungi":         "#a9762f",
    "bacteria":      "#b00020",
    "viruses":       "#2c5aa0",
}
# Very pale background tints for kingdom bands
KINGDOM_BG = {
    "vertebrates":   "#ecebe5",
    "invertebrates": "#ece4d6",
    "plants":        "#e3eee2",
    "fungi":         "#f1e7d2",
    "bacteria":      "#f3dcd8",
    "viruses":       "#dde5f0",
}


def setup_font():
    for name in ("JetBrains Mono", "Menlo", "Monaco", "DejaVu Sans Mono"):
        if any(name in f.name for f in font_manager.fontManager.ttflist):
            plt.rcParams["font.family"] = name
            return
setup_font()
plt.rcParams["axes.facecolor"] = PAPER
plt.rcParams["figure.facecolor"] = PAPER
plt.rcParams["savefig.facecolor"] = PAPER

NCBI_VERTEBRATE_ORDER = [
    "human", "macaque", "mouse", "rat", "dog", "cow", "pig",
    "chicken", "frog", "zebrafish",
]


def load_tree():
    with open(os.path.join(DATA, "species_tree.json")) as f:
        return json.load(f)


# ----------------------------------------------------------------------
# D. tree + alignment tracks (iTOL / Nature)
# ----------------------------------------------------------------------

def render_tree_with_tracks(tree, path):
    species = tree["species"]
    kingdom = dict(zip(species, tree["kingdom"]))
    counts = dict(zip(species, tree["counts"]))
    Z = np.array(tree["linkage_ward"])

    # Resolve dendrogram leaf order for vertical alignment
    ddata = dendrogram(Z, no_plot=True, labels=species)
    leaf_order = ddata["ivl"]

    # Build figure with: tree (left) | label | kingdom chip | count bar
    fig = plt.figure(figsize=(13, 9))
    gs = fig.add_gridspec(
        1, 4, width_ratios=[5, 2.5, 0.7, 3.0], wspace=0.05,
    )
    ax_tree = fig.add_subplot(gs[0])
    ax_label = fig.add_subplot(gs[1], sharey=ax_tree)
    ax_chip = fig.add_subplot(gs[2], sharey=ax_tree)
    ax_count = fig.add_subplot(gs[3], sharey=ax_tree)

    # Tree (rectangular, right-oriented)
    dendrogram(
        Z, ax=ax_tree, orientation="right",
        labels=species, color_threshold=0,
        above_threshold_color=SOFT, no_labels=True,
        link_color_func=lambda k: SOFT,
    )
    ax_tree.set_xlabel("cosine distance", fontsize=8, color=MUTED)
    for spine in ("top", "right", "left"):
        ax_tree.spines[spine].set_visible(False)
    ax_tree.spines["bottom"].set_color(GRID)
    ax_tree.tick_params(axis="x", colors=MUTED, labelsize=7, length=2)
    ax_tree.tick_params(axis="y", length=0, labelleft=False)
    ax_tree.grid(axis="x", linestyle=":", color=GRID, alpha=0.7)
    ax_tree.set_axisbelow(True)
    ax_tree.invert_xaxis()  # tip on the right, root on the left

    # Each leaf y-position from dendrogram is 5, 15, 25... (5 + 10*i)
    n = len(leaf_order)
    leaf_y = [5 + 10 * i for i in range(n)]
    leaf_to_y = dict(zip(leaf_order, leaf_y))

    # Label column
    ax_label.set_xlim(0, 1)
    ax_label.set_ylim(0, n * 10)
    ax_label.invert_yaxis()
    for i, sp in enumerate(leaf_order):
        ax_label.text(
            0.05, leaf_y[i], sp,
            color=KINGDOM_COLOR.get(kingdom.get(sp), INK),
            fontsize=12, ha="left", va="center",
        )
    ax_label.axis("off")

    # Kingdom chip column (filled square)
    ax_chip.set_xlim(0, 1)
    ax_chip.set_ylim(0, n * 10)
    ax_chip.invert_yaxis()
    for i, sp in enumerate(leaf_order):
        kc = KINGDOM_COLOR.get(kingdom.get(sp), INK)
        ax_chip.add_patch(mpatches.Rectangle(
            (0.25, leaf_y[i] - 3), 0.5, 6,
            facecolor=kc, edgecolor="none",
        ))
    ax_chip.axis("off")

    # Count bar column (log scale because human=59K, hiv1=10)
    max_count = max(counts.values())
    log_max = np.log10(max_count + 1)
    ax_count.set_xlim(0, log_max * 1.05)
    ax_count.set_ylim(0, n * 10)
    ax_count.invert_yaxis()
    for i, sp in enumerate(leaf_order):
        c = counts.get(sp, 0)
        log_c = np.log10(c + 1)
        ax_count.add_patch(mpatches.Rectangle(
            (0, leaf_y[i] - 3), log_c, 6,
            facecolor="#d8d5c8", edgecolor="none",
        ))
        ax_count.text(
            log_c + 0.05, leaf_y[i], f"{c:,}",
            color=MUTED, fontsize=9, ha="left", va="center",
        )
    for spine in ax_count.spines.values():
        spine.set_visible(False)
    ax_count.tick_params(axis="both", length=0, labelleft=False, labelbottom=False)
    ax_count.set_xlabel("sequences (log)", fontsize=8, color=MUTED)

    # Header
    fig.text(
        0.06, 0.96,
        "§7  ·  CARBON SPECIES TREE",
        color="#317f3f", fontsize=10, fontweight="bold",
    )
    fig.text(
        0.06, 0.93,
        "Hierarchical clustering of mean Carbon-3B embeddings",
        color=INK, fontsize=15,
    )
    fig.text(
        0.06, 0.91,
        f"{tree['n_total_points']:,} sequences  ·  {n} species  ·  {tree['dim']}-dim  ·  cosine, Ward linkage",
        color=MUTED, fontsize=9,
    )

    # Footer kingdom legend
    legend_y = 0.04
    legend_x = 0.06
    for kname, kcolor in KINGDOM_COLOR.items():
        fig.text(legend_x, legend_y, "■", color=kcolor, fontsize=11)
        fig.text(legend_x + 0.018, legend_y, kname, color=INK, fontsize=9)
        legend_x += 0.10

    plt.tight_layout(rect=[0.05, 0.06, 0.97, 0.89])
    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)


# ----------------------------------------------------------------------
# E. editorial Hillis (thick rounded branches, airy)
# ----------------------------------------------------------------------

def _draw_link_curved(ax, x0, y0, x1, y1, color, lw):
    """Draw a Bezier elbow that's softly rounded at the corner."""
    # path: from (x0, y0) to (x1, y0) to (x1, y1) — but we round the corner
    # by injecting two control points.
    r = min(abs(x1 - x0), abs(y1 - y0)) * 0.18
    if x1 > x0:
        cx = x1 - r
    else:
        cx = x1 + r
    if y1 > y0:
        cy = y0 + r
    else:
        cy = y0 - r
    verts = [
        (x0, y0),
        (cx, y0),
        (x1, y0),
        (x1, cy),
        (x1, y1),
    ]
    codes = [Path.MOVETO, Path.LINETO, Path.CURVE3, Path.CURVE3, Path.LINETO]
    p = Path(verts, codes)
    ax.add_patch(mpatches.PathPatch(
        p, facecolor="none", edgecolor=color, lw=lw, capstyle="round",
        joinstyle="round",
    ))


def render_editorial_hillis(tree, path):
    species = tree["species"]
    kingdom = dict(zip(species, tree["kingdom"]))
    Z = np.array(tree["linkage_ward"])

    ddata = dendrogram(Z, no_plot=True, labels=species)
    icoord = np.array(ddata["icoord"])
    dcoord = np.array(ddata["dcoord"])
    leaf_order = ddata["ivl"]
    n = len(leaf_order)

    fig, ax = plt.subplots(figsize=(13, 10.5))
    ax.set_facecolor(PAPER)

    max_d = dcoord.max()

    # Each row in icoord/dcoord is a "U" between two children.
    # icoord = [xL, xL, xR, xR], dcoord = [yChildL, yMerge, yMerge, yChildR]
    # In right-orientation we'd swap; here we'll convert ourselves:
    #   tree grows left to right. x = distance, y = leaf position.
    for xs, ys in zip(icoord, dcoord):
        x_left, x_right = ys[1], 0  # branches go from merge dist to 0 (tips)
        y_top, y_bot = xs[0], xs[3]
        y_merge = xs[1]  # = xs[2]
        # vertical bar at the merge
        ax.plot([ys[1], ys[1]], [y_top, y_bot], color=INK, lw=2.4,
                solid_capstyle="round")
        # horizontal arms at children depth
        ax.plot([ys[0], ys[1]], [y_top, y_top], color=INK, lw=2.4,
                solid_capstyle="round")
        ax.plot([ys[3], ys[2]], [y_bot, y_bot], color=INK, lw=2.4,
                solid_capstyle="round")

    # Leaf positions: dendrogram puts leaves at y = 5 + 10*i in icoord-space
    leaf_y = [5 + 10 * i for i in range(n)]
    label_x = -max_d * 0.04  # a touch left of x=0
    for i, sp in enumerate(leaf_order):
        kc = KINGDOM_COLOR.get(kingdom.get(sp), INK)
        ax.text(
            label_x, leaf_y[i], sp,
            color=kc, fontsize=14, ha="right", va="center",
            fontstyle="italic",
        )

    ax.set_xlim(-max_d * 0.30, max_d * 1.05)
    ax.set_ylim(-5, n * 10 + 5)
    ax.invert_yaxis()
    ax.invert_xaxis()  # root on the right? no — tips on the left, root right
    # Wait: we want tips on the LEFT (label side). dcoord==0 is the tip,
    # max_d is the root. So tip x=0 should be on the LEFT, root max_d on the
    # RIGHT. Standard horizontal x-axis already does that. Don't invert.
    ax.invert_xaxis()  # undo the previous invert
    # But we want labels on the LEFT, so leaf x=0 is on the LEFT, root max_d
    # is on the RIGHT. That's the default. Good.

    for spine in ("top", "right", "left", "bottom"):
        ax.spines[spine].set_visible(False)
    ax.set_xticks([])
    ax.set_yticks([])

    # Distance scale at bottom
    bar_y = n * 10 + 8
    bar_x_start = 0
    bar_x_end = max_d * 0.5
    ax.plot([bar_x_start, bar_x_end], [bar_y, bar_y], color=MUTED, lw=1)
    ax.text((bar_x_start + bar_x_end) / 2, bar_y + 4,
            f"{bar_x_end:.4f} cosine distance",
            color=MUTED, fontsize=8, ha="center", va="top")
    ax.set_ylim(-5, n * 10 + 18)
    ax.invert_yaxis()

    # Header
    fig.text(
        0.05, 0.96,
        "§7  ·  CARBON TREE OF LIFE",
        color="#317f3f", fontsize=10, fontweight="bold",
    )
    fig.text(
        0.05, 0.93,
        "What 571,810 sequences taught the model about who's related to whom",
        color=INK, fontsize=16,
    )
    fig.text(
        0.05, 0.91,
        f"Mean-pooled Carbon-3B embeddings, hierarchically clustered (Ward, cosine)",
        color=MUTED, fontsize=10,
    )

    legend_y = 0.04
    legend_x = 0.05
    for kname, kcolor in KINGDOM_COLOR.items():
        fig.text(legend_x, legend_y, "●", color=kcolor, fontsize=12)
        fig.text(legend_x + 0.013, legend_y, kname, color=INK, fontsize=10)
        legend_x += 0.115

    plt.tight_layout(rect=[0.04, 0.06, 0.96, 0.89])
    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)


# ----------------------------------------------------------------------
# F. radial with kingdom background bands
# ----------------------------------------------------------------------

def render_radial_bands(tree, path):
    species = tree["species"]
    kingdom = dict(zip(species, tree["kingdom"]))
    Z = np.array(tree["linkage_ward"])

    ddata = dendrogram(Z, no_plot=True, labels=species)
    leaf_order = ddata["ivl"]
    n = len(leaf_order)
    icoord = np.array(ddata["icoord"])
    dcoord = np.array(ddata["dcoord"])
    max_d = dcoord.max()

    # Leaf x is at 5 + 10*i in icoord. Map any icoord-x to angle.
    icoord_min, icoord_max = icoord.min(), icoord.max()
    def x_to_angle(x):
        return 2 * np.pi * (x - icoord_min) / (icoord_max - icoord_min)

    fig = plt.figure(figsize=(12, 12))
    ax = fig.add_subplot(111, projection="polar")
    ax.set_facecolor(PAPER)
    ax.set_theta_zero_location("N")
    ax.set_theta_direction(-1)
    ax.set_rlim(0, max_d * 1.55)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.spines["polar"].set_visible(False)
    ax.grid(False)

    # ----- background kingdom bands -----
    # find contiguous runs of same kingdom in leaf_order
    band_inner = max_d * 1.10
    band_outer = max_d * 1.50
    # Compute leaf angles
    leaf_angles = [x_to_angle(5 + 10 * i) for i in range(n)]
    # Also a half-step on each side so the band covers the leaf cleanly
    half_step = (2 * np.pi / n) / 2

    runs = []  # list of (kingdom, start_angle, end_angle)
    i = 0
    while i < n:
        k = kingdom.get(leaf_order[i])
        j = i
        while j + 1 < n and kingdom.get(leaf_order[j + 1]) == k:
            j += 1
        a0 = leaf_angles[i] - half_step
        a1 = leaf_angles[j] + half_step
        runs.append((k, a0, a1))
        i = j + 1
    # draw filled wedges
    for k, a0, a1 in runs:
        if k is None:
            continue
        n_seg = 64
        thetas = np.linspace(a0, a1, n_seg)
        # outer arc forward, inner arc backward → closed polygon
        rs_outer = np.full(n_seg, band_outer)
        rs_inner = np.full(n_seg, band_inner)
        thetas_full = np.concatenate([thetas, thetas[::-1]])
        rs_full = np.concatenate([rs_outer, rs_inner])
        ax.fill(thetas_full, rs_full,
                facecolor=KINGDOM_BG.get(k, "#eee"),
                edgecolor="none", zorder=1)

    # ----- tree branches -----
    for xs, ys in zip(icoord, dcoord):
        a = [x_to_angle(x) for x in xs]
        # children verticals (in radial: arc segment along y at constant r)
        ax.plot([a[0], a[0]], [ys[0], ys[1]], color=INK, lw=1.6, zorder=2)
        ax.plot([a[3], a[3]], [ys[3], ys[2]], color=INK, lw=1.6, zorder=2)
        # merge horizontal: arc at radius ys[1]
        n_seg = 60
        arc_a = np.linspace(a[0], a[3], n_seg)
        ax.plot(arc_a, np.full(n_seg, ys[1]), color=INK, lw=1.6, zorder=2)

    # ----- labels in periphery, oriented radially -----
    label_r = max_d * 1.08
    for i, sp in enumerate(leaf_order):
        a = leaf_angles[i]
        deg = np.degrees(a) % 360
        if deg <= 180:
            ha, rotation = "left", -deg
        else:
            ha, rotation = "right", -deg + 180
        ax.text(
            a, label_r, sp,
            color=KINGDOM_COLOR.get(kingdom.get(sp), INK),
            fontsize=11, ha=ha, va="center",
            rotation=rotation, rotation_mode="anchor",
            zorder=3,
        )

    # ----- header (text outside polar axes via figure coords) -----
    fig.text(
        0.5, 0.98,
        "§7  ·  CARBON TREE OF LIFE",
        color="#317f3f", fontsize=10, fontweight="bold",
        ha="center",
    )
    fig.text(
        0.5, 0.955,
        "27 species clustered by mean embedding similarity",
        color=INK, fontsize=15, ha="center",
    )
    fig.text(
        0.5, 0.935,
        f"{tree['n_total_points']:,} sequences  ·  {tree['dim']}-dim  ·  cosine, Ward linkage",
        color=MUTED, fontsize=9, ha="center",
    )

    legend_y = 0.03
    legend_x = 0.5 - 0.45
    for kname, kcolor in KINGDOM_COLOR.items():
        fig.text(legend_x, legend_y, "●", color=kcolor, fontsize=12)
        fig.text(legend_x + 0.013, legend_y, kname, color=INK, fontsize=9)
        legend_x += 0.13

    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)


def main():
    tree = load_tree()
    d = os.path.join(OUT, "D_tree_with_tracks.png")
    e = os.path.join(OUT, "E_editorial_hillis.png")
    f = os.path.join(OUT, "F_radial_bands.png")
    print(f"rendering → {d}"); render_tree_with_tracks(tree, d)
    print(f"rendering → {e}"); render_editorial_hillis(tree, e)
    print(f"rendering → {f}"); render_radial_bands(tree, f)
    print(f"\nDone. Open {OUT}/")


if __name__ == "__main__":
    main()
