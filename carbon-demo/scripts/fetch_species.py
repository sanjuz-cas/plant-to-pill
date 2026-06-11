"""Fetch cross-species orthologs for a curated set of genes.

For each (human gene, target species) pair, resolve the canonical orthologous
transcript in the target species, fetch its genomic sequence on its coding
strand, and save to data/species.json.

Usage:
    python scripts/fetch_species.py
"""
import json
import os
import sys
import time
import urllib.request

ENSEMBL = "https://rest.ensembl.org"

# Curated set: pick genes with deeply conserved orthologs across vertebrates.
GENES = ["INS", "TP53"]
# (HBB has noisy orthology — chicken/mouse don't return the actual β-globin ortholog
# via Ensembl's homology API.)
SPECIES = [
    {"id": "homo_sapiens",       "common": "human",     "color": "#1a1a1a"},
    {"id": "mus_musculus",       "common": "mouse",     "color": "#2c5aa0"},
    {"id": "gallus_gallus",      "common": "chicken",   "color": "#c08030"},
    # Zebrafish dropped: ~450 My from human, the model usually can't pick up
    # the lineage from ~400 bp of context and the row looks like noise next
    # to mammals + bird.
]
PREFIX_LEN = 1200  # cap on returned seq length per species (only ~200 will be fed as prompt)


def get_json(path):
    req = urllib.request.Request(ENSEMBL + path, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def revcomp(s):
    return s.translate(str.maketrans("ACGTNacgtn", "TGCANtgcan"))[::-1]


def fetch_for(symbol, species_id):
    if species_id == "homo_sapiens":
        # Same path as fetch_genes, abbreviated
        g = get_json(f"/lookup/symbol/{species_id}/{symbol}?expand=1")
        ct = next(t for t in g["Transcript"] if t.get("is_canonical"))
    else:
        # Find ortholog via homology
        h = get_json(f"/homology/symbol/human/{symbol}?target_species={species_id}&type=orthologues")
        homologies = h.get("data", [{}])[0].get("homologies", [])
        if not homologies:
            raise RuntimeError(f"{symbol} → {species_id}: no ortholog")
        target_gene_id = homologies[0]["target"]["id"]
        g = get_json(f"/lookup/id/{target_gene_id}?expand=1")
        if not g.get("Transcript"):
            raise RuntimeError(f"{symbol} → {species_id}: no transcripts")
        ct = next((t for t in g["Transcript"] if t.get("is_canonical")), g["Transcript"][0])

    chrom = g["seq_region_name"]
    strand = g["strand"]
    t_start_full = ct["start"]
    t_end_full = ct["end"]
    exons_genomic = [(e["start"], e["end"]) for e in ct.get("Exon", [])]

    t_start, t_end = t_start_full, t_end_full
    # Cap fetched length so the JSON stays small
    if t_end - t_start + 1 > PREFIX_LEN:
        if strand == 1:
            t_end = t_start + PREFIX_LEN - 1
        else:
            t_start = t_end - PREFIX_LEN + 1

    species_path = species_id  # ensembl uses the species name in the path
    seq_data = get_json(f"/sequence/region/{species_path}/{chrom}:{t_start}..{t_end}:1?content-type=application/json")
    plus_seq = seq_data["seq"].upper()

    if strand == 1:
        seq = plus_seq
    else:
        seq = revcomp(plus_seq)

    # Translate exons from genomic coords into 0-based [start, end) offsets in
    # `seq`. For + strand seq[i] = plus pos t_start + i. For - strand seq is
    # revcomp(plus_seq), so seq[i] = plus pos t_end - i. Exons that fall
    # outside the trimmed window are clipped or dropped.
    exons_seq = []
    seq_len = len(seq)
    for e_start, e_end in exons_genomic:
        if strand == 1:
            s = e_start - t_start
            e = e_end - t_start + 1
        else:
            s = t_end - e_end
            e = t_end - e_start + 1
        s = max(0, s); e = min(seq_len, e)
        if e > s:
            exons_seq.append({"start": s, "end": e})
    exons_seq.sort(key=lambda x: x["start"])

    return {
        "ortholog_symbol": g.get("display_name", symbol),
        "ensembl_gene": g["id"],
        "ensembl_transcript": ct["id"],
        "chrom": chrom,
        "strand": strand,
        "length": len(seq),
        "seq": seq,
        "exons": exons_seq,
    }


def main():
    out = []
    for sym in GENES:
        entry = {"symbol": sym, "species": []}
        for sp in SPECIES:
            print(f"  {sym} → {sp['id']}…", flush=True)
            try:
                d = fetch_for(sym, sp["id"])
                d["species_id"] = sp["id"]
                d["common"] = sp["common"]
                d["color"] = sp["color"]
                entry["species"].append(d)
                print(f"    ✓ {d['ortholog_symbol']} · {d['length']}bp · chr{d['chrom']} strand {d['strand']}")
                time.sleep(0.4)
            except Exception as e:
                print(f"    ✗ — {e}", file=sys.stderr)
        out.append(entry)
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(os.path.dirname(here), "data", "species.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nwrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
