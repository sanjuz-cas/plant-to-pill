"""D++ : the chosen direction polished.

  · tree as a thin spine on the left, branches drawn as soft Bezier curves
  · subtle kingdom background bands behind each species row
  · 4 alignment tracks: italic species name + kingdom chip
                      + log-scaled sequence count bar
                      + NCBI agreement chip (vert / ambre / rouge)
  · header carries the global "X / N species cluster with their NCBI sister"
    score so the reader knows immediately how well the embedding matches biology
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
from scipy.cluster.hierarchy import dendrogram

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
OUT = os.path.join(DATA, "mockups")
os.makedirs(OUT, exist_ok=True)

PAPER = "#fbfaf6"
INK = "#1f1f1d"
MUTED = "#888888"
SOFT = "#bbb8ad"
GRID = "#e5e3da"

KINGDOM_COLOR = {
    "vertebrates":   "#1f1f1d",
    "invertebrates": "#7a6242",
    "plants":        "#317f3f",
    "fungi":         "#a9762f",
    "bacteria":      "#b00020",
    "viruses":       "#2c5aa0",
}
KINGDOM_BG = {
    "vertebrates":   "#f0eee5",
    "invertebrates": "#f1ebde",
    "plants":        "#e9f1e6",
    "fungi":         "#f5ecd9",
    "bacteria":      "#f5e2dd",
    "viruses":       "#e3eaf3",
}

# Canonical NCBI clade for each species. Two species sharing a clade
# value = sister (or near-sister) groups in standard taxonomy.
EXPECTED_CLADE = {
    "human":         "primates",
    "macaque":       "primates",
    "mouse":         "rodents",
    "rat":           "rodents",
    "dog":           "laurasiatheria",
    "cow":           "laurasiatheria",
    "pig":           "laurasiatheria",
    "chicken":       "sauropsida",
    "frog":          "amphibia",      # solo
    "zebrafish":     "actinopterygii",  # solo
    "fly":           "insects",        # solo
    "worm":          "nematodes",      # solo
    "arabidopsis":   "dicots",
    "tomato":        "dicots",
    "soybean":       "dicots",
    "rice":          "monocots",
    "maize":         "monocots",
    "yeast":         "saccharomycetes",
    "candida":       "saccharomycetes",
    "fission_yeast": "schizosaccharomycetes",  # solo
    "neurospora":    "pezizomycotina",
    "aspergillus":   "pezizomycotina",
    "ecoli":         "proteobacteria",  # solo
    "bsubtilis":     "firmicutes",
    "saureus":       "firmicutes",
    "sarscov2":      "rna_viruses",
    "hiv1":          "rna_viruses",
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


def load_tree():
    with open(os.path.join(DATA, "species_tree.json")) as f:
        return json.load(f)


def compute_ncbi_agreement(species, distance_matrix):
    """For each species, check whether its nearest neighbor in Carbon
    embedding space shares its NCBI clade.

    Returns: dict species -> ('match' | 'mismatch' | 'solo')
        'solo' = no other species in the dataset shares its clade,
                  so agreement is undefined (we display a neutral chip).
    """
    D = np.array(distance_matrix)
    sp_to_idx = {sp: i for i, sp in enumerate(species)}
    # Group species by clade
    clade_members = {}
    for sp in species:
        clade_members.setdefault(EXPECTED_CLADE.get(sp), []).append(sp)

    out = {}
    for sp in species:
        clade = EXPECTED_CLADE.get(sp)
        peers = [s for s in clade_members.get(clade, []) if s != sp]
        if not peers:
            out[sp] = "solo"
            continue
        # nearest neighbor in carbon (excluding self)
        i = sp_to_idx[sp]
        d_row = D[i].copy()
        d_row[i] = np.inf
        j = int(np.argmin(d_row))
        nn = species[j]
        out[sp] = "match" if nn in peers else "mismatch"
    return out


def draw_curved_link(ax, x_top_arm, x_bot_arm, x_merge, y_top, y_bot, lw=1.6):
    """Draw a horizontal-tree link with smoothly rounded corners.

    The link is the standard "U" shape:
        (x_top_arm, y_top) -> (x_merge, y_top) -> (x_merge, y_bot) -> (x_bot_arm, y_bot)
    but we replace each corner with a quadratic Bezier so the branches feel
    organic instead of robotic.
    """
    # Choose a corner radius that's a small fraction of the shorter arm
    arm_top = abs(x_merge - x_top_arm)
    arm_bot = abs(x_merge - x_bot_arm)
    height  = abs(y_bot - y_top)
    r = min(arm_top, arm_bot, height) * 0.35
    r = max(r, 0.05 * min(arm_top, arm_bot, height))

    sign_y_top = 1 if y_bot > y_top else -1
    # x direction from arm to merge
    sign_x_top = 1 if x_merge > x_top_arm else -1
    sign_x_bot = 1 if x_merge > x_bot_arm else -1

    p_top_arm   = (x_top_arm, y_top)
    p_top_pre   = (x_merge - sign_x_top * r, y_top)
    p_top_corner = (x_merge, y_top)
    p_top_post  = (x_merge, y_top + sign_y_top * r)
    p_bot_pre   = (x_merge, y_bot - sign_y_top * r)
    p_bot_corner = (x_merge, y_bot)
    p_bot_post  = (x_merge - sign_x_bot * r, y_bot)
    p_bot_arm   = (x_bot_arm, y_bot)

    verts = [
        p_top_arm,
        p_top_pre, p_top_corner, p_top_post,
        p_bot_pre, p_bot_corner, p_bot_post,
        p_bot_arm,
    ]
    codes = [
        Path.MOVETO,
        Path.LINETO, Path.CURVE3, Path.CURVE3,
        Path.LINETO, Path.CURVE3, Path.CURVE3,
        Path.LINETO,
    ]
    p = Path(verts, codes)
    ax.add_patch(mpatches.PathPatch(
        p, facecolor="none", edgecolor=INK, lw=lw,
        capstyle="round", joinstyle="round",
    ))


def render(tree, path):
    species  = tree["species"]
    kingdom  = dict(zip(species, tree["kingdom"]))
    counts   = dict(zip(species, tree["counts"]))
    Z        = np.array(tree["linkage_ward"])

    agree = compute_ncbi_agreement(species, tree["distance_matrix"])
    n_match     = sum(1 for v in agree.values() if v == "match")
    n_mismatch  = sum(1 for v in agree.values() if v == "mismatch")
    n_evaluable = n_match + n_mismatch
    pct = 100 * n_match / max(n_evaluable, 1)

    ddata = dendrogram(Z, no_plot=True, labels=species)
    leaf_order = ddata["ivl"]
    icoord = np.array(ddata["icoord"])
    dcoord = np.array(ddata["dcoord"])
    n = len(leaf_order)

    # Layout:
    #   tree spine | name | chip | count bar | agreement chip
    fig = plt.figure(figsize=(13.5, 9.5))
    gs = fig.add_gridspec(
        1, 5,
        width_ratios=[3.5, 2.4, 0.5, 3.5, 1.2],
        wspace=0.04,
    )
    ax_tree = fig.add_subplot(gs[0])
    ax_name = fig.add_subplot(gs[1], sharey=ax_tree)
    ax_chip = fig.add_subplot(gs[2], sharey=ax_tree)
    ax_count = fig.add_subplot(gs[3], sharey=ax_tree)
    ax_ncbi = fig.add_subplot(gs[4], sharey=ax_tree)

    leaf_y = [5 + 10 * i for i in range(n)]

    # ---- background kingdom bands (very subtle) ----
    for ax in (ax_tree, ax_name, ax_chip, ax_count, ax_ncbi):
        for i, sp in enumerate(leaf_order):
            ax.axhspan(
                leaf_y[i] - 5, leaf_y[i] + 5,
                facecolor=KINGDOM_BG.get(kingdom.get(sp), "#fff"),
                edgecolor="none", zorder=0,
            )

    # ---- tree spine: rounded-corner branches ----
    for xs, ys in zip(icoord, dcoord):
        x_left, x_right = ys[1], 0
        y_top, y_bot = xs[0], xs[3]
        x_merge = ys[1]
        x_top_arm = ys[0]
        x_bot_arm = ys[3]
        draw_curved_link(
            ax_tree,
            x_top_arm=x_top_arm, x_bot_arm=x_bot_arm,
            x_merge=x_merge,
            y_top=y_top, y_bot=y_bot,
            lw=1.6,
        )
    ax_tree.set_xlim(dcoord.max() * 1.05, -dcoord.max() * 0.05)  # root left, tips right
    ax_tree.set_ylim(0, n * 10)
    ax_tree.invert_yaxis()
    ax_tree.set_xlabel("cosine distance", fontsize=8, color=MUTED)
    for spine in ("top", "right", "left"):
        ax_tree.spines[spine].set_visible(False)
    ax_tree.spines["bottom"].set_color(GRID)
    ax_tree.tick_params(axis="x", colors=MUTED, labelsize=7, length=2)
    ax_tree.tick_params(axis="y", length=0, labelleft=False)
    ax_tree.grid(axis="x", linestyle=":", color=GRID, alpha=0.5)
    ax_tree.set_axisbelow(True)

    # ---- name column (italic) ----
    ax_name.set_xlim(0, 1)
    ax_name.set_ylim(0, n * 10)
    ax_name.invert_yaxis()
    for i, sp in enumerate(leaf_order):
        ax_name.text(
            0.05, leaf_y[i], sp.replace("_", " "),
            color=KINGDOM_COLOR.get(kingdom.get(sp), INK),
            fontsize=12, ha="left", va="center",
            fontstyle="italic",
        )
    ax_name.axis("off")

    # ---- kingdom chip column ----
    ax_chip.set_xlim(0, 1)
    ax_chip.set_ylim(0, n * 10)
    ax_chip.invert_yaxis()
    for i, sp in enumerate(leaf_order):
        kc = KINGDOM_COLOR.get(kingdom.get(sp), INK)
        ax_chip.add_patch(mpatches.FancyBboxPatch(
            (0.2, leaf_y[i] - 2.3), 0.6, 4.6,
            boxstyle="round,pad=0,rounding_size=0.4",
            facecolor=kc, edgecolor="none",
        ))
    ax_chip.axis("off")

    # ---- count bar (log scale, with numeric tag) ----
    max_count = max(counts.values())
    log_max = np.log10(max_count + 1)
    ax_count.set_xlim(0, log_max * 1.3)
    ax_count.set_ylim(0, n * 10)
    ax_count.invert_yaxis()
    for i, sp in enumerate(leaf_order):
        c = counts.get(sp, 0)
        log_c = np.log10(c + 1)
        ax_count.add_patch(mpatches.FancyBboxPatch(
            (0, leaf_y[i] - 2.3), log_c, 4.6,
            boxstyle="round,pad=0,rounding_size=0.4",
            facecolor="#dcd9cd", edgecolor="none",
        ))
        ax_count.text(
            log_c + 0.08, leaf_y[i], f"{c:,}",
            color=MUTED, fontsize=9, ha="left", va="center",
        )
    ax_count.set_xlabel("sequences (log scale)", fontsize=8, color=MUTED)
    for spine in ax_count.spines.values():
        spine.set_visible(False)
    ax_count.tick_params(axis="both", length=0, labelleft=False, labelbottom=False)

    # ---- NCBI agreement column ----
    ax_ncbi.set_xlim(0, 1)
    ax_ncbi.set_ylim(0, n * 10)
    ax_ncbi.invert_yaxis()
    AGREE_COLOR = {
        "match":    "#317f3f",
        "mismatch": "#b00020",
        "solo":     "#cccac0",
    }
    AGREE_GLYPH = {
        "match":    "✓",
        "mismatch": "✗",
        "solo":     "—",
    }
    for i, sp in enumerate(leaf_order):
        a = agree.get(sp, "solo")
        ax_ncbi.text(
            0.5, leaf_y[i], AGREE_GLYPH[a],
            color=AGREE_COLOR[a], fontsize=14, fontweight="bold",
            ha="center", va="center",
        )
    ax_ncbi.set_xlabel("vs NCBI", fontsize=8, color=MUTED)
    for spine in ax_ncbi.spines.values():
        spine.set_visible(False)
    ax_ncbi.tick_params(axis="both", length=0, labelleft=False, labelbottom=False)

    # ---- header ----
    fig.text(
        0.06, 0.97,
        "§7  ·  CARBON SPECIES TREE",
        color="#317f3f", fontsize=10, fontweight="bold",
    )
    fig.text(
        0.06, 0.94,
        "Did Carbon learn the tree of life on its own ?",
        color=INK, fontsize=17,
    )
    fig.text(
        0.06, 0.915,
        f"{tree['n_total_points']:,} sequences  ·  {n} species  ·  {tree['dim']}-dim  ·  cosine, Ward linkage",
        color=MUTED, fontsize=10,
    )
    # Score chip top-right
    score_text = f"  {n_match}/{n_evaluable} species cluster with their NCBI sister  "
    fig.text(
        0.97, 0.965, score_text,
        color="#fff",
        fontsize=11, fontweight="bold",
        ha="right", va="center",
        bbox=dict(boxstyle="round,pad=0.45", facecolor="#317f3f", edgecolor="none"),
    )
    fig.text(
        0.97, 0.935, f"  ({pct:.0f}% agreement with NCBI Taxonomy)  ",
        color=MUTED, fontsize=9,
        ha="right", va="center",
    )

    # ---- footer legend ----
    legend_y = 0.045
    legend_x = 0.06
    for kname, kcolor in KINGDOM_COLOR.items():
        fig.text(legend_x, legend_y, "■", color=kcolor, fontsize=11)
        fig.text(legend_x + 0.018, legend_y, kname, color=INK, fontsize=9)
        legend_x += 0.10
    fig.text(0.06, legend_y - 0.025,
             "vs NCBI Taxonomy:   "
             "✓ nearest Carbon neighbour shares NCBI clade   "
             "✗ doesn't   "
             "— solo (no NCBI sibling in dataset)",
             color=MUTED, fontsize=8)

    plt.subplots_adjust(left=0.06, right=0.96, top=0.88, bottom=0.10)
    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor=PAPER)
    plt.close(fig)


def main():
    tree = load_tree()
    out_path = os.path.join(OUT, "D_plus.png")
    print(f"rendering → {out_path}")
    render(tree, out_path)
    print("done.")


if __name__ == "__main__":
    main()
