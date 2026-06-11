import csv
import hashlib
import json
import os

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI

ENDPOINT_URL = os.environ.get(
    "ENDPOINT_URL",
    # NOTE: must end in /v1/ — the OpenAI SDK v1+ appends "completions"
    # directly to base_url with no auto /v1/ prefix. The HF dedicated
    # endpoint serves the OpenAI-compatible API at /v1/completions, so
    # without the suffix the SDK hits /completions and the endpoint
    # returns 404. Upstream commit 2831701 dropped the /v1/ but HF Spaces
    # masks this via an ENDPOINT_URL secret that includes it; running
    # locally with the default URL needs the suffix put back.
    "https://cr2l9w72ys5pp8le.us-east-1.aws.endpoints.huggingface.cloud/v1/",
)
MODEL_NAME = os.environ.get(
    "MODEL_NAME",
    "HuggingFaceBio/Carbon-3B",
)

# NVIDIA NIM ESMFold endpoint (alignment-free protein structure prediction).
# Schema: POST {"sequence": "<AA>"} → {"pdbs": ["<PDB string>"]}.
# Constraints: max 1024 aa, charset = 20 standard AAs only.
NIM_FOLD_URL = os.environ.get(
    "NIM_FOLD_URL",
    "https://health.api.nvidia.com/v1/biology/nvidia/esmfold",
)
FOLD_MAX_LEN = 1024
FOLD_AA_ALPHABET = "ARNDCQEGHILKMFPSTWYV"

# In-memory cache: sha1(sequence) → result dict. ESMFold is deterministic at
# temperature 0, so caching is safe and lets demo viewers replay the same
# protein for free. Bounded to keep memory predictable on long-running Spaces.
_FOLD_CACHE: dict[str, dict] = {}
_FOLD_CACHE_MAX = 256

HERE = os.path.dirname(os.path.abspath(__file__))

# Absolute base URL used to fill {{SITE_URL}} placeholders in demo.html,
# sitemap.xml and robots.txt (og:image, canonical, sitemap reference…).
# If unset, we derive it per-request from the X-Forwarded-* headers (HF
# Spaces sits behind a proxy that sets them) so og:image, canonical and
# the sitemap stay correct on whatever host the page is served from.
SITE_URL_ENV = os.environ.get("SITE_URL", "").rstrip("/")


def site_url_for(request: Request) -> str:
    """Return the absolute origin (scheme://host, no trailing slash)."""
    if SITE_URL_ENV:
        return SITE_URL_ENV
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    # X-Forwarded-Host may carry a comma-separated chain when multiple
    # proxies are involved; the original client-visible host is the
    # first entry. Host header is the fallback.
    fwd_host = request.headers.get("x-forwarded-host")
    if fwd_host:
        host = fwd_host.split(",")[0].strip()
    else:
        host = request.headers.get("host") or request.url.netloc
    return f"{scheme}://{host}"


def _load_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


# Templates loaded once at startup. demo.html and social-banner.html are
# large; reading them on every request would add ~100 us of syscall +
# parse overhead each time, which adds up under load. The substitution
# itself (a single str.replace) is cheap.
#
# DEV=1 disables the cache and re-reads from disk on every request so
# edits to demo.html / social-banner.html / robots / sitemap / llms show
# up on the next reload without restarting the server.
DEV = bool(os.environ.get("DEV"))

_TEMPLATE_PATHS = {
    "demo": os.path.join(HERE, "demo.html"),
    "social_banner": os.path.join(HERE, "social-banner.html"),
    "robots": os.path.join(HERE, "robots.txt"),
    "sitemap": os.path.join(HERE, "sitemap.xml"),
    "llms": os.path.join(HERE, "llms.txt"),
}
_TEMPLATE_CACHE = {name: _load_text(path) for name, path in _TEMPLATE_PATHS.items()}


def template(name: str) -> str:
    if DEV:
        return _load_text(_TEMPLATE_PATHS[name])
    return _TEMPLATE_CACHE[name]


def render(template: str, site_url: str) -> str:
    return template.replace("{{SITE_URL}}", site_url)


