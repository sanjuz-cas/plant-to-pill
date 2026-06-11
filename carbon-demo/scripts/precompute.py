"""Precompute /score and /fold outputs so demo.html can render results
instantly without round-tripping the inference endpoints.

Writes results back into data/genes.json and data/variants.json:
- per-gene likelihood `track` (Carbon /score)
- per-variant VEP `score` (Carbon /score)
- per-gene `fold_example` (Carbon /generate + NVIDIA NIM ESMFold)

Usage:
    python scripts/precompute.py                       # everything
    python scripts/precompute.py --folds               # only the folding fixtures
    python scripts/precompute.py --no-folds            # skip folding fixtures
    python scripts/precompute.py --folds --only-missing # only genes lacking fold_example
"""
import json
import os
import sys
import time

import httpx
from openai import OpenAI
from huggingface_hub import get_token

ENDPOINT_URL = os.environ.get(
    "ENDPOINT_URL",
    "https://cr2l9w72ys5pp8le.us-east-1.aws.endpoints.huggingface.cloud/v1/",
)
MODEL_NAME = os.environ.get("MODEL_NAME", "HuggingFaceBio/Carbon-3B")
TRACK_MAX_BP = 24000   # covers TP53 (19,070 bp) with headroom; model max is 32k tokens (~196k bp)

# Folding fixture parameters. T=0.9 because lower temperatures push the
# model into low-complexity sinks on long-context generation (poly-T at
# T<=0.5, AATC repeats at T=0.7), which is a known failure mode of
# autoregressive LMs on long DNA — most of the human genome is repetitive
# introns/intergenic, and greedy-ish sampling collapses there. T=0.9
# keeps enough exploration to stay in coding-region distribution.
NIM_FOLD_URL = "https://health.api.nvidia.com/v1/biology/nvidia/esmfold"
FOLD_PREFIX_LEN = 200
FOLD_TEMPERATURE = 0.9
# Best-of-N retries per gene. Long-context generation (MYC/TP53 need
# ~20 kb of DNA) collapses more often than HBB/INS, so we give those
# more shots at producing a viable ORF.
FOLD_BEST_OF_SHORT = 3
FOLD_BEST_OF_LONG  = 5
FOLD_LONG_THRESHOLD = 5000  # bp; above this, use BEST_OF_LONG retries
# Hard cap on AA sent to ESMFold — NVIDIA NIM tops out around ~1024 aa
# and we don't want a single oversized Carbon hallucination to fail the
# whole fold step. The reference proteins for our 4 demo genes are all
# well below this anyway (HBB 147, INS 110, MYC 439, TP53 393).
FOLD_MAX_AA = 1000

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")


def make_client():
    key = os.environ.get("HF_TOKEN") or get_token()
    if not key:
        raise RuntimeError("no HF token (set HF_TOKEN or `huggingface-cli login`)")
    return OpenAI(base_url=ENDPOINT_URL, api_key=key)


def left_pad_to_six(seq):
    if not seq: return seq, 0
    rem = len(seq) % 6
    if rem == 0: return seq, 0
    n = 6 - rem
    return ("A" * n) + seq, n


def score(client, seq):
    """Return {tokens, token_logprobs, pad_bases} for the sequence."""
    seq_padded, pad_bases = left_pad_to_six(seq)
    r = client.completions.create(
        model=MODEL_NAME,
        prompt="<dna>" + seq_padded,
        max_tokens=0,
        echo=True,
        logprobs=5,
        temperature=0,
    )
    lp = r.choices[0].logprobs
    return {
        "tokens": list(lp.tokens),
        "token_logprobs": list(lp.token_logprobs),
        "pad_bases": pad_bases,
    }


def precompute_tracks(client):
    path = os.path.join(DATA, "genes.json")
    genes = json.load(open(path))
    for g in genes:
        seq = g["seq"][:TRACK_MAX_BP]
        print(f"  scoring {g['symbol']} ({len(seq)}bp)…", flush=True)
        t0 = time.time()
        try:
            res = score(client, seq)
            res["scored_length"] = len(seq)
            g["track"] = res
            pad = res["pad_bases"]
            print(f"    ✓ {len(res['tokens'])} tokens in {time.time()-t0:.1f}s" + (f"  (left-padded {pad}bp)" if pad else ""))
        except Exception as e:
            # Keep whatever track was already on this gene; a transient
            # endpoint hiccup shouldn't wipe valid precomputed data.
            print(f"    ✗ {e}", file=sys.stderr)
    json.dump(genes, open(path, "w"), indent=2)
    print(f"  wrote {path}")


