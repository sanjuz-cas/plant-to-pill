"""Convert Dana's viz.csv (Carbon 3B embedding UMAP) into our packed binary.

Input:
    /tmp/carbon-umap/viz.csv  (or pass --csv PATH)

    Columns expected:
        row_idx, gene_id, name, biotype, chrom, start, end, strand, assembly,
        species, length, gc_content, seq_len_used,
        umap2d_x, umap2d_y,
        umap3d_x, umap3d_y, umap3d_z

Output (this format matches what demo.html's initDemoUmap() now parses):

    data/umap.bin (~5 MB raw → ~3.1 MB gzipped)
        Header (64 bytes, little-endian):
            uint32  magic        0xCAB0FA1D
            uint32  n_points
            uint32  n_species
            uint32  n_biotypes
            uint32  n_strands
            uint32  flags        (bit 0 = has 3D, bit 1 = has gc, bit 2 = has length)
            float32 bounds_2d[4] (x_min, x_max, y_min, y_max)
            float32 bounds_3d[6] (x_min, x_max, y_min, y_max, z_min, z_max)
                                 zeros when bit 0 of flags is unset.
        Payload (column-major so each column gzips independently well):
            int16   pos_2d[n_points * 2]   interleaved x,y
            int16   pos_3d[n_points * 3]   interleaved x,y,z   (only when
                                           bit 0 of flags is set — currently
                                           disabled: see "Why no pos_3d?"
                                           below)
            uint8   species[n_points]
            uint8   biotype[n_points]
            uint8   strand[n_points]
            uint8   gc_content[n_points]   quantized to 0..255 over [0, 1]
            uint8   length[n_points]       quantized to 0..255 over
                                           [log10_length_min, log10_length_max].
                                           uint8 + log gives ~2.5% relative
                                           precision over a 5+ decade dynamic
                                           range (~6 bp → ~3 Mb in this
                                           dataset), which is well below
                                           visual noise on a continuous
                                           gradient overlay.

    Why no pos_3d? v1 of the viewer ships a 2D scatter only — the front
    explicitly skips the pos_3d block on parse (see initDemoUmap, the
    `if (has3D)` branch that just advances the read cursor without
    storing). Shipping the int16 × 3 coords meant ~3.3 MB of wasted
    bandwidth per visit. We keep the computation alive in this script
    (negligible CPU, ~half a second on 570 K rows) but skip writing
    it to the binary; to re-enable, flip `WRITE_POS_3D` below.

    data/umap_labels.json
        Label arrays + kingdom mapping + bounds, consumed by the frontend
        to build the legend, tooltip, and color palettes. Now also carries
        `length_log10_range` (so the front can de-quantize a uint8 byte
        back to bp for the tooltip) and `length_bp_range` (for the legend
        tick marks).

    data/umap_names.txt
        One gene name per line, in the SAME species-sorted order as the
        binary's per-point columns. Plain text (not JSON) because the
        format is trivial, gzips identically well, and is ~10x faster to
        parse than JSON.parse over 500 K strings. Tooltip-only data, so
        the frontend fetches it lazily after the WebGL render is up.

Points are sorted by species before writing so the species column becomes
runs of identical bytes — gzip RLEs it down to ~10% of raw size.

Usage:
    python scripts/build_real_umap.py [--csv /path/to/viz.csv]
"""
import argparse
import array
import csv
import json
import math
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
DEFAULT_CSV = "/tmp/carbon-umap/viz.csv"

# Kingdom grouping for the 27 species in the bucket. Order inside each
# kingdom controls the palette band that the species gets (the frontend
# assigns adjacent hues to adjacent species).
KINGDOMS = {
    "vertebrates":   ["human", "macaque", "mouse", "rat", "dog", "cow", "pig",
                      "chicken", "frog", "zebrafish"],
    "invertebrates": ["fly", "worm"],
    "plants":        ["arabidopsis", "soybean", "tomato", "maize", "rice"],
    "fungi":         ["yeast", "fission_yeast", "candida", "aspergillus",
                      "neurospora"],
    "bacteria":      ["ecoli", "bsubtilis", "saureus"],
    "viruses":       ["sarscov2", "hiv1"],
}