def get_api_key():
    key = os.environ.get("HF_TOKEN")
    if key:
        return key
    try:
        from huggingface_hub import get_token
        return get_token()
    except Exception:
        return None


def left_pad_to_six(seq: str) -> tuple[str, int]:
    """Prepend 'A's so the DNA length is a multiple of 6 (Carbon's BPE token width).

    Without padding, the endpoint right-pads with 'A's, which means the model's
    next-token prediction is conditioned on phantom 'A's *at the end* of the
    immediate context — exactly the part that influences the next prediction
    most. Left-padding instead pushes the phantom bases into the older context
    so the user's actual prompt is what the model sees right before the
    prediction boundary.

    Returns (padded_sequence, n_phantom_bases_prepended).
    """
    if not seq:
        return seq, 0
    rem = len(seq) % 6
    if rem == 0:
        return seq, 0
    n_pad = 6 - rem
    return ("A" * n_pad) + seq, n_pad


app = FastAPI()
# Compress responses >= 1 KB. Mostly aimed at /umap (~4 MB binary blob
# → ~2 MB on the wire) and the JSON gene/variant/species catalogs.
# compresslevel=6 is the gzip(1) system default — within ~3% of level 9
# in ratio but ~5x cheaper in CPU. Worth it on every request.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
app.mount("/img", StaticFiles(directory=os.path.join(HERE, "img")), name="img")

# Modular CSS / JS for demo.html. demo.html used to be a 6 kLOC monolith
# with a single inline <style> and <script>; the assets/ tree splits it
# into per-section files. Mounted as static so the browser can fetch
# them by relative URL (/assets/styles/*.css, /assets/js/**/*.js).
ASSETS = os.path.join(HERE, "assets")
if os.path.isdir(ASSETS):
    app.mount(
        "/assets",
        StaticFiles(directory=ASSETS),
        name="assets",
    )

# Side-by-side prototypes for alternate UMAP annotation styles. Mounted as a
# static directory so the HTML files can fetch /umap and /umap_labels without
# CORS, and so changes are picked up without restarting uvicorn (--reload).
# `html=True` makes /experiments/umap-annotations/ resolve to its index.html
# automatically.
EXPERIMENTS = os.path.normpath(os.path.join(HERE, "..", "experiments"))
if os.path.isdir(EXPERIMENTS):
    app.mount(
        "/experiments",
        StaticFiles(directory=EXPERIMENTS, html=True),
        name="experiments",
    )


# Disable browser caching for paths we iterate on during dev (the
# experiments/ playground and assets/ where the split CSS/JS live).
# Safari and Chrome both cache .js/.css aggressively by default (often
# serving a stale file even after a soft reload) and that has burned
# the design loop more than once. The cost of always refetching a
# 30 KB module is negligible vs the cost of "I don't see my changes,
# are you sure you saved it?".
_NO_CACHE_PREFIXES = ("/experiments/", "/assets/")


