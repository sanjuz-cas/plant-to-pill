"""Build a species tree from Carbon 3B embeddings.

Pipeline:
    1. Read /tmp/carbon-umap/viz.csv to get the species of each row.
    2. Stream /tmp/carbon-umap/embeddings.npy in chunks (no full load).
    3. Accumulate per-species sum + count -> 27 mean-pooled centroids.
    4. Compute cosine distance matrix 27x27.
    5. Hierarchical clustering (Ward + UPGMA), build dendrograms.
    6. Write data/species_tree.json (linkage + species labels + matrix)
       and data/species_tree.png (preview).

The 6.5 GB .npy is mmapped, never fully loaded — RAM usage stays
under 1 GB (one chunk + 27 centroids accumulators).
"""
import csv
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")

CSV_PATH = "/tmp/carbon-umap/viz.csv"
NPY_PATH = "/tmp/carbon-umap/embeddings.npy"
CHUNK = 20000  # rows per streaming chunk

KINGDOMS = {
    "vertebrates":   ["human", "macaque", "mouse", "rat", "dog", "cow", "pig",
                      "chicken", "frog", "zebrafish"],
    "invertebrates": ["fly", "worm"],
    "plants":        ["arabidopsis", "soybean", "tomato", "maize", "rice"],
    "fungi":         ["yeast", "fission_yeast", "candida", "aspergillus",
                      "neurospora"],
    "bacteria":      ["ecoli", "bsubtilis", "saureus"],
}

# Canonical NCBI clade for each species. Two species sharing the same
# value are sister (or near-sister) groups in standard taxonomy.
# A clade with a single member among our 27 species → the species is
# "solo" and not evaluable for sister-level agreement.
EXPECTED_CLADE = {
    "human":         "primates",
    "macaque":       "primates",
    "mouse":         "rodents",
    "rat":           "rodents",
    "dog":           "laurasiatheria",
    "cow":           "laurasiatheria",
    "pig":           "laurasiatheria",
    "chicken":       "sauropsida",            # solo
    "frog":          "amphibia",              # solo
    "zebrafish":     "actinopterygii",        # solo
    "fly":           "insects",               # solo
    "worm":          "nematodes",             # solo
    "arabidopsis":   "dicots",
    "tomato":        "dicots",
    "soybean":       "dicots",
    "rice":          "monocots",
    "maize":         "monocots",
    "yeast":         "saccharomycetes",
    "candida":       "saccharomycetes",
    "fission_yeast": "schizosaccharomycetes", # solo
    "neurospora":    "pezizomycotina",
    "aspergillus":   "pezizomycotina",
    "ecoli":         "proteobacteria",        # solo
    "bsubtilis":     "firmicutes",
    "saureus":       "firmicutes",
}


def species_to_kingdom():
    return {sp: k for k, members in KINGDOMS.items() for sp in members}


