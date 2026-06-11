"""Generate a fake UMAP scatter dataset for prototyping the §6 viewer.

The real embedding-UMAP output (from Dana's Carbon 3B pipeline) will land
in roughly the same shape. Until then, this gives us a 500K-point fixture
to develop the WebGL frontend at target scale, so we don't discover
performance cliffs later.

Layout strategy:
  - 24 eukaryotic species grouped into 5 kingdoms (vertebrates, invertebrates,
    plants, fungi, protozoa). Kingdom centers are placed evenly around a
    radius-12 circle in UMAP space, with species centers jittered nearby.
  - Each point is drawn from a 2D Gaussian around its species center.
  - Biotype, strand, and codon phase are roughly orthogonal axes — toggling
    color in the UI reveals different organizations of the same points.
  - Points are output sorted by species so gzip can RLE the category columns
    aggressively (typically 90%+ compression on those bytes).

Binary layout (little-endian, 40-byte header + ~4 MB payload for 500K pts):
  uint32  magic        0xCAB0FA1D
  uint32  n_points
  uint32  n_species
  uint32  n_biotypes
  uint32  n_strands
  uint32  n_phases
  float32 x_min, x_max, y_min, y_max         (16 bytes — for de-quantization)
  int16   positions[n_points * 2]            (interleaved x,y; quantized)
  uint8   species[n_points]
  uint8   biotype[n_points]
  uint8   strand[n_points]
  uint8   phase[n_points]

Usage:
    python scripts/gen_fake_umap.py
"""
import array
import json
import math
import os
import random
import struct
import sys
import time

# --- Dataset shape ---------------------------------------------------------

N_POINTS = 500_000
SEED = 42

# 24 eukaryotic species — matches the rough scale of the real run (24 species
# from Leandro's Gemini-annotated set, 500/species in Dana's first batch).
SPECIES = [
    # Vertebrates
    "human", "mouse", "rat", "chicken", "zebrafish", "xenopus",
    "dog", "cow", "pig",
    # Invertebrates
    "fly", "worm", "mosquito", "honeybee", "sea_urchin",
    # Plants
    "arabidopsis", "rice", "maize", "wheat", "soybean",
    # Fungi
    "yeast", "neurospora", "candida",
    # Protozoa
    "plasmodium", "trypanosoma",
]

KINGDOMS = {
    "vertebrates":   ["human", "mouse", "rat", "chicken", "zebrafish", "xenopus",
                      "dog", "cow", "pig"],
    "invertebrates": ["fly", "worm", "mosquito", "honeybee", "sea_urchin"],
    "plants":        ["arabidopsis", "rice", "maize", "wheat", "soybean"],
    "fungi":         ["yeast", "neurospora", "candida"],
    "protozoa":      ["plasmodium", "trypanosoma"],
}

BIOTYPES = ["protein_coding", "lncRNA", "miRNA", "pseudogene"]
# Roughly realistic frequencies for a mixed eukaryote set.
BIOTYPE_WEIGHTS = [0.70, 0.15, 0.08, 0.07]

STRANDS = ["+", "-"]
PHASES = ["0", "1", "2"]

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")

# --- Generation ------------------------------------------------------------


def species_centers():
    """Pick a UMAP-space center for each species, kingdom by kingdom."""
    centers = {}
    kingdom_names = list(KINGDOMS.keys())
    for i, kingdom in enumerate(kingdom_names):
        # Kingdom center placed evenly around a circle.
        cx = math.cos(2 * math.pi * i / len(kingdom_names)) * 12.0
        cy = math.sin(2 * math.pi * i / len(kingdom_names)) * 12.0
        for sp in KINGDOMS[kingdom]:
            ox = random.gauss(0, 1.8)
            oy = random.gauss(0, 1.8)
            centers[sp] = (cx + ox, cy + oy)
    return centers


def weighted_choice_idx(weights):
    """Faster than random.choices() for tight loops — returns the index."""
    r = random.random()
    acc = 0.0
    for i, w in enumerate(weights):
        acc += w
        if r < acc:
            return i
    return len(weights) - 1