@app.middleware("http")
async def no_cache_dev_assets(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(_NO_CACHE_PREFIXES):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.get("/")
def root(request: Request):
    return HTMLResponse(render(template("demo"), site_url_for(request)))


@app.get("/demo")
def demo(request: Request):
    return HTMLResponse(render(template("demo"), site_url_for(request)))


@app.get("/sandbox-only")
def sandbox_only():
    # Old standalone sandbox kept around for any deep links
    return FileResponse(os.path.join(HERE, "index.html"))


@app.get("/social-banner")
def social_banner(request: Request):
    # Standalone hero — wordmark + subtitle + specs + animated DNA helix,
    # sized to fit common social-media canvases (Twitter / OG / LinkedIn /
    # HF). Used to grab cover-art screenshots without firing up the full
    # demo page.
    return HTMLResponse(render(template("social_banner"), site_url_for(request)))


# ---------------------------------------------------------------------
# Discoverability surface: robots.txt, sitemap.xml, llms.txt, favicon.
# These are tiny files but they are what indexers, AI answer engines
# (Perplexity, ChatGPT browsing…) and social previews look for first.
# ---------------------------------------------------------------------


@app.get("/robots.txt", response_class=PlainTextResponse)
def robots_txt(request: Request):
    return PlainTextResponse(render(template("robots"), site_url_for(request)))


@app.get("/sitemap.xml")
def sitemap_xml(request: Request):
    return Response(
        content=render(template("sitemap"), site_url_for(request)),
        media_type="application/xml",
    )


@app.get("/llms.txt", response_class=PlainTextResponse)
def llms_txt():
    # llms.txt (https://llmstxt.org/) — Markdown index aimed at LLM-based
    # agents that need a compact map of the site without scraping the
    # whole editorial page. No {{SITE_URL}} substitution: links are
    # either site-relative or absolute to canonical external URLs.
    return PlainTextResponse(template("llms"), media_type="text/markdown; charset=utf-8")


@app.get("/favicon.ico")
def favicon():
    # Browsers ask for /favicon.ico whether or not the page declared one.
    # Redirect to the SVG logo so we don't ship a 404 on every cold load.
    return RedirectResponse(url="/img/logo.svg", status_code=301)


@app.get("/reel")
def reel():
    # Scripted demo tour: loads /demo in an iframe and walks through the
    # header → sandbox → DNA Lab §1-§7 with title cards and ken-burns
    # transitions. Screen-record this page for socials.
    return FileResponse(os.path.join(HERE, "social_reel.html"))


@app.get("/config")
def config():
    return {"model": MODEL_NAME}


@app.get("/genes")
def genes():
    return FileResponse(os.path.join(HERE, "data", "genes.json"), media_type="application/json")


@app.get("/variants")
def variants():
    return FileResponse(os.path.join(HERE, "data", "variants.json"), media_type="application/json")


@app.get("/species")
def species():
    return FileResponse(os.path.join(HERE, "data", "species.json"), media_type="application/json")


@app.get("/umap")
def umap():
    """Binary packed scatter (int16 positions + uint8 categories) for §6.

    The §6 frontend fetches this as an ArrayBuffer and feeds it straight
    into WebGL — no JSON parse, no per-point allocations. See
    scripts/gen_fake_umap.py for the binary layout.
    """
    return FileResponse(
        os.path.join(HERE, "data", "umap.bin"),
        media_type="application/octet-stream",
    )


def _load_highlight_csv(path):
    """Read a (name, umap2d_x, umap2d_y[, species, hox_cluster]) CSV and
    return a list of point dicts: {x, y, name, species?, group?}.

    The two highlight CSVs in annotations/ have slightly different columns
    (HOX has a `hox_cluster` letter, mitochondrial doesn't) but both share
    name + umap2d_x + umap2d_y + species, which is all the frontend needs.
    """
    out = []
    with open(path) as f:
        for row in csv.DictReader(f):
            try:
                x = float(row["umap2d_x"])
                y = float(row["umap2d_y"])
            except (KeyError, ValueError):
                continue
            pt = {"x": x, "y": y, "name": row.get("name", "")}
            if row.get("species"):
                pt["species"] = row["species"]
            if row.get("hox_cluster"):
                pt["group"] = row["hox_cluster"]
            out.append(pt)
    return out


_HIGHLIGHTS_CACHE = None


def _build_highlights():
    """Read annotations/*.csv and pack into one JSON payload for §6.

    Each "track" carries:
      - `key`     : id used by the frontend pill (`hox` / `mito`)
      - `label`   : human-readable name shown on the pill
      - `blurb`   : one-liner editorial caption (colleague-supplied)
      - `points`  : raw umap2d positions; the frontend matches each one to
                    its slot in data/umap.bin (via row_idx where the CSV
                    carries it, nearest-coord snap otherwise) so the
                    highlight reuses the existing WebGL points instead of
                    drawing new geometry.
    """
    ann_dir = os.path.join(HERE, "annotations")
    tracks = []

    hox_path = os.path.join(ann_dir, "hox_genes.csv")
    if os.path.isfile(hox_path):
        tracks.append({
            "key": "hox",
            "label": "HOX genes",
            "blurb": "key developmental regulators",
            "points": _load_highlight_csv(hox_path),
        })

    mito_path = os.path.join(ann_dir, "mitochondrial_genes.csv")
    if os.path.isfile(mito_path):
        tracks.append({
            "key": "mito",
            "label": "Mitochondrial",
            "blurb": "encoded outside the nuclear genome",
            "points": _load_highlight_csv(mito_path),
        })

    return {"tracks": tracks}


@app.get("/highlights")
def highlights():
    """Curated gene highlights overlaid on the §6 UMAP.

    Sourced from annotations/*.csv (committed alongside the data, not
    generated). Cached on first call — the CSVs are tiny but parsing on
    every request is still wasted work.
    """
    global _HIGHLIGHTS_CACHE
    if _HIGHLIGHTS_CACHE is None:
        _HIGHLIGHTS_CACHE = _build_highlights()
    return _HIGHLIGHTS_CACHE


@app.get("/umap_labels")
def umap_labels():
    return FileResponse(
        os.path.join(HERE, "data", "umap_labels.json"),
        media_type="application/json",
    )


@app.get("/umap_names")
def umap_names():
    """Per-point gene-name strip (~6.5 MB raw → ~1.9 MB gzipped).

    One name per line, in the same species-sorted order as the columns
    inside /umap. Tooltip-only metadata: the frontend lazy-fetches this
    AFTER the WebGL render is up, so the long parse never gates the
    initial scatter paint. Plain text on purpose — JSON.parse over half
    a million tiny strings is a measurable hot spot vs `split('\\n')`.
    """
    return FileResponse(
        os.path.join(HERE, "data", "umap_names.txt"),
        media_type="text/plain; charset=utf-8",
    )


@app.get("/species_tree")
def species_tree():
    """Pre-computed species tree from Carbon-3B mean embeddings (§7).

    Contains: per-species centroid distance matrix (27x27), Ward + UPGMA
    linkage matrices, dendrogram layout (icoord/dcoord/leaf order) so
    the frontend can render the SVG spine without re-implementing scipy,
    plus per-species kingdom + expected NCBI clade for the comparison
    track. Built by scripts/build_species_tree.py from the raw
    embeddings.npy (not shipped in the repo — too large).
    """
    return FileResponse(
        os.path.join(HERE, "data", "species_tree.json"),
        media_type="application/json",
    )


@app.post("/score")
async def score(request: Request):
    """Return per-token logprobs over a (forced) sequence using echo=True.

    Body: { "sequence": "ACGT...", "max_window": 24000 }
    The sequence is uppercased, filtered to ACGTN, and prefixed with <dna>.
    Sequence length should be a multiple of 6 for clean tokenization;
    otherwise the model pads with phantom bases at the end.
    """
    body = await request.json()
    seq = (body.get("sequence") or "").upper()
    seq = "".join(c for c in seq if c in "ACGTN")
    max_window = int(body.get("max_window", 24000))
    if len(seq) > max_window:
        seq = seq[:max_window]
    seq_padded, pad_bases = left_pad_to_six(seq)

    api_key = get_api_key()
    if not api_key:
        return {"error": "no HF token available"}

    try:
        client = OpenAI(base_url=ENDPOINT_URL, api_key=api_key)
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
            "tokens": lp.tokens,
            "token_logprobs": lp.token_logprobs,
            "pad_bases": pad_bases,        # number of phantom 'A's prepended
            "input_length": len(seq),      # caller's actual sequence length
        }
    except Exception as e:
        return {"error": str(e)}