def build_species_order():
    order, kingdom_map = [], {}
    for kingdom, members in KINGDOMS.items():
        for sp in members:
            order.append(sp)
            kingdom_map[sp] = kingdom
    return order, kingdom_map


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=DEFAULT_CSV, help="path to viz.csv")
    args = ap.parse_args()

    if not os.path.exists(args.csv):
        sys.exit(f"viz.csv not found at {args.csv}\n"
                 "Download from the HF bucket:\n"
                 "  huggingface.co/buckets/HuggingFaceBio/carbon_embeddings/"
                 "tree/carbon_dana_embeddings_middle/viz.csv")

    species_order, kingdom_map = build_species_order()
    species_idx = {sp: i for i, sp in enumerate(species_order)}
    biotypes = ["protein_coding", "lncRNA", "snRNA", "misc_RNA"]
    biotype_idx = {b: i for i, b in enumerate(biotypes)}
    strands = ["+", "-"]
    strand_idx = {s: i for i, s in enumerate(strands)}

    t0 = time.time()
    print(f"reading {args.csv}", file=sys.stderr)

    # Single pass: bucket rows by species so we end up species-sorted in the
    # output (gzip-friendly) without an explicit O(n log n) sort.
    buckets = [[] for _ in species_order]
    seen_species = set()
    seen_biotype = set()
    unknown_species = set()
    with open(args.csv) as f:
        reader = csv.DictReader(f)
        for row in reader:
            sp = row["species"]
            if sp not in species_idx:
                unknown_species.add(sp)
                continue
            seen_species.add(sp)
            seen_biotype.add(row["biotype"])
            # `length` is the genomic span in bp. We clamp at >=1 so log10()
            # is always well-defined; the rare 0-length entries Dana sees
            # (corrupt rows in the source GFFs) get binned into the floor
            # of the colour scale instead of crashing the build.
            try:
                length_bp = max(1, int(row["length"]))
            except (KeyError, ValueError):
                length_bp = 1
            # Prefer the human-readable `name` (HBB, BRCA1, AT1G30814) but
            # fall back to gene_id when the source had no symbol — keeps
            # the tooltip from ever rendering "(empty)" rows.
            name = row.get("name") or row.get("gene_id") or "—"
            buckets[species_idx[sp]].append((
                float(row["umap2d_x"]), float(row["umap2d_y"]),
                float(row["umap3d_x"]), float(row["umap3d_y"]), float(row["umap3d_z"]),
                biotype_idx[row["biotype"]],
                strand_idx[row["strand"]],
                float(row["gc_content"]),
                length_bp,
                name,
            ))

    if unknown_species:
        print(f"warning: {len(unknown_species)} unknown species skipped: "
              f"{sorted(unknown_species)}", file=sys.stderr)

    flat = [(sp_i, p) for sp_i, bucket in enumerate(buckets) for p in bucket]
    n = len(flat)
    print(f"  {n:,} points kept in {time.time()-t0:.1f}s", file=sys.stderr)

    # --- Compute bounds for quantization -----------------------------------
    x2_min = min(p[1][0] for p in flat); x2_max = max(p[1][0] for p in flat)
    y2_min = min(p[1][1] for p in flat); y2_max = max(p[1][1] for p in flat)
    x3_min = min(p[1][2] for p in flat); x3_max = max(p[1][2] for p in flat)
    y3_min = min(p[1][3] for p in flat); y3_max = max(p[1][3] for p in flat)
    z3_min = min(p[1][4] for p in flat); z3_max = max(p[1][4] for p in flat)

    # Length is *log-distributed* (5+ decades from miRNAs to titin). We
    # quantize log10(length) into uint8 — gives a perceptually uniform
    # color ramp and keeps the byte storage compact. We also stash the
    # log range in umap_labels.json so the tooltip can de-quantize back
    # to bp for human-readable display.
    log_lengths = [math.log10(p[1][8]) for p in flat]
    len_log_min = min(log_lengths)
    len_log_max = max(log_lengths)
    len_bp_min  = min(p[1][8] for p in flat)
    len_bp_max  = max(p[1][8] for p in flat)

    def quantize(v, lo, hi):
        return int(round((v - lo) / (hi - lo) * 65534 - 32767))

    rx2 = 65534.0 / (x2_max - x2_min)
    ry2 = 65534.0 / (y2_max - y2_min)
    rx3 = 65534.0 / (x3_max - x3_min)
    ry3 = 65534.0 / (y3_max - y3_min)
    rz3 = 65534.0 / (z3_max - z3_min)
    # Avoid div-by-zero on the (highly degenerate) case of a single-length
    # input — quantize() would NaN. The 1.0 fallback collapses every byte
    # to the same value, which is the visually-correct behaviour.
    rlen = 255.0 / (len_log_max - len_log_min) if len_log_max > len_log_min else 1.0

    t1 = time.time()
    print(f"packing binary ({n:,} points)...", file=sys.stderr)

    pos2 = array.array("h", [0] * (2 * n))
    pos3 = array.array("h", [0] * (3 * n))
    sp_col  = bytearray(n)
    bt_col  = bytearray(n)
    st_col  = bytearray(n)
    gc_col  = bytearray(n)
    len_col = bytearray(n)
    names   = [None] * n

    for i, (sp_i, p) in enumerate(flat):
        x2, y2, x3, y3, z3, bt, st, gc, length_bp, name = p
        pos2[2*i]     = int(round((x2 - x2_min) * rx2 - 32767))
        pos2[2*i + 1] = int(round((y2 - y2_min) * ry2 - 32767))
        pos3[3*i]     = int(round((x3 - x3_min) * rx3 - 32767))
        pos3[3*i + 1] = int(round((y3 - y3_min) * ry3 - 32767))
        pos3[3*i + 2] = int(round((z3 - z3_min) * rz3 - 32767))
        sp_col[i] = sp_i
        bt_col[i] = bt
        st_col[i] = st
        # gc_content is in [0, 1] but Dana's data tops at 0.9837, so the full
        # uint8 range gives ~0.4% precision which is well below visual noise.
        gc_col[i] = min(255, max(0, int(round(gc * 255))))
        len_col[i] = min(255, max(0, int(round((math.log10(length_bp) - len_log_min) * rlen))))
        # Strip newlines from gene names — we serialise as one-name-per-line
        # text below, so any embedded \n would shift the alignment of every
        # subsequent point. Tabs and stray whitespace pass through fine.
        names[i] = name.replace("\n", " ").replace("\r", " ")

    print(f"  {time.time()-t1:.1f}s", file=sys.stderr)

    # --- Write binary -------------------------------------------------------
    # Toggle for the optional pos_3d payload. When False (current default),
    # bit 0 of `flags` is cleared, the int16×3 coords are NOT appended to
    # the binary, and the bounds_3d slots in the header are zeroed out so
    # the frontend never reads stale ranges. Flip back to True if/when a
    # 3D rotating viewer is added — the script always computes pos3/bounds_3d
    # so this is a single-edit, one-rebuild change.
    WRITE_POS_3D = False

    buf = bytearray()
    # bit 0: has 3D positions, bit 1: has gc_content, bit 2: has length
    flags = 0b111 if WRITE_POS_3D else 0b110
    buf += struct.pack("<6I", 0xCAB0FA1D, n, len(species_order),
                       len(biotypes), len(strands), flags)
    buf += struct.pack("<4f", x2_min, x2_max, y2_min, y2_max)
    if WRITE_POS_3D:
        buf += struct.pack("<6f", x3_min, x3_max, y3_min, y3_max, z3_min, z3_max)
    else:
        # Keep the header at exactly 64 bytes: emit six zero floats so the
        # offset of the pos_2d payload (and the frontend's fixed-offset
        # reads) stays unchanged.
        buf += struct.pack("<6f", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    assert len(buf) == 64, f"header size {len(buf)} != 64"
    buf += pos2.tobytes()
    if WRITE_POS_3D:
        buf += pos3.tobytes()
    buf += bytes(sp_col)
    buf += bytes(bt_col)
    buf += bytes(st_col)
    buf += bytes(gc_col)
    buf += bytes(len_col)

    out_bin = os.path.join(DATA, "umap.bin")
    with open(out_bin, "wb") as f:
        f.write(buf)
    print(f"  wrote {out_bin}  ({len(buf):,} bytes uncompressed)", file=sys.stderr)

    # --- Write labels -------------------------------------------------------
    out_labels = os.path.join(DATA, "umap_labels.json")
    with open(out_labels, "w") as f:
        json.dump({
            "species":            species_order,
            "biotypes":           biotypes,
            "strands":            strands,
            "species_kingdom":    kingdom_map,
            "kingdoms":           list(KINGDOMS.keys()),
            "bounds_2d":          [x2_min, x2_max, y2_min, y2_max],
            "bounds_3d":          [x3_min, x3_max, y3_min, y3_max, z3_min, z3_max],
            # log-space range used for the uint8 quantization of `length`.
            # The frontend de-quantizes a byte b back to bp by:
            #   bp = round(10 ** (log_min + b/255 * (log_max - log_min)))
            # Stored as a list (not tuple) for stable JSON.
            "length_log10_range": [len_log_min, len_log_max],
            "length_bp_range":    [int(len_bp_min), int(len_bp_max)],
            "n_points":           n,
            "has_3d":             WRITE_POS_3D,
            "has_gc":             True,
            "has_length":         True,
            "has_names":          True,
            "source":             "HuggingFaceBio/carbon_embeddings (carbon_dana_embeddings_middle)",
        }, f, indent=2)
    print(f"  wrote {out_labels}", file=sys.stderr)

    # --- Write per-point gene names ----------------------------------------
    # Plain-text, one-per-line, in the same species-sorted order as the
    # binary's column data. The frontend lazy-loads this AFTER the WebGL
    # render is up, then re-aligns it to the in-memory shuffled order
    # (see scatter.js shuffleParallel + permutation tracking).
    out_names = os.path.join(DATA, "umap_names.txt")
    with open(out_names, "w", encoding="utf-8") as f:
        f.write("\n".join(names))
    print(f"  wrote {out_names}", file=sys.stderr)
    print(f"total: {time.time()-t0:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
