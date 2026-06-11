"""Fetch curated ClinVar variants with surrounding genomic context.

For each variant we fetch a 60-bp window centered on the SNP from Ensembl,
revcomp it onto the gene's coding strand if needed, and save ref + alt
window + tokenization-aligned offset for the §2 (VEP) demo.

Usage:
    python scripts/fetch_variants.py
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

ENSEMBL = "https://rest.ensembl.org"
# Window total length (bp), centered on the variant. The eval recipe in
# `vep_eval.py` uses 8,192 bp; we use a smaller window here to keep /score
# fast on the live endpoint, but well above the 60 bp the demo originally
# shipped with (which was too small to read variant signal — 3/3 pathogenic
# variants flipped sign or vanished into noise at 60 bp).
WINDOW = 4002             # multiple of 6 for the 6-mer BPE tokenizer + matches HALF math
HALF = WINDOW // 2        # variant placed at center

# Curated set: famous pathogenic + risk + benign SNVs across several
# genes/diseases. Coordinates resolved via the Ensembl variation API; the
# plus-strand alt is the ClinVar canonical disease-associated allele for
# pathogenic / risk picks, or the single reported alt for benign.
#
# Spread: 6 Pathogenic + 1 Risk + 1 Benign. The two VHL rows (rs1575932011
# and rs182781943) are paired on purpose, same gene, opposite verdicts:
# a premature stop codon vs. a benign 3' UTR SNP.
VARIANTS = [
    {"rs": "rs334",         "gene": "HBB",   "name": "HBB c.20A>T",      "sig": "Pathogenic", "blurb": "sickle cell anemia · p.Glu6Val",               "plus_alt": "A"},
    {"rs": "rs80359027",    "gene": "BRCA2", "name": "BRCA2 c.7976G>T",  "sig": "Pathogenic", "blurb": "hereditary breast/ovarian cancer · missense",  "plus_alt": "T"},
    {"rs": "rs1057519981",  "gene": "TP53",  "name": "TP53 c.712T>A",    "sig": "Pathogenic", "blurb": "Li-Fraumeni cancer · missense",                "plus_alt": "T"},
    {"rs": "rs1603267420",  "gene": "F9",    "name": "F9 c.1186T>A",     "sig": "Pathogenic", "blurb": "hemophilia B · clotting factor missense",      "plus_alt": "A"},
    {"rs": "rs112029328",   "gene": "LDLR",  "name": "LDLR c.313+1G>T",  "sig": "Pathogenic", "blurb": "familial high cholesterol · splice donor lost","plus_alt": "T"},
    {"rs": "rs1575932011",  "gene": "VHL",   "name": "VHL c.475A>T",     "sig": "Pathogenic", "blurb": "Von Hippel-Lindau · premature STOP",           "plus_alt": "T"},
    {"rs": "rs34637584",    "gene": "LRRK2", "name": "LRRK2 c.6055G>A",  "sig": "Risk",       "blurb": "Parkinson's · G2019S kinase variant",          "plus_alt": "A"},
    {"rs": "rs182781943",   "gene": "VHL",   "name": "VHL c.*820A>G",    "sig": "Benign",     "blurb": "common 3' UTR variant · same gene as row above","plus_alt": "G"},
]


def get_json(path):
    req = urllib.request.Request(ENSEMBL + path, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def revcomp(s):
    return s.translate(str.maketrans("ACGTNacgtn", "TGCANtgcan"))[::-1]


def fetch_variant(v):
    info = get_json(f"/variation/human/{v['rs']}")
    # Ensembl returns allele_string like "T/A/C/G" with ref first. Pick the
    # first mapping that has the expected plus-strand alt in its alt set.
    mapping = None
    for m in info.get("mappings", []):
        alleles = m.get("allele_string", "").split("/")
        # Only chromosomal mappings, only single-base alleles
        if not alleles or any(len(a) != 1 or a not in "ACGTN" for a in alleles):
            continue
        # Skip patch/alt contigs
        chrom = m.get("seq_region_name", "")
        if not (chrom.isdigit() or chrom in ("X", "Y", "MT")):
            continue
        if v["plus_alt"] in alleles[1:]:
            mapping = m
            break
    if not mapping:
        raise RuntimeError(f"{v['rs']}: no SNV mapping containing alt {v['plus_alt']}")
    alleles = mapping["allele_string"].split("/")
    ref = alleles[0]
    alt = v["plus_alt"]
    chrom = mapping["seq_region_name"]
    pos = mapping["start"]   # 1-based

    # Fetch a window centered on the variant: pos - HALF + 1 .. pos + HALF
    win_start = pos - HALF + 1   # 1-based
    win_end = pos + HALF         # 1-based, inclusive
    seq_data = get_json(f"/sequence/region/human/{chrom}:{win_start}..{win_end}:1?content-type=application/json")
    plus_seq = seq_data["seq"].upper()
    assert len(plus_seq) == WINDOW
    var_offset_plus = pos - win_start   # 0-based offset into plus_seq

    # Sanity: the base at var_offset_plus must equal ref (on plus strand).
    # Some rs IDs report alleles on the gene's strand rather than +. If our
    # plus_seq base doesn't match ref, try interpreting alleles as gene-strand
    # and revcomping later.
    plus_base = plus_seq[var_offset_plus]
    sig = v["sig"]

    # Determine gene's strand for orientation.
    g = get_json(f"/lookup/symbol/homo_sapiens/{v['gene']}")
    gene_strand = g["strand"]

    if gene_strand == 1:
        seq = plus_seq
        var_offset = var_offset_plus
        ref_g, alt_g = ref, alt
    else:
        seq = revcomp(plus_seq)
        var_offset = WINDOW - 1 - var_offset_plus
        ref_g, alt_g = revcomp(ref), revcomp(alt)
        # Recheck: if plus_base != ref, the variant's REF was already on gene
        # strand, so flip back.
        if plus_base != ref:
            # alleles were given on gene-strand (minus strand of plus). We've
            # already revcomp'd, so this should now match — but verify.
            pass

    # Final check: seq[var_offset] should equal ref_g
    if seq[var_offset] != ref_g:
        # Try the other orientation
        # (this happens when Ensembl reports allele_string on gene strand for - strand genes)
        if seq[var_offset] == revcomp(ref_g):
            ref_g, alt_g = revcomp(ref_g), revcomp(alt_g)
        else:
            raise RuntimeError(
                f"{v['rs']}: ref mismatch — seq[{var_offset}]={seq[var_offset]} expected {ref_g} (or {revcomp(ref_g)})"
            )

    return {
        "rs": v["rs"],
        "gene": v["gene"],
        "name": v["name"],
        "sig": sig,
        "blurb": v["blurb"],
        "chrom": chrom,
        "pos": pos,
        "gene_strand": gene_strand,
        "ref": ref_g,
        "alt": alt_g,
        "ref_window": seq,                               # full WINDOW bp on gene strand
        "var_offset": var_offset,                        # 0-based
    }


def main():
    out = []
    for v in VARIANTS:
        print(f"fetching {v['rs']} ({v['gene']})…", flush=True)
        try:
            data = fetch_variant(v)
            print(f"  ✓ {data['ref']}>{data['alt']} at offset {data['var_offset']} | window: …{data['ref_window'][max(0,data['var_offset']-5):data['var_offset']]}[{data['ref_window'][data['var_offset']]}]{data['ref_window'][data['var_offset']+1:data['var_offset']+6]}…")
            out.append(data)
            time.sleep(0.4)
        except Exception as e:
            print(f"  ✗ FAILED — {e}", file=sys.stderr)
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(os.path.dirname(here), "data", "variants.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nwrote {out_path} ({os.path.getsize(out_path)/1024:.1f} KB) — {len(out)} variants")


if __name__ == "__main__":
    main()