def sum_lp(lps):
    s, n = 0.0, 0
    for x in lps:
        if x is not None:
            s += x; n += 1
    return s, n


def precompute_vep(client):
    path = os.path.join(DATA, "variants.json")
    variants = json.load(open(path))
    for v in variants:
        ref = v["ref_window"]
        alt = ref[:v["var_offset"]] + v["alt"] + ref[v["var_offset"]+1:]
        print(f"  scoring {v['rs']} ({v['name']})…", flush=True)
        try:
            r_ref = score(client, ref)
            r_alt = score(client, alt)
            ref_sum, ref_n = sum_lp(r_ref["token_logprobs"])
            alt_sum, alt_n = sum_lp(r_alt["token_logprobs"])
            v["score"] = {
                "ref_sum": ref_sum, "alt_sum": alt_sum,
                "ref_logprobs": r_ref["token_logprobs"],
                "alt_logprobs": r_alt["token_logprobs"],
                "n": ref_n,
                "delta": alt_sum - ref_sum,
            }
            print(f"    ✓ Δ = {alt_sum - ref_sum:+.2f}  (ref {ref_sum:.2f}, alt {alt_sum:.2f})")
        except Exception as e:
            print(f"    ✗ {e}", file=sys.stderr)
            v.pop("score", None)
    json.dump(variants, open(path, "w"), indent=2)
    print(f"  wrote {path}")


# =========================================================================
# Folding fixture: per-gene Carbon continuation + ESMFold structures for
# both the reference and Carbon's spliced mRNA. Keeps the demo's first
# render instant even when the inference endpoints are cold.
# =========================================================================

CODON_TABLE = {
    "TTT":"F","TTC":"F","TTA":"L","TTG":"L", "CTT":"L","CTC":"L","CTA":"L","CTG":"L",
    "ATT":"I","ATC":"I","ATA":"I","ATG":"M", "GTT":"V","GTC":"V","GTA":"V","GTG":"V",
    "TCT":"S","TCC":"S","TCA":"S","TCG":"S", "CCT":"P","CCC":"P","CCA":"P","CCG":"P",
    "ACT":"T","ACC":"T","ACA":"T","ACG":"T", "GCT":"A","GCC":"A","GCA":"A","GCG":"A",
    "TAT":"Y","TAC":"Y","TAA":"*","TAG":"*", "CAT":"H","CAC":"H","CAA":"Q","CAG":"Q",
    "AAT":"N","AAC":"N","AAA":"K","AAG":"K", "GAT":"D","GAC":"D","GAA":"E","GAG":"E",
    "TGT":"C","TGC":"C","TGA":"*","TGG":"W", "CGT":"R","CGC":"R","CGA":"R","CGG":"R",
    "AGT":"S","AGC":"S","AGA":"R","AGG":"R", "GGT":"G","GGC":"G","GGA":"G","GGG":"G",
}


def splice_exons(dna, exons):
    """Concatenate exon slices, truncating any exon past the end of dna."""
    parts = []
    for e in exons:
        if e["start"] >= len(dna):
            break
        parts.append(dna[e["start"]:min(e["end"], len(dna))])
    return "".join(parts)


def find_longest_orf(dna, min_aa=30):
    """Mirror of demo.html findLongestORF — scans all 3 frames, returns
    the longest ATG-initiated ORF of at least `min_aa` amino acids.

    Prefers an ORF that ends on a clean stop codon. Falls back to a
    truncated ORF (reached the end of dna with no stop) — that case
    happens when Carbon mutates the canonical stop codon and the
    translation reads into the 3'UTR. Truncated entries are tagged
    so the UI can surface that biological detail."""
    best_clean = None
    best_trunc = None
    for frame in range(3):
        i = frame
        while i + 3 <= len(dna):
            if dna[i:i+3] != "ATG":
                i += 3
                continue
            aa = []
            j = i
            stopped = False
            invalid = False
            while j + 3 <= len(dna):
                a = CODON_TABLE.get(dna[j:j+3])
                if a is None:
                    invalid = True
                    break
                if a == "*":
                    stopped = True
                    break
                aa.append(a)
                j += 3
            if not invalid and len(aa) >= min_aa:
                entry = {"aa": "".join(aa), "frame": frame, "start_bp": i, "end_bp": j, "truncated": not stopped}
                if stopped:
                    if best_clean is None or len(aa) > len(best_clean["aa"]):
                        best_clean = entry
                else:
                    if best_trunc is None or len(aa) > len(best_trunc["aa"]):
                        best_trunc = entry
            i += 3
    return best_clean or best_trunc