@app.post("/generate")
async def generate(request: Request):
    body = await request.json()
    prompt = (body.get("prompt") or "").strip().upper()
    max_tokens = int(body.get("max_tokens", 128))
    temperature = float(body.get("temperature", 0.5))
    top_p = float(body.get("top_p", 0.9))

    api_key = get_api_key()
    if not api_key:
        return {"error": "no HF token available — set HF_TOKEN env var or run `huggingface-cli login`"}

    prompt_padded, _pad = left_pad_to_six(prompt)
    full_prompt = "<dna>" + prompt_padded

    def stream():
        try:
            client = OpenAI(base_url=ENDPOINT_URL, api_key=api_key)
            completion = client.completions.create(
                model=MODEL_NAME,
                prompt=full_prompt,
                stream=True,
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                logprobs=5,
            )
            for chunk in completion:
                ch = chunk.choices[0]
                payload = {}
                if ch.text:
                    payload["text"] = ch.text
                if ch.logprobs and ch.logprobs.tokens:
                    payload["logprobs"] = {
                        "tokens": ch.logprobs.tokens,
                        "token_logprobs": ch.logprobs.token_logprobs,
                        "top_logprobs": ch.logprobs.top_logprobs,
                    }
                if payload:
                    yield f"data: {json.dumps(payload)}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


