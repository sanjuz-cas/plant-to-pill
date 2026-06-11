"""Render 3 visual mockups of the species tree for design review.

Reads data/species_tree.json and produces 3 PNGs in data/mockups/:
    A_rectangular.png   — sober scientific dendrogram
    B_radial.png        — iconic radial cladogram
    C_dendro_heatmap.png— dendrogram + reordered distance heatmap

All mockups use the editorial Carbon palette (paper background,
JetBrains Mono if available, kingdom-colored labels) so we can judge
which design slots best into the demo's visual identity.
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
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
GRID = "#e5e3da"

KINGDOM_COLOR = {
    "vertebrates":   "#1f1f1d",
    "invertebrates": "#7a6242",
    "plants":        "#317f3f",
    "fungi":         "#a9762f",
    "bacteria":      "#b00020",
    "viruses":       "#2c5aa0",
}

# Try JetBrains Mono if installed; fall back to a system mono otherwise.
def setup_font():
    for name in ("JetBrains Mono", "JetBrainsMono", "Menlo", "Monaco", "DejaVu Sans Mono"):
        if any(name in f.name for f in font_manager.fontManager.ttflist):
            plt.rcParams["font.family"] = name
            return name
    return "monospace"

setup_font()
plt.rcParams["axes.facecolor"] = PAPER
plt.rcParams["figure.facecolor"] = PAPER
plt.rcParams["savefig.facecolor"] = PAPER
plt.rcParams["axes.edgecolor"] = INK
plt.rcParams["axes.labelcolor"] = INK
plt.rcParams["xtick.color"] = MUTED
plt.rcParams["ytick.color"] = INK


def load_tree():
    with open(os.path.join(DATA, "species_tree.json")) as f:
        return json.load(f)


# ---------- A. Rectangular editorial dendrogram ----------

def render_rectangular(tree, path):
    species = tree["species"]
    kingdom = dict(zip(species, tree["kingdom"]))
    Z = np.array(tree["linkage_ward"])

    fig, ax = plt.subplots(figsize=(11, 9))
    ddata = dendrogram(
        Z,
        labels=species,
        ax=ax,
        orientation="right",
        leaf_font_size=12,
        color_threshold=0,
        above_threshold_color=MUTED,
    )
    ax.set_xlabel("cosine distance between mean embeddings", fontsize=10, color=MUTED)
    for tick in ax.get_yticklabels():
        sp = tick.get_text()
        tick.set_color(KINGDOM_COLOR.get(kingdom.get(sp), INK))
        tick.set_fontsize(12)

    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(axis="x", which="both", colors=MUTED, labelsize=9)
    ax.tick_params(axis="y", which="both", length=0)
    ax.grid(axis="x", linestyle=":", color=GRID, alpha=0.7)
    ax.set_axisbelow(True)

    fig.text(
        0.05, 0.97,
        "§7 · CARBON SPECIES TREE",
        color="#317f3f", fontsize=10, fontweight="bold",
    )
    fig.text(
        0.05, 0.93,
        "Hierarchical clustering of mean embeddings — Ward linkage on cosine distances",
        color=INK, fontsize=14,
    )
    fig.text(
        0.05, 0.905,
        f"{tree['n_total_points']:,} sequences · {len(species)} species · {tree['dim']}-dim embeddings from Carbon-3B",
        color=MUTED, fontsize=10,
    )

    legend_y = 0.86
    legend_x = 0.05
    for kname, kcolor in KINGDOM_COLOR.items():
        fig.text(legend_x, legend_y, "■", color=kcolor, fontsize=11)
        fig.text(legend_x + 0.018, legend_y, kname, color=INK, fontsize=9)
        legend_x += 0.13

    plt.tight_layout(rect=[0, 0, 1, 0.85])
    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)


# ---------- B. Radial cladogram ----------

def render_radial(tree, path):
    species = tree["species"]
    kingdom = dict(zip(species, tree["kingdom"]))
    Z = np.array(tree["linkage_ward"])
    n = len(species)

    ddata = dendrogram(Z, no_plot=True, labels=species)
    leaf_order = ddata["ivl"]
    leaf_to_angle = {sp: 2 * np.pi * i / len(leaf_order) for i, sp in enumerate(leaf_order)}

    icoord = np.array(ddata["icoord"])
    dcoord = np.array(ddata["dcoord"])
    max_d = dcoord.max()
    icoord_norm = (icoord - icoord.min()) / (icoord.max() - icoord.min())

    fig = plt.figure(figsize=(11, 11))
    ax = fig.add_subplot(111, projection="polar")
    ax.set_facecolor(PAPER)
    ax.set_theta_zero_location("N")
    ax.set_theta_direction(-1)
    ax.set_rlim(0, max_d * 1.35)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.spines["polar"].set_visible(False)
    ax.grid(False)

    for xs, ys in zip(icoord, dcoord):
        a = [2 * np.pi * (x - icoord.min()) / (icoord.max() - icoord.min()) for x in xs]
        r = ys
        ax.plot([a[0], a[1]], [r[0], r[1]], color=MUTED, lw=1)
        n_seg = 60
        arc_a = np.linspace(a[1], a[2], n_seg)
        ax.plot(arc_a, [r[1]] * n_seg, color=MUTED, lw=1)
        ax.plot([a[2], a[3]], [r[2], r[3]], color=MUTED, lw=1)

    label_r = max_d * 1.05
    for sp in leaf_order:
        a = leaf_to_angle[sp]
        deg = np.degrees(a)
        rotation = -deg if deg <= 180 else -deg + 180
        ha = "left" if deg <= 180 else "right"
        ax.text(
            a, label_r, "  " + sp + "  ",
            color=KINGDOM_COLOR.get(kingdom.get(sp), INK),
            fontsize=11, ha=ha, va="center",
            rotation=rotation, rotation_mode="anchor",
        )

    fig.text(
        0.5, 0.97,
        "§7 · CARBON TREE OF LIFE",
        color="#317f3f", fontsize=10, fontweight="bold",
        ha="center",
    )
    fig.text(
        0.5, 0.94,
        "27 species clustered by mean embedding similarity",
        color=INK, fontsize=14, ha="center",
    )
    fig.text(
        0.5, 0.92,
        f"{tree['n_total_points']:,} sequences · {tree['dim']}-dim · cosine distance, Ward linkage",
        color=MUTED, fontsize=9, ha="center",
    )

    legend_y = 0.04
    legend_x = 0.5 - 0.4
    for kname, kcolor in KINGDOM_COLOR.items():
        fig.text(legend_x, legend_y, "■", color=kcolor, fontsize=11)
        fig.text(legend_x + 0.018, legend_y, kname, color=INK, fontsize=9)
        legend_x += 0.13

    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)


# ---------- C. Dendrogram + reordered heatmap ----------

def render_dendro_heatmap(tree, path):
    species = tree["species"]
    kingdom = dict(zip(species, tree["kingdom"]))
    Z = np.array(tree["linkage_ward"])
    D = np.array(tree["distance_matrix"])

    ddata = dendrogram(Z, no_plot=True, labels=species)
    order_labels = ddata["ivl"]
    sp_to_idx = {sp: i for i, sp in enumerate(species)}
    order_idx = [sp_to_idx[sp] for sp in order_labels]
    D_reordered = D[np.ix_(order_idx, order_idx)]

    fig = plt.figure(figsize=(15, 9.5))
    gs = fig.add_gridspec(1, 2, width_ratios=[1, 1.3], wspace=0.05)
    ax_dendro = fig.add_subplot(gs[0])
    ax_heat = fig.add_subplot(gs[1])

    dendrogram(
        Z, labels=species, ax=ax_dendro,
        orientation="right", leaf_font_size=11,
        color_threshold=0, above_threshold_color=MUTED,
    )
    for tick in ax_dendro.get_yticklabels():
        sp = tick.get_text()
        tick.set_color(KINGDOM_COLOR.get(kingdom.get(sp), INK))
    ax_dendro.set_xlabel("cosine distance", fontsize=9, color=MUTED)
    for spine in ("top", "right", "left"):
        ax_dendro.spines[spine].set_visible(False)
    ax_dendro.spines["bottom"].set_color(GRID)
    ax_dendro.tick_params(axis="x", colors=MUTED, labelsize=8)
    ax_dendro.tick_params(axis="y", length=0)
    ax_dendro.grid(axis="x", linestyle=":", color=GRID, alpha=0.7)
    ax_dendro.set_axisbelow(True)

    cmap = plt.cm.get_cmap("YlOrBr_r") if hasattr(plt.cm, "get_cmap") else matplotlib.colormaps["YlOrBr_r"]
    im = ax_heat.imshow(
        D_reordered, cmap=cmap, aspect="equal",
        vmin=0, vmax=D.max(),
        interpolation="nearest",
    )
    ax_heat.set_xticks(range(len(order_labels)))
    ax_heat.set_xticklabels(order_labels, rotation=90, fontsize=9)
    ax_heat.set_yticks([])
    for tick in ax_heat.get_xticklabels():
        sp = tick.get_text()
        tick.set_color(KINGDOM_COLOR.get(kingdom.get(sp), INK))
    for spine in ax_heat.spines.values():
        spine.set_visible(False)
    ax_heat.tick_params(axis="both", length=0)

    cbar = fig.colorbar(im, ax=ax_heat, fraction=0.025, pad=0.02)
    cbar.set_label("cosine distance", fontsize=8, color=MUTED)
    cbar.ax.tick_params(colors=MUTED, labelsize=7)
    cbar.outline.set_visible(False)

    fig.text(
        0.05, 0.97,
        "§7 · CARBON SPECIES TREE",
        color="#317f3f", fontsize=10, fontweight="bold",
    )
    fig.text(
        0.05, 0.94,
        "Dendrogram + pairwise cosine distance heatmap",
        color=INK, fontsize=14,
    )
    fig.text(
        0.05, 0.92,
        f"{tree['n_total_points']:,} sequences · {len(species)} species · "
        "Ward linkage · cells reordered to match the tree",
        color=MUTED, fontsize=9,
    )

    legend_y = 0.045
    legend_x = 0.05
    for kname, kcolor in KINGDOM_COLOR.items():
        fig.text(legend_x, legend_y, "■", color=kcolor, fontsize=11)
        fig.text(legend_x + 0.018, legend_y, kname, color=INK, fontsize=9)
        legend_x += 0.10

    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)


def main():
    tree = load_tree()
    a = os.path.join(OUT, "A_rectangular.png")
    b = os.path.join(OUT, "B_radial.png")
    c = os.path.join(OUT, "C_dendro_heatmap.png")
    print(f"rendering → {a}"); render_rectangular(tree, a)
    print(f"rendering → {b}"); render_radial(tree, b)
    print(f"rendering → {c}"); render_dendro_heatmap(tree, c)
    print(f"\ndone. open {OUT}/")


if __name__ == "__main__":
    main()
