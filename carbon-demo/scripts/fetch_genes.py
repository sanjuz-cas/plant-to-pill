"""Fetch curated gene reference sequences + exon/intron annotations from Ensembl REST.

Run once to (re)generate data/genes.json. Sequences are returned in the gene's
own transcribed (5'->3') orientation so they can be fed to Carbon directly.

Usage:
    python scripts/fetch_genes.py
"""
import json
import os
import sys
import time
import urllib.request

ENSEMBL = "https://rest.ensembl.org"

# Curated set: small enough to fit on screen, biologically famous, varied.
# (BRCA1 omitted — full genomic span is ~80kb, would need a slice not a whole gene.)
GENES = [
    {"symbol": "HBB",  "blurb": "β-globin · sickle-cell gene · 3 exons"},
    {"symbol": "INS",  "blurb": "insulin · the smallest classic gene · 3 exons"},
    {"symbol": "TP53", "blurb": "tumor suppressor · 'guardian of the genome' · 11 exons"},
    {"symbol": "MYC",  "blurb": "proto-oncogene · regulator of cell growth · 3 exons"},
]


def get_json(path):
    req = urllib.request.Request(ENSEMBL + path, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def revcomp(s):
    comp = str.maketrans("ACGTNacgtn", "TGCANtgcan")
    return s.translate(comp)[::-1]


def fetch_gene(symbol):
    g = get_json(f"/lookup/symbol/homo_sapiens/{symbol}?expand=1")
    chrom = g["seq_region_name"]
    strand = g["strand"]
    # Canonical transcript — use its boundaries (TSS to PAS), not the gene's
    # boundaries, which can include regulatory regions before/after the transcript.
    ct = next(t for t in g["Transcript"] if t.get("is_canonical"))
    t_start = ct["start"]
    t_end = ct["end"]
    exons = sorted(ct["Exon"], key=lambda e: e["start"])

    # Fetch genomic sequence on the + strand for the transcript span only
    seq_data = get_json(f"/sequence/region/human/{chrom}:{t_start}..{t_end}:1?content-type=application/json")
    plus_seq = seq_data["seq"].upper()
    assert len(plus_seq) == t_end - t_start + 1, (len(plus_seq), t_end - t_start + 1)

    # Map exons to sequence-local coords. For a minus-strand gene, transcribe (revcomp)
    # the plus-strand sequence and flip exon coordinates accordingly.
    if strand == 1:
        seq = plus_seq
        local_exons = [(e["start"] - t_start, e["end"] - t_start + 1) for e in exons]  # half-open
    else:
        seq = revcomp(plus_seq)
        L = len(plus_seq)
        local_exons = [(L - (e["end"] - t_start) - 1, L - (e["start"] - t_start)) for e in exons]
    # Order exons 5' -> 3'
    local_exons.sort(key=lambda x: x[0])

    # Derive introns from gaps between exons.
    introns = []
    for (a, b), (c, d) in zip(local_exons, local_exons[1:]):
        if c > b:
            introns.append((b, c))

    return {
        "symbol": symbol,
        "ensembl_gene": g["id"],
        "ensembl_transcript": ct["id"],
        "chrom": chrom,
        "strand": strand,
        "length": len(seq),
        "seq": seq,
        "exons": [{"start": s, "end": e} for s, e in local_exons],
        "introns": [{"start": s, "end": e} for s, e in introns],
    }


def main():
    out = []
    for entry in GENES:
        sym = entry["symbol"]
        print(f"fetching {sym}…", flush=True)
        try:
            data = fetch_gene(sym)
            data["blurb"] = entry["blurb"]
            print(f"  {sym}: {data['length']}bp, {len(data['exons'])} exons", flush=True)
            out.append(data)
            time.sleep(0.3)  # be polite to Ensembl
        except Exception as e:
            print(f"  {sym}: FAILED — {e}", file=sys.stderr)
            sys.exit(1)
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(os.path.dirname(here), "data", "genes.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    total_kb = os.path.getsize(out_path) / 1024
    print(f"\nwrote {out_path} ({total_kb:.1f} KB)")


if __name__ == "__main__":
    main()