def _extract_plddt(pdb: str) -> list[float]:
    """Pull the per-residue pLDDT confidence out of the PDB B-factor column.

    ESMFold writes its pLDDT score (0-100) into the B-factor field of every
    atom. We sample CA atoms only so we get exactly one value per residue.
    """
    plddts: list[float] = []
    for line in pdb.split("\n"):
        if not line.startswith("ATOM"):
            continue
        if line[12:16].strip() != "CA":
            continue
        try:
            plddts.append(float(line[60:66]))
        except (ValueError, IndexError):
            pass
    return plddts


@app.post("/fold")
async def fold(request: Request):
    """Predict a protein's 3D structure from its amino-acid sequence.

    Body: {"sequence": "<AA>"}
    Returns on success: {"pdb": str, "n_residues": int, "plddt_mean": float}
    Returns on failure: {"error": str}

    Implementation: thin proxy in front of NVIDIA NIM's ESMFold endpoint.
    We strip non-standard characters (e.g. stop codons), enforce the 1024 aa
    cap, and cache results by sha1(sequence) — ESMFold is deterministic so
    caching is safe and free.
    """
    body = await request.json()
    raw = (body.get("sequence") or "").upper()
    # NIM rejects anything outside the 20 standard AAs; strip eagerly so the
    # caller doesn't need to know the exact regex.
    seq = "".join(c for c in raw if c in FOLD_AA_ALPHABET)
    if not seq:
        return {"error": "sequence empty after filtering to standard amino acids"}
    if len(seq) > FOLD_MAX_LEN:
        seq = seq[:FOLD_MAX_LEN]

    key = hashlib.sha1(seq.encode()).hexdigest()
    cached = _FOLD_CACHE.get(key)
    if cached is not None:
        return {**cached, "cached": True}

    api_key = os.environ.get("NVIDIA_API_KEY")
    if not api_key:
        return {"error": "no NVIDIA_API_KEY env var — set it in .env"}

    try:
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                NIM_FOLD_URL,
                json={"sequence": seq},
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json",
                },
            )
    except httpx.RequestError as e:
        return {"error": f"NIM call failed: {e}"}
    if resp.status_code != 200:
        return {"error": f"NIM HTTP {resp.status_code}: {resp.text[:300]}"}
    try:
        data = resp.json()
    except json.JSONDecodeError as e:
        return {"error": f"NIM returned non-JSON: {e}"}

    pdb = (data.get("pdbs") or [None])[0]
    if not pdb:
        return {"error": "NIM response had no PDB payload"}

    plddts = _extract_plddt(pdb)
    result = {
        "pdb": pdb,
        "n_residues": len(plddts),
        "plddt_mean": (sum(plddts) / len(plddts)) if plddts else None,
    }

    # FIFO eviction. Dicts preserve insertion order in Python 3.7+ so the
    # oldest entry is always next(iter(...)). Crude but the cache is a perf
    # nicety, not a correctness mechanism.
    if len(_FOLD_CACHE) >= _FOLD_CACHE_MAX:
        _FOLD_CACHE.pop(next(iter(_FOLD_CACHE)), None)
    _FOLD_CACHE[key] = result
    return result