def main():
    t0 = time.perf_counter()

    print(f"[1/5] reading species column from {CSV_PATH} ...")
    species_per_row = []
    with open(CSV_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            species_per_row.append(row["species"])
    n = len(species_per_row)
    print(f"      {n:,} rows")

    s2k = species_to_kingdom()
    unknown = sorted(set(species_per_row) - set(s2k))
    if unknown:
        print(f"      WARNING: {len(unknown)} species not in KINGDOMS: {unknown[:5]} ...")

    species_order = [sp for k in KINGDOMS for sp in KINGDOMS[k] if sp in set(species_per_row)]
    sp_to_idx = {sp: i for i, sp in enumerate(species_order)}
    K = len(species_order)
    print(f"      {K} species in this dataset")

    species_idx = np.array([sp_to_idx[sp] for sp in species_per_row], dtype=np.int32)

    print(f"\n[2/5] memory-mapping {NPY_PATH} ...")
    arr = np.lib.format.open_memmap(NPY_PATH, mode="r")
    n_rows, dim = arr.shape
    assert n_rows == n, f"row mismatch: npy={n_rows} csv={n}"
    print(f"      shape={arr.shape} dtype={arr.dtype}")

    print(f"\n[3/5] streaming {n_rows:,} rows in chunks of {CHUNK:,} "
          f"-> {K} centroids of dim {dim} ...")
    sums = np.zeros((K, dim), dtype=np.float64)
    counts = np.zeros(K, dtype=np.int64)
    t_chunk = time.perf_counter()
    for start in range(0, n_rows, CHUNK):
        end = min(start + CHUNK, n_rows)
        chunk = np.asarray(arr[start:end], dtype=np.float32)
        sp_chunk = species_idx[start:end]
        # group-wise accumulate: np.add.at handles repeated indices safely
        np.add.at(sums, sp_chunk, chunk)
        np.add.at(counts, sp_chunk, 1)
        if (start // CHUNK) % 5 == 0:
            elapsed = time.perf_counter() - t_chunk
            pct = end / n_rows * 100
            print(f"      {end:>8,}/{n_rows:,} ({pct:5.1f}%) · {elapsed:.1f}s elapsed")
    centroids = sums / counts[:, None]
    print(f"      done in {time.perf_counter() - t_chunk:.1f}s")
    print(f"      counts per species: min={counts.min():,} "
          f"max={counts.max():,} median={int(np.median(counts)):,}")

    print(f"\n[4/5] computing cosine distance matrix {K}x{K} ...")
    norms = np.linalg.norm(centroids, axis=1, keepdims=True)
    unit = centroids / norms
    sim = unit @ unit.T
    sim = np.clip(sim, -1.0, 1.0)
    cos_dist = 1.0 - sim
    np.fill_diagonal(cos_dist, 0.0)

    from scipy.spatial.distance import squareform
    from scipy.cluster.hierarchy import linkage, dendrogram

    condensed = squareform(cos_dist, checks=False)
    linkage_ward = linkage(condensed, method="ward")
    linkage_upgma = linkage(condensed, method="average")
    print(f"      linkage matrices ready (Ward + UPGMA)")

    # Pre-compute the dendrogram visual layout (icoord/dcoord/leaf order)
    # for each linkage method so the frontend can render the tree spine
    # in SVG without re-implementing scipy's traversal algorithm.
    def dendro_layout(Z):
        d = dendrogram(Z, no_plot=True, labels=species_order)
        return {
            "leaf_order": d["ivl"],
            "icoord": d["icoord"],
            "dcoord": d["dcoord"],
        }
    layout_ward  = dendro_layout(linkage_ward)
    layout_upgma = dendro_layout(linkage_upgma)

    print(f"\n[5/5] writing outputs ...")
    out = {
        "species": species_order,
        "kingdom": [s2k.get(sp, "?") for sp in species_order],
        "expected_clade": [EXPECTED_CLADE.get(sp, "?") for sp in species_order],
        "counts": counts.tolist(),
        "distance_matrix": cos_dist.tolist(),
        "linkage_ward": linkage_ward.tolist(),
        "linkage_upgma": linkage_upgma.tolist(),
        "layout_ward": layout_ward,
        "layout_upgma": layout_upgma,
        "dim": int(dim),
        "n_total_points": int(n_rows),
    }
    json_path = os.path.join(DATA, "species_tree.json")
    with open(json_path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"      {json_path} ({os.path.getsize(json_path):,} bytes)")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from scipy.cluster.hierarchy import dendrogram

        kingdom_color = {
            "vertebrates":   "#1f1f1d",
            "invertebrates": "#7a6242",
            "plants":        "#317f3f",
            "fungi":         "#a9762f",
            "bacteria":      "#b00020",
        }

        fig, axes = plt.subplots(1, 2, figsize=(20, 10))
        for ax, lnk, title in zip(
            axes,
            [linkage_ward, linkage_upgma],
            ["Ward (cosine)", "UPGMA (cosine)"],
        ):
            ddata = dendrogram(
                lnk, labels=species_order, ax=ax,
                orientation="right", leaf_font_size=11,
                color_threshold=0,
                above_threshold_color="#888",
            )
            ax.set_title(title, fontsize=14)
            ax.set_xlabel("cosine distance")
            for tick in ax.get_yticklabels():
                k = s2k.get(tick.get_text(), "?")
                tick.set_color(kingdom_color.get(k, "#666"))
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
        plt.tight_layout()
        png_path = os.path.join(DATA, "species_tree.png")
        plt.savefig(png_path, dpi=120, bbox_inches="tight", facecolor="white")
        print(f"      {png_path}")
    except ImportError:
        print(f"      (matplotlib not available, skipped PNG preview)")

    print(f"\nTotal: {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