BACKEND_URL = os.environ.get("CARBON_BACKEND", "http://127.0.0.1:7870")


def carbon_continue(_client, prompt_dna, max_tokens, temperature,
                    max_503_retries=10, retry_wait_s=15):
    """Ask Carbon to continue a DNA prompt and return the cleaned continuation.

    Calls the backend /generate (SSE-streamed) rather than the OpenAI
    client directly. Going through /generate guarantees the precompute
    follows the exact same pipeline as the live demo (left-padding to a
    multiple of 6, <dna> prefix, streaming framing) so the cached example
    is identical to what runFold() would produce.

    The HF Inference Endpoint is configured to scale-to-zero after a few
    hours idle, so the first call after a cold period bubbles up a 503
    from upstream. We wait the endpoint out with a fixed backoff instead
    of giving up — subsequent calls in the same session hit warm pods
    and return in seconds.
    """
    last_err = None
    for attempt in range(max_503_retries + 1):
        try:
            with httpx.Client(timeout=300) as cx:
                r = cx.post(
                    f"{BACKEND_URL}/generate",
                    json={"prompt": prompt_dna, "max_tokens": max_tokens,
                          "temperature": temperature, "top_p": 1.0},
                )
                r.raise_for_status()
                out = []
                for line in r.text.splitlines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    payload = json.loads(line[5:].strip())
                    if "error" in payload:
                        msg = str(payload["error"])
                        if "503" in msg and attempt < max_503_retries:
                            raise RuntimeError(msg)
                        raise RuntimeError(msg)
                    t = payload.get("text") or ""
                    out.append(t)
            text = ("".join(out)).upper()
            return "".join(c for c in text if c in "ACGT")
        except (httpx.HTTPStatusError, RuntimeError) as e:
            msg = str(e)
            last_err = e
            if "503" in msg and attempt < max_503_retries:
                print(f"    … HF endpoint cold, waiting {retry_wait_s}s "
                      f"(attempt {attempt+1}/{max_503_retries+1})", flush=True)
                time.sleep(retry_wait_s)
                continue
            raise
    raise last_err if last_err else RuntimeError("carbon_continue: unreachable")


def nim_fold(api_key, sequence):
    """Call NVIDIA NIM ESMFold and return {pdb, plddt_mean, n_residues}.
    Mirrors app.py's /fold logic — same endpoint, same JSON shape."""
    with httpx.Client(timeout=180) as cx:
        r = cx.post(
            NIM_FOLD_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"sequence": sequence},
        )
        r.raise_for_status()
        data = r.json()
    pdb = (data.get("pdbs") or [None])[0] or data.get("pdb") or ""
    if not pdb:
        raise RuntimeError("NIM returned no PDB")
    plddts = []
    for line in pdb.splitlines():
        if line.startswith("ATOM") and line[12:16].strip() == "CA":
            try:
                plddts.append(float(line[60:66].strip()))
            except ValueError:
                pass
    return {
        "pdb": pdb,
        "n_residues": len(plddts),
        "plddt_mean": (sum(plddts) / len(plddts)) if plddts else None,
    }