def generate():
    """Produce all per-point data as parallel arrays (sorted by species)."""
    random.seed(SEED)
    centers = species_centers()

    xs = array.array("f")
    ys = array.array("f")
    sp_col = bytearray()
    bt_col = bytearray()
    st_col = bytearray()
    ph_col = bytearray()

    base = N_POINTS // len(SPECIES)
    extra = N_POINTS - base * len(SPECIES)

    for sp_idx, sp in enumerate(SPECIES):
        n_this = base + (1 if sp_idx < extra else 0)
        cx, cy = centers[sp]
        # Sample n_this points around this species' center.
        for _ in range(n_this):
            xs.append(cx + random.gauss(0, 1.2))
            ys.append(cy + random.gauss(0, 1.2))
            sp_col.append(sp_idx)
            bt_col.append(weighted_choice_idx(BIOTYPE_WEIGHTS))
            st_col.append(random.randrange(2))
            ph_col.append(random.randrange(3))

    return xs, ys, sp_col, bt_col, st_col, ph_col


def pack_binary(xs, ys, sp_col, bt_col, st_col, ph_col):
    """Pack parallel arrays into the binary layout described in the docstring."""
    n = len(xs)
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    # Map floats into int16 range [-32767, 32767] using the bounds (so the
    # client can reconstitute float coords if it ever needs to).
    qx = array.array("h")
    qy = array.array("h")
    rx = 65534.0 / (x_max - x_min)
    ry = 65534.0 / (y_max - y_min)
    for i in range(n):
        qx.append(int(round((xs[i] - x_min) * rx - 32767)))
        qy.append(int(round((ys[i] - y_min) * ry - 32767)))

    # Interleave xy into a single int16 stream (WebGL friendly: stride 4 bytes).
    pos = array.array("h", [0] * (2 * n))
    for i in range(n):
        pos[2 * i]     = qx[i]
        pos[2 * i + 1] = qy[i]

    buf = bytearray()
    # Header — 40 bytes (6 uint32 + 4 float32).
    buf += struct.pack("<6I",
                       0xCAB0FA1D, n,
                       len(SPECIES), len(BIOTYPES),
                       len(STRANDS), len(PHASES))
    buf += struct.pack("<4f", x_min, x_max, y_min, y_max)

    buf += pos.tobytes()
    buf += bytes(sp_col)
    buf += bytes(bt_col)
    buf += bytes(st_col)
    buf += bytes(ph_col)

    return buf, (x_min, x_max, y_min, y_max)


def main():
    os.makedirs(DATA, exist_ok=True)

    t0 = time.time()
    print(f"generating {N_POINTS:,} fake UMAP points ...", file=sys.stderr)
    xs, ys, sp_col, bt_col, st_col, ph_col = generate()
    print(f"  done in {time.time() - t0:.1f}s", file=sys.stderr)

    t1 = time.time()
    print("packing binary ...", file=sys.stderr)
    buf, bounds = pack_binary(xs, ys, sp_col, bt_col, st_col, ph_col)
    print(f"  done in {time.time() - t1:.1f}s", file=sys.stderr)

    out_bin = os.path.join(DATA, "umap.bin")
    with open(out_bin, "wb") as f:
        f.write(buf)
    print(f"  wrote {out_bin}  ({len(buf):,} bytes uncompressed)", file=sys.stderr)

    out_labels = os.path.join(DATA, "umap_labels.json")
    species_to_kingdom = {sp: kd for kd, members in KINGDOMS.items() for sp in members}
    with open(out_labels, "w") as f:
        json.dump({
            "species":           SPECIES,
            "biotypes":          BIOTYPES,
            "strands":           STRANDS,
            "phases":            PHASES,
            "species_kingdom":   species_to_kingdom,
            "kingdoms":          list(KINGDOMS.keys()),
            "bounds":            list(bounds),
            "n_points":          len(xs),
            "fake":              True,
        }, f, indent=2)
    print(f"  wrote {out_labels}", file=sys.stderr)
    print(f"total: {time.time() - t0:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