def precompute_folds(client, only_missing=False):
    api_key = os.environ.get("NVIDIA_API_KEY")
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY missing (set in .env or env)")
    path = os.path.join(DATA, "genes.json")
    genes = json.load(open(path))
    for g in genes:
        if not g.get("exons"):
            continue
        if only_missing and g.get("fold_example"):
            print(f"  skipping {g['symbol']} (fold_example already cached)")
            continue
        last_exon_end = g["exons"][-1]["end"]
        n_tries = FOLD_BEST_OF_LONG if last_exon_end > FOLD_LONG_THRESHOLD else FOLD_BEST_OF_SHORT
        print(f"  folding {g['symbol']} (last exon end {last_exon_end} bp, best-of-{n_tries})…", flush=True)
        try:
            seq = g["seq"].upper()
            ref_mrna = splice_exons(seq, g["exons"])
            ref_orf = find_longest_orf(ref_mrna, 30)
            if not ref_orf:
                raise RuntimeError("reference has no valid ORF after splice")

            prompt = "".join(c for c in seq[:FOLD_PREFIX_LEN] if c in "ACGT")
            gen_bp = max(0, last_exon_end - FOLD_PREFIX_LEN) + 60
            max_tokens = (gen_bp // 6) + 8

            # Best-of-N: at T>0 the model's continuation can stop early on
            # a fluky premature codon. Try a few times and keep the longest
            # ORF — closer to "what Carbon usually produces for this gene".
            carbon_orf = None
            for attempt in range(n_tries):
                t0 = time.time()
                cont = carbon_continue(client, prompt, max_tokens, FOLD_TEMPERATURE)
                carbon_dna = (prompt + cont)[: FOLD_PREFIX_LEN + gen_bp]
                carbon_mrna = splice_exons(carbon_dna, g["exons"])
                orf = find_longest_orf(carbon_mrna, 30)
                n = len(orf["aa"]) if orf else 0
                print(f"    carbon try {attempt+1}/{n_tries}: ORF {n} aa ({time.time()-t0:.1f}s)")
                if orf and (carbon_orf is None or len(orf["aa"]) > len(carbon_orf["aa"])):
                    carbon_orf = orf
            if not carbon_orf:
                raise RuntimeError("Carbon's spliced mRNA has no valid ORF after %d tries" % n_tries)

            # Clamp to NIM's ~1024 aa ceiling. The reference proteins are
            # all well below this; Carbon hallucinations can occasionally
            # exceed it after a mutated stop codon, in which case we just
            # fold the first FOLD_MAX_AA aa to keep the pipeline robust.
            ref_aa    = ref_orf["aa"][:FOLD_MAX_AA]
            carbon_aa = carbon_orf["aa"][:FOLD_MAX_AA]

            t0 = time.time()
            ref_fold = nim_fold(api_key, ref_aa)
            print(f"    ref fold: {ref_fold['n_residues']} aa, pLDDT {ref_fold['plddt_mean']:.1f} ({time.time()-t0:.1f}s)")
            t0 = time.time()
            carbon_fold = nim_fold(api_key, carbon_aa)
            print(f"    carbon fold: {carbon_fold['n_residues']} aa, pLDDT {carbon_fold['plddt_mean']:.1f} ({time.time()-t0:.1f}s)")

            n = min(len(carbon_aa), len(ref_aa))
            identity = sum(1 for i in range(n) if carbon_aa[i] == ref_aa[i]) / n if n else 0.0

            g["fold_example"] = {
                "prefix_len": FOLD_PREFIX_LEN,
                "temperature": FOLD_TEMPERATURE,
                "carbon_aa": carbon_aa,
                "ref_aa": ref_aa,
                "carbon_pdb": carbon_fold["pdb"],
                "ref_pdb": ref_fold["pdb"],
                "carbon_plddt_mean": carbon_fold["plddt_mean"],
                "ref_plddt_mean": ref_fold["plddt_mean"],
                "identity_1d": identity,
            }
            print(f"    ✓ identity {identity*100:.1f}%  ({len(carbon_aa)}/{len(ref_aa)} aa)")
        except Exception as e:
            print(f"    ✗ {e}  (keeping previous fold_example if any)", file=sys.stderr)
    json.dump(genes, open(path, "w"), indent=2)
    print(f"  wrote {path}")


def main():
    argv = set(sys.argv[1:])
    only_folds = "--folds" in argv
    skip_folds = "--no-folds" in argv
    only_missing = "--only-missing" in argv

    client = make_client()
    if not only_folds:
        print("=== precomputing likelihood tracks ===")
        precompute_tracks(client)
        print()
        print("=== precomputing VEP scores ===")
        precompute_vep(client)
    if not skip_folds:
        print()
        print("=== precomputing fold fixtures ===")
        precompute_folds(client, only_missing=only_missing)


if __name__ == "__main__":
    main()
