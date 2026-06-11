// =========================================================================
// §6, UMAP scatter (WebGL, 571K points)
//
// Loads a binary-packed scatter (int16 quantized 2D positions + 4 uint8 category
// columns, species, biotype, strand, gc_content) and renders it via WebGL
// gl.POINTS with a 1D palette texture for coloring. Toggle between coloring axes
// (species / biotype / strand / gc) rebinds a single byte-attribute buffer and
// swaps the palette texture, no re-upload of the 571K vertex stream. Hover
// lookup uses a flat grid index so picking stays O(small) regardless of total
// point count.
// =========================================================================
(function initDemoUmap() {
  const canvas = document.getElementById("dumap-canvas");
  if (!canvas) return;
  const tooltip = document.getElementById("dumap-tooltip");
  const overlay = document.getElementById("dumap-overlay");
  const modeDesc = document.getElementById("dumap-mode-desc");
  const legend  = document.getElementById("dumap-legend");
  const resetBtn = document.getElementById("dumap-reset");
  // The UMAP toolbar used to ship a `<span class="status">` indicator that
  // showed "loading…" / "loaded 571k pts · 1274 ms" / "error" next to the
  // pills. Removed because (a) loading is already explained by the fullscreen
  // overlay, (b) the post-load metric was telemetry-grade detail not visitor-
  // grade insight. Calls into setStatus below survive as no-ops so the live
  // load path doesn't have to be rewritten.
  const status     = null;
  const statusText = null;
  const colorPills = document.querySelectorAll("#dumap-color-pills .pill");
  const elN   = document.getElementById("dumap-n");
  const elNsp = document.getElementById("dumap-nsp");
  const elFps = document.getElementById("dumap-fps");
  const annContainer = document.getElementById("dumap-annotations");
  const hlPills    = document.getElementById("dumap-highlight-pills");

  // ---- Palettes ----------------------------------------------------------
  // 27 species grouped into 6 kingdoms, each kingdom gets a hue band.
  // Within a band, lightness varies to keep adjacent species distinguishable.
  // Order MUST match labels.species (= the order from scripts/build_real_umap.py).
  const SPECIES_PALETTE = [
    // vertebrates (10), blue/indigo/violet band
    [40,80,160], [60,100,180], [80,120,195], [100,140,210], [120,160,225],
    [140,100,200], [160,120,215], [125,90,170], [105,75,150], [85,60,130],
    // invertebrates (2), orange band
    [220,110,30], [240,160,70],
    // plants (5), olive/lime band (intentionally different from Carbon's
    // signal-green #317f3f so the UI chrome doesn't blend with the data)
    [85,140,55], [115,170,75], [145,200,100], [175,220,135], [205,240,170],
    // fungi (5), magenta/rose band
    [180,40,110], [200,70,140], [220,100,160], [235,130,175], [245,160,190],
    // bacteria (3), ochre/amber band
    [180,140,40], [200,160,60], [220,180,80],
    // viruses (2), deep red band (outliers, intentionally dramatic)
    [160,30,40], [200,50,55],
  ];
  // protein_coding is ~80% of the points, using a saturated colour for it
  // floods the canvas and erases the three minority biotypes. We give it a
  // washed-out sage instead (still readable as "the green class") and crank
  // the saturation on the rare classes so they pop on top of the carpet.
  const BIOTYPE_PALETTE = [
    [180,205,180], // protein_coding, washed sage (volume class)
    [210,55,45],   // lncRNA         , vivid Carbon red
    [40,100,200],  // snRNA          , vivid blue
    [240,160,30],  // misc_RNA       , amber (was gray, invisible)
  ];
  // Forward / reverse strand. Bleu / orange dérivés de la palette Okabe-Ito,
  // standard en visu scientifique pour les oppositions binaires : reste
  // lisible en deutéranopie et protanopie (les deux formes les plus courantes
  // de daltonisme), là où le couple vert/reverse-rouge typique s'effondre en
  // deux gris indistincts.
  const STRAND_PALETTE = [
    [0,114,178],   // + (forward), Okabe-Ito blue
    [213,94,0],    // - (reverse), Okabe-Ito vermillion
  ];
  // Continuous gradient for gc_content (uint8 0..255 → [0, 1]).
  // 3-stop: low GC (AT-rich) reads as cool steel, mid as neutral, high
  // GC (GC-rich) as warm amber, natural "density" feel without
  // colliding with the categorical palettes.
  function buildGCPalette() {
    const out = [];
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r, g, b;
      if (t < 0.5) {
        const u = t * 2;
        r = Math.round(60  + (170 - 60)  * u);
        g = Math.round(90  + (170 - 90)  * u);
        b = Math.round(160 + (170 - 160) * u);
      } else {
        const u = (t - 0.5) * 2;
        r = Math.round(170 + (230 - 170) * u);
        g = Math.round(170 + (190 - 170) * u);
        b = Math.round(170 + (50  - 170) * u);
      }
      out.push([r, g, b]);
    }
    return out;
  }
  const GC_PALETTE = buildGCPalette();
  // Continuous gradient for log10(gene length). Sequential single-hue
  // ordering (deep teal → warm sand → terracotta) so the eye reads it as
  // "more vs less" rather than "category A vs B". Picked to be visually
  // distinct from GC's divergent steel→amber ramp so the two continuous
  // overlays don't read as the same axis at a glance.
  function buildLengthPalette() {
    const out = [];
    const A = [25,  70,  90];   // 0%   short
    const B = [180, 165, 130];  // 50%  mid
    const C = [200, 105, 65];   // 100% long
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let lo, hi, u;
      if (t < 0.5) { lo = A; hi = B; u = t * 2; }
      else         { lo = B; hi = C; u = (t - 0.5) * 2; }
      out.push([
        Math.round(lo[0] + (hi[0] - lo[0]) * u),
        Math.round(lo[1] + (hi[1] - lo[1]) * u),
        Math.round(lo[2] + (hi[2] - lo[2]) * u),
      ]);
    }
    return out;
  }
  const LENGTH_PALETTE = buildLengthPalette();
  // Highlight palettes are 2-class [not-in-set, in-set]. The alpha on
  // class 0 fades the rest of the scatter to a near-paper ghost so the
  // foreground class reads as the figure, the rest as ground.
  const HOX_PALETTE = [
    [205, 205, 205,  20],   // off, dim grey ghost
    [124,  58, 237, 255],   // HOX, vivid violet
  ];
  const MITO_PALETTE = [
    [205, 205, 205,  20],   // off
    // Deep magenta. Amber (the obvious "iron / cytochrome" pick) sat too
    // bright against the dimmed grey carpet — luminance ~136 vs the HOX
    // violet's ~98 — so the points washed out. This pink-700 lands in
    // the same low-luminance band as the HOX violet, contrasting on
    // hue rather than brightness so both highlight modes feel equally
    // present.
    [190,  24,  93, 255],   // mito
  ];
  const PALETTES = {
    species: SPECIES_PALETTE,
    biotype: BIOTYPE_PALETTE,
    strand:  STRAND_PALETTE,
    gc:      GC_PALETTE,
    length:  LENGTH_PALETTE,
    hl_hox:  HOX_PALETTE,
    hl_mito: MITO_PALETTE,
  };

  // Format a bp count for the hover tooltip: "873 bp", "12.4 kb", "2.4 Mb".
  // Picks the smallest unit that keeps the displayed number under ~1000,
  // mirroring how genome browsers (UCSC, Ensembl) write spans.
  function formatBp(bp) {
    if (!Number.isFinite(bp) || bp < 0) return "·";
    if (bp < 1000)      return `${bp.toLocaleString("en-US")} bp`;
    if (bp < 1_000_000) return `${(bp / 1000).toFixed(bp < 10_000 ? 2 : 1)} kb`;
    return `${(bp / 1_000_000).toFixed(bp < 10_000_000 ? 2 : 1)} Mb`;
  }

  // ---- State -------------------------------------------------------------
  let gl, program;
  let posBuf;                          // int16 interleaved x,y
  let catBufs = {};                    // { species|biotype|strand|gc|length: GLBuffer of uint8 }
  let paletteTex;
  let n = 0;
  let labels = null;                   // see scripts/build_real_umap.py for the full schema
  // Raw category bytes, kept on CPU side too for tooltip lookups.
  let cats = { species: null, biotype: null, strand: null, gc: null, length: null };
  // Per-point gene names, lazy-fetched from /umap_names AFTER the WebGL
  // render is up so the heavy text strip never gates first paint. Stays
  // null in the window between scatter render and names land; tooltip
  // falls back to em-dash in that interval. Re-aligned to the shuffled
  // order via `shufflePerm` so names line up with positions.
  let names = null;
  let shufflePerm = null;
  // World bounds + current colorBy axis.
  let bounds = [0,0,0,0];
  let colorBy = "species";
  // Unified active mode: a colour-by key ("species", "biotype", …) OR
  // a highlight key prefixed with "hl:" ("hl:hox"). The two pill rows
  // funnel through setMode() so only one can ever be active at a time;
  // updateAnnotations() filters labels off this value.
  let currentMode = "species";
  // Viewport: translate (tx, ty) + scale around origin, in NDC space.
  // We *don't* show the data fully fit-to-canvas at zoom 1: the UMAP layout
  // has a wide empty band along the top edge and a smaller one on the left,
  // and fit-all wastes ~40% of the viewport on whitespace. Instead the
  // landing view is biased toward the bottom-right (where Vertebrates, Plants,
  // Fungi/Bacteria/Viruses sit) with a moderate zoom so the dense clusters
  // fill the frame on first paint. The same view doubles as the minimum
  // zoom-out (scale ≥ MIN_SCALE in the wheel handler) so visitors can pan
  // around but can never zoom *back* into the empty-margins view.
  const MIN_SCALE = 1.35;
  // Default framing = the bottom-right *extreme* reachable by pan at MIN_SCALE.
  // clampPan() allows |tx|, |ty| ≤ 0.92·scale − 1 before whitespace would creep
  // in at an edge; pinning the default to that exact corner means visitors land
  // on the densest framing possible, and from the reset state they can only
  // pan up / left into the rest of the layout — never down / right into empty
  // space they shouldn't be looking at.
  // Y_EXTRA: extra downward pan slack (in NDC) so the editorial framing can sit
  // a touch below the natural bottom clamp — trades a thin sliver of whitespace
  // along the bottom for a heavier anchor on the bottom-right clusters.
  const PAN_EDGE = 0.92 * MIN_SCALE - 1;
  const Y_EXTRA = 0.08;
  const DEFAULT_VIEW = { tx: -PAN_EDGE, ty: PAN_EDGE + Y_EXTRA, scale: MIN_SCALE };
  let view = { ...DEFAULT_VIEW };
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let needsRedraw = false;
  // Spatial grid for hover (built once after data load, in normalized world space).
  let grid = null;

  function setStatus(state, text) {
    if (!status) return;
    status.classList.remove("streaming", "error");
    if (state === "streaming") status.classList.add("streaming");
    if (state === "error")     status.classList.add("error");
    statusText.textContent = text;
  }

  // ---- WebGL setup -------------------------------------------------------
  const VS = `
    attribute vec2 a_pos;          // raw int16, normalized via attribPointer (-1..1)
    attribute float a_cat;         // category index (uint8 -> float)
    uniform vec3 u_xform;          // x: scale, y: tx, z: ty
    uniform float u_pointSize;
    varying float v_cat;
    void main() {
      vec2 world = a_pos * u_xform.x + vec2(u_xform.y, u_xform.z);
      gl_Position = vec4(world, 0.0, 1.0);
      gl_PointSize = u_pointSize;
      v_cat = a_cat;
    }
  `;
  const FS = `
    precision mediump float;
    varying float v_cat;
    uniform sampler2D u_palette;
    uniform float u_paletteN;
    uniform float u_alpha;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r = length(d);
      float aa = smoothstep(0.50, 0.42, r);
      if (aa <= 0.001) discard;
      // Palette texture is RGBA: the alpha channel lets a single palette
      // entry dim itself relative to the global u_alpha (used by the
      // highlight modes, where the "not in this gene set" class needs to
      // fade into the paper while the highlighted class stays vivid).
      vec4 cls = texture2D(u_palette, vec2((v_cat + 0.5) / u_paletteN, 0.5));
      float a = aa * u_alpha * cls.a;
      if (a <= 0.001) discard;
      // Pre-multiplied output matches blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
      // and prevents the dense-overlap brightening you get with straight
      // alpha (which would need blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)).
      gl_FragColor = vec4(cls.rgb * a, a);
    }
  `;
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error("shader compile: " + gl.getShaderInfoLog(sh));
    }
    return sh;
  }
  function setupGL() {
    gl = canvas.getContext("webgl", {
      antialias: true, alpha: true, premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL unavailable");
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("program link: " + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    // Standard premultiplied-alpha additive-ish blending, points blend over
    // the paper background and over each other cleanly at dense overlaps.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Transparent clear, the .umap-frame CSS background (paper tone) shows
    // through, keeping the canvas in tune with the rest of the page.
    gl.clearColor(0, 0, 0, 0);

    paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function uploadPalette(palette) {
    // Palette entries are [r, g, b] (existing colour-by palettes) or
    // [r, g, b, a] (highlight palettes that need a class to dim). Default
    // alpha to 255 keeps every existing palette pixel-identical to the
    // pre-RGBA shader.
    const n = palette.length;
    const buf = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      buf[i*4]   = palette[i][0];
      buf[i*4+1] = palette[i][1];
      buf[i*4+2] = palette[i][2];
      buf[i*4+3] = palette[i].length > 3 ? palette[i][3] : 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.uniform1f(gl.getUniformLocation(program, "u_paletteN"), n);
  }

  // ---- Data load ---------------------------------------------------------
  // Mulberry32: tiny seeded PRNG, ~10 lines, good enough for visual shuffling.
  // Picked over Math.random() because we want the same layout across reloads
  // (so users can describe what they see and we can reproduce it).
  function mulberry32(seed) {
    return function() {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fisher-Yates over N parallel arrays: pos16 (2 entries / point, x then y)
  // and catArrays (1 entry / point, e.g. species / biotype / strand / gc).
  // Mutating the typed arrays in place avoids allocating a 16 MB reshuffled
  // buffer, important at 571 K points.
  //
  // Returns a Uint32Array `perm` where perm[i] = original-index now sitting
  // at slot i. We use it to re-align the deferred-loaded gene names strip
  // onto the same shuffled order without re-running the PRNG (which would
  // require keeping its state in sync, fragile).
  function shuffleParallel(pos16, catArrays, n, seed) {
    const rand = mulberry32(seed);
    const perm = new Uint32Array(n);
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      if (i === j) continue;
      const xi = pos16[2*i],     yi = pos16[2*i + 1];
      pos16[2*i] = pos16[2*j];   pos16[2*i + 1] = pos16[2*j + 1];
      pos16[2*j] = xi;           pos16[2*j + 1] = yi;
      for (const a of catArrays) {
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      const pt = perm[i]; perm[i] = perm[j]; perm[j] = pt;
    }
    return perm;
  }

  async function loadData() {
    setStatus("streaming", "loading…");
    const t0 = performance.now();
    const [binResp, labelsResp] = await Promise.all([
      fetch("/umap"),
      fetch("/umap_labels"),
    ]);
    if (!binResp.ok) throw new Error("fetch /umap failed: " + binResp.status);
    const buf = await binResp.arrayBuffer();
    labels = await labelsResp.json();

    // Parse header (matches scripts/build_real_umap.py, 64-byte header).
    // Layout:
    //   u32 [magic, n_points, n_species, n_biotypes, n_strands, flags]   (24 b)
    //   f32 [x2d_min, x2d_max, y2d_min, y2d_max]                          (16 b)
    //   f32 [x3d_min, x3d_max, y3d_min, y3d_max, z3d_min, z3d_max]        (24 b)
    // flags bit0 = has_3D, bit1 = has gc_content, bit2 = has length.
    const hdrU32 = new Uint32Array(buf, 0, 6);
    const magic  = hdrU32[0];
    if (magic !== 0xCAB0FA1D) throw new Error("bad magic: " + magic.toString(16));
    n = hdrU32[1];
    const flags  = hdrU32[5];
    const has3D  = (flags & 0b001) !== 0;
    const hasGC  = (flags & 0b010) !== 0;
    const hasLen = (flags & 0b100) !== 0;
    const hdrF32 = new Float32Array(buf, 24, 10);
    bounds = [hdrF32[0], hdrF32[1], hdrF32[2], hdrF32[3]];
    // bounds_3d (hdrF32[4..10]) is parsed but unused, the v1 viewer
    // renders the 2D projection only. Kept in the binary so a future
    // 3D mode can switch attribute streams without re-fetching.

    let off = 64;
    const pos16 = new Int16Array(buf, off, n * 2);  off += n * 2 * 2;
    if (has3D) {
      // Skip pos_3d (int16 × 3 × n). Loaded into RAM is unnecessary
      // for v1, the binary stays small enough that re-fetching for
      // a 3D mode is fine, and skipping keeps GPU memory tight.
      off += n * 3 * 2;
    }
    cats.species = new Uint8Array(buf, off, n);     off += n;
    cats.biotype = new Uint8Array(buf, off, n);     off += n;
    cats.strand  = new Uint8Array(buf, off, n);     off += n;
    if (hasGC) {
      cats.gc    = new Uint8Array(buf, off, n);     off += n;
    }
    if (hasLen) {
      cats.length = new Uint8Array(buf, off, n);    off += n;
    }
    const catKeys = ["species", "biotype", "strand"];
    if (hasGC)  catKeys.push("gc");
    if (hasLen) catKeys.push("length");

    // Deterministic shuffle of the parallel arrays. The binary is sorted by
    // species (= order of viz.csv), so without this protein_coding (≈80% of
    // points) systematically lands on top of the minority biotypes/rare
    // species and visually erases them. A fixed seed keeps the layout stable
    // across reloads, same dot in the same place every time. Mulberry32 is
    // good enough and one line; Fisher-Yates over 571 K entries is ~30 ms.
    shufflePerm = shuffleParallel(pos16, catKeys.map(k => cats[k]), n, 0xC4B0FA1D);

    // Upload to GPU.
    posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos16, gl.STATIC_DRAW);
    for (const key of catKeys) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, cats[key], gl.STATIC_DRAW);
      catBufs[key] = b;
    }

    // Wire attributes (position is constant; category attribute is rebound on toggle).
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(posLoc);
    // normalize=true → int16 mapped to [-1, 1] in shader, exactly the
    // quantization we did in the Python packer.
    gl.vertexAttribPointer(posLoc, 2, gl.SHORT, true, 0, 0);

    // Build spatial grid (in [-1, 1]² normalized world space).
    buildGrid(pos16);

    // Annotations are computed *after* the data is in: the cluster centroids
    // they pin to are read off the actual UMAP layout we just loaded, so
    // labels point at where vertebrates / fungi / lncRNAs / etc. ended up
    // landing in this run, not at hardcoded positions that would drift if
    // Dana ever re-runs the projection with different params.
    buildAnnotations(pos16);

    elN.textContent   = n.toLocaleString("en-US");
    elN.classList.remove("muted");
    elNsp.textContent = labels.species.length;
    elNsp.classList.remove("muted");

    const ms = (performance.now() - t0) | 0;
    setStatus("idle", `loaded ${(n/1000)|0}k pts · ${ms} ms`);
    overlay.classList.add("hidden");

    return pos16;
  }

  // ---- Annotations -------------------------------------------------------
  // Cluster names sit directly on top of each cluster centroid, no leader
  // lines, no margin labels, no body copy. Each annotation is just a
  // (mode, target, key) triple: the mode says which colorBy it applies
  // to, target is a data-space (-1..1) point, key is the bold name we
  // print on top of it. Different sets fire under different colorings
  // (kingdoms under "species", RNA-class pockets under "biotype", etc.),
  // and the labels track the cluster as the user pans/zooms.
  //
  // We render the label DOM once on data load and only mutate left/top
  // per frame, so updateAnnotations() runs in <0.1 ms.
  let annotations = [];

  // Median over the (x, y) of points matching `predicate`. Median (vs mean)
  // because every UMAP cluster has a long tail; we want the dot on the
  // visible bulk, not drifting toward stragglers.
  //
  // Two-pass strategy: first try a strided sample (stride ≈ n/5000) to
  // stay <1 ms on 571 K points for the common case. If the predicate's
  // class is rare enough that the sample yields zero matches (e.g. viruses
  // here = 21 points across 571 K, ~0.004%), fall back to a full scan with
  // the same predicate, still <50 ms, and only happens once per dataset.
  function clusterCentroid(pos16, predicate) {
    const collect = (stride) => {
      const xs = [], ys = [];
      for (let i = 0; i < n; i += stride) {
        if (!predicate(i)) continue;
        xs.push(pos16[2*i]     / 32767);
        ys.push(pos16[2*i + 1] / 32767);
      }
      return [xs, ys];
    };
    const stride = Math.max(1, (n / 5000) | 0);
    let [xs, ys] = collect(stride);
    if (xs.length === 0 && stride > 1) [xs, ys] = collect(1);
    if (xs.length === 0) return null;
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const m = xs.length >> 1;
    return [xs[m], ys[m]];
  }

  function buildAnnotations(pos16) {
    // Species → kingdom mapping is shipped in umap_labels.json by
    // scripts/build_real_umap.py (the same KINGDOMS dict that drives the
    // species ordering / palette banding).
    const speciesKingdom = labels.species_kingdom || {};
    const kingdomOf      = sIdx => speciesKingdom[labels.species[sIdx]] || null;

    const ck = (k)        => clusterCentroid(pos16, i => kingdomOf(cats.species[i]) === k);
    const cb = (id)       => clusterCentroid(pos16, i => cats.biotype[i] === id);
    const gc = (lo, hi)   => clusterCentroid(pos16, i => {
      const t = cats.gc ? cats.gc[i] / 255 : 0.5;
      return t >= lo && t <= hi;
    });

    // Each entry: a target in data-space NDC and the cluster name to
    // print on top of it. No anchors, no body copy, the placement is
    // entirely data-driven (clusterCentroid) and the editorial commentary
    // lives in the "What to look for" prose under the chart.
    //
    // For "gc" we point at the high/low poles instead of the median (the
    // median sits in the middle of the bulk, where a gradient label
    // wouldn't help). For "strand" there's nothing to label, the
    // interesting fact is the *absence* of structure, not a location.
    annotations = [
      // ---- species → kingdom macro-clusters
      { mode: "species", target: ck("vertebrates"),   key: "Vertebrates" },
      { mode: "species", target: ck("invertebrates"), key: "Invertebrates" },
      { mode: "species", target: ck("plants"),        key: "Plants" },
      { mode: "species", target: ck("fungi"),         key: "Fungi" },
      { mode: "species", target: ck("bacteria"),      key: "Bacteria" },
      { mode: "species", target: ck("viruses"),       key: "Viruses" },

      // ---- biotype → RNA-class pockets
      { mode: "biotype", target: cb(0), key: "Protein-coding" },
      { mode: "biotype", target: cb(1), key: "lncRNAs" },
      { mode: "biotype", target: cb(2), key: "snRNAs" },
      { mode: "biotype", target: cb(3), key: "misc_RNA" },

      // ---- gc → composition poles. Thresholds picked from the actual
      // gc histogram of this dataset (peak ≈ 0.4): low ≤ 0.25 grabs the
      // AT-rich tail, high ≥ 0.60 grabs the GC-rich tail.
      { mode: "gc", target: gc(0.0, 0.25), key: "AT-rich" },
      { mode: "gc", target: gc(0.60, 1.0), key: "GC-rich" },
    ].filter(a => a.target);

    renderAnnotationsDOM();
    updateAnnotations();
  }

  // Build the label DOM *once* per dataset, subsequent updates only
  // mutate left/top, never innerHTML, so updateAnnotations() runs in
  // <0.1 ms and never triggers a layout thrash.
  function renderAnnotationsDOM() {
    if (!annContainer) return;
    annContainer.innerHTML = annotations
      .map((a, i) => `<div id="ann-label-${i}" class="ann-label">${a.key}</div>`)
      .join("");
  }

  // Per-frame: project each annotation's data-space target through the
  // current view transform and place the label on top of it (CSS handles
  // the centring via translate(-50%, -50%)). Annotations whose mode ≠
  // colorBy or whose target sat off-canvas after pan/zoom get hidden.
  function updateAnnotations() {
    if (!annotations.length) return;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (W === 0 || H === 0) return;

    const baseScale = 0.92;
    const dataToScreen = (dx, dy) => [
      ((dx * baseScale * view.scale + view.tx) + 1) / 2 * W,
      (1 - (dy * baseScale * view.scale + view.ty)) / 2 * H,
    ];
    // Margin so a label whose centre is just past the edge still shows
    // partially rather than popping. Tuned for the current font-size /
    // halo combo; bump if you grow the type.
    const margin = 60;

    annotations.forEach((a, i) => {
      const label = document.getElementById(`ann-label-${i}`);
      if (!label) return;

      const visible = a.mode === currentMode;
      if (!visible) { label.style.display = "none"; return; }

      const [tx, ty] = dataToScreen(a.target[0], a.target[1]);
      if (tx < -margin || tx > W + margin || ty < -margin || ty > H + margin) {
        label.style.display = "none";
        return;
      }
      label.style.display = "";
      label.style.left = tx + "px";
      label.style.top  = ty + "px";
    });
  }

  // ---- Highlights --------------------------------------------------------
  // A colleague flagged a couple of biologically meaningful gene sets (HOX
  // paralogs, the mitochondrial genome) and asked to surface them on top
  // of the embedding. Each highlight is a *view of the same 571 K WebGL
  // points* — not new geometry on top — so the rendering path stays the
  // category-buffer + palette swap we already use for "colour by". The
  // mask is a Uint8Array of length n with 1 at the slot of every gene in
  // the set and 0 elsewhere; the highlight palette dims class 0 to a
  // ghost and paints class 1 vividly so the foreground reads as figure.
  //
  // Identity matching: every gene in the highlight CSVs ships its
  // (umap2d_x, umap2d_y) coordinate, which we snap to the closest
  // WebGL slot via the spatial grid built for hover. The CSV also
  // carries `row_idx`, but that's the row in the *pre-bin* viz.csv;
  // scripts/build_real_umap.py re-buckets rows by species before
  // packing, so row_idx doesn't line up with the bin's row order and
  // can't be used as a direct index.
  let highlights = null;            // server payload {tracks: [...]}
  let hlActiveKey = null;           // single active highlight track key (or null)
  let hlMasks = {};                 // track key → GLBuffer of Uint8 mask

  // Snap a single (data-space) point to the closest WebGL slot using the
  // hover grid. Returns -1 if no point falls inside the search radius
  // (large enough here that we expect a hit for every annotated gene).
  function snapToPoint(x, y) {
    if (!grid || !posSnapshot) return -1;
    const [xMin, xMax, yMin, yMax] = labels.bounds_2d;
    const nx = (x - xMin) / (xMax - xMin) * 2 - 1;
    const ny = (y - yMin) / (yMax - yMin) * 2 - 1;
    const gx = Math.floor((nx + 1) * 0.5 * GRID_N);
    const gy = Math.floor((ny + 1) * 0.5 * GRID_N);
    let best = -1, bestD2 = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = gy + dy;
      if (yy < 0 || yy >= GRID_N) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = gx + dx;
        if (xx < 0 || xx >= GRID_N) continue;
        const cell = grid[yy * GRID_N + xx];
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const idx = cell[k];
          const px = posSnapshot[2*idx]     / 32767;
          const py = posSnapshot[2*idx + 1] / 32767;
          const d2 = (px - nx) * (px - nx) + (py - ny) * (py - ny);
          if (d2 < bestD2) { bestD2 = d2; best = idx; }
        }
      }
    }
    return best;
  }

  function buildHighlightMask(track) {
    const mask = new Uint8Array(n);
    let placed = 0;
    for (const p of track.points) {
      const slot = snapToPoint(p.x, p.y);
      if (slot >= 0) { mask[slot] = 1; placed++; }
    }
    if (placed < track.points.length) {
      console.warn(`highlight ${track.key}: placed ${placed}/${track.points.length} genes`);
    }
    return mask;
  }

  function uploadHighlightMask(key, mask) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, mask, gl.STATIC_DRAW);
    hlMasks[key] = buf;
  }

  function renderHighlightPills() {
    if (!highlights || !hlPills) return;
    hlPills.innerHTML = highlights.tracks.map(t =>
      `<button class="pill" data-track="${t.key}">${t.label}</button>`
    ).join("");
    // Highlights and "color by" are mutually exclusive views of the same
    // scatter — clicking a highlight pill takes over as the active mode;
    // re-clicking it drops back to whatever colour-by was active before.
    hlPills.querySelectorAll(".pill").forEach(pill => {
      pill.addEventListener("click", () => {
        const key = pill.dataset.track;
        setMode(hlActiveKey === key ? colorBy : ("hl:" + key));
      });
    });
  }

  // Per-mode caption: explains the *concept* behind the active axis, not
  // what's visually happening in the chart. The takeaway block below the
  // chart already does the "look at this!" framing, so this slot is
  // reserved for a quick gloss on what biotypes / GC content / HOX
  // genes / mt-DNA actually are.
  const MODE_DESCRIPTIONS = {
    species: "Each point is a gene from one of 27 species, spanning vertebrates (human, mouse, zebrafish, dog, cow, pig, chicken, frog, macaque, rat), invertebrates (fly, worm), plants (Arabidopsis, rice, soybean, maize, tomato), fungi, bacteria, and a couple of viruses.",
    biotype: "Biotype is what kind of RNA a gene produces. Protein-coding genes encode proteins. lncRNAs are long non-coding RNAs that often regulate other genes. snRNAs are small nuclear RNAs that help splice messenger RNA. misc_RNA collects the rest.",
    strand:  "DNA is double-stranded, and each gene is read in one direction along one of the two strands: forward (+) or reverse (-). Roughly half of all genes sit on each strand, with no strong regional preference.",
    gc:      "GC content is the fraction of a sequence's bases that are guanine (G) or cytosine (C) rather than adenine (A) or thymine (T). G-C base pairs are bound by three hydrogen bonds versus two for A-T, so GC-rich DNA is more thermally stable. GC content varies dramatically between organisms (bacteria range from 17% to 75%) and between regions of a single genome, often marking gene-dense vs gene-sparse zones.",
    length:  "Gene length in this dataset spans six orders of magnitude, from a few hundred base pairs (compact non-coding RNAs) up to nearly 3 million (genes with vast introns, like dystrophin in humans). Length correlates loosely with function: regulatory and developmental genes often run long, housekeeping genes short.",
    "hl:hox":  "HOX genes are a family of transcription factors that lay out the body plan during embryonic development, telling cells along the head-to-tail axis what to become. They share a conserved 60-amino-acid DNA-binding domain (the homeobox) and sit in four paralogous clusters (HOXA, HOXB, HOXC, HOXD) on different chromosomes, with deep homologs going all the way back to insects.",
    "hl:mito": "Mitochondria are energy-generating organelles inside eukaryotic cells. They carry their own small circular genome, inherited maternally and evolving independently of the nuclear DNA of their host. Because all mitochondria descend from a single ancestral endosymbiont, mt-DNA evolves on its own track inside each lineage, so mt-DNA from related species ends up looking more like other mt-DNA than like the nuclear genome it lives inside.",
  };
  function updateModeDescription() {
    if (!modeDesc) return;
    modeDesc.textContent = MODE_DESCRIPTIONS[currentMode] || "";
  }

  async function loadHighlights() {
    try {
      const r = await fetch("/highlights");
      if (!r.ok) throw new Error("highlights " + r.status);
      highlights = await r.json();
      if (!highlights.tracks || highlights.tracks.length === 0) return;
      for (const t of highlights.tracks) {
        const mask = buildHighlightMask(t);
        uploadHighlightMask(t.key, mask);
      }
      renderHighlightPills();
      requestRedraw();
    } catch (err) {
      console.warn("highlights load failed:", err);
    }
  }

  // ---- Spatial grid (hover picking) --------------------------------------
  // We store, per cell, a list of point indices whose normalized (x,y) falls
  // in that cell. At hover, look up the cell under the cursor plus the 8
  // neighbors, then scan for the nearest point within a screen-space radius.
  const GRID_N = 128;
  function buildGrid(pos16) {
    const cells = new Array(GRID_N * GRID_N);
    for (let i = 0; i < cells.length; i++) cells[i] = null;
    for (let i = 0; i < n; i++) {
      // pos16 entries are in [-32767, 32767] → normalize to [0, GRID_N).
      const x = (pos16[2*i]     + 32767) / 65534;
      const y = (pos16[2*i + 1] + 32767) / 65534;
      const cx = Math.min(GRID_N - 1, Math.max(0, (x * GRID_N) | 0));
      const cy = Math.min(GRID_N - 1, Math.max(0, (y * GRID_N) | 0));
      const id = cy * GRID_N + cx;
      const list = cells[id];
      if (list === null) cells[id] = [i];
      else list.push(i);
    }
    grid = cells;
  }

  // ---- Render ------------------------------------------------------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.round(rect.width  * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    return true;
  }

  let lastFrameTs = 0, frameCount = 0, fpsTs = 0;
  function draw() {
    needsRedraw = false;
    if (!resize()) return;
    gl.clear(gl.COLOR_BUFFER_BIT);

    // The vertex shader does world = pos * scale + (tx, ty). We choose scale
    // so the data (normalized to [-1, 1]) fits in [-0.92, 0.92] of NDC at
    // zoom 1, with a tiny margin so points at the edge aren't clipped.
    const baseScale = 0.92;
    gl.uniform3f(gl.getUniformLocation(program, "u_xform"),
                 baseScale * view.scale, view.tx, view.ty);
    // Point size scales sub-linearly with zoom, denser areas stay readable
    // but the dots get visibly bigger when you zoom in.
    const ps = Math.min(8.0, Math.max(1.4, 1.4 + 0.6 * Math.log2(view.scale + 1))) * dpr;
    gl.uniform1f(gl.getUniformLocation(program, "u_pointSize"), ps);
    // Alpha rises with zoom so individual dots stay readable, but starts low
    // so the dense 571 K cloud doesn't blow out at zoom 1. Highlight modes
    // override this to 1.0 — the foreground class needs to read as a sharp
    // figure, and the per-class palette alpha is what gates how visible
    // each side is.
    const alpha = currentMode.startsWith("hl:")
      ? 1.0
      : Math.min(0.85, Math.max(0.22, 0.22 + 0.20 * Math.log2(view.scale + 1)));
    gl.uniform1f(gl.getUniformLocation(program, "u_alpha"), alpha);

    gl.drawArrays(gl.POINTS, 0, n);

    // Annotation overlay, labels and leader lines anchored to data-space
    // centroids. Cheap (<0.1 ms for ~5 visible labels), so we just run it
    // every frame instead of trying to detect view changes.
    updateAnnotations();

    // FPS counter, sampled, not per-frame.
    const now = performance.now();
    frameCount++;
    if (now - fpsTs > 500) {
      const fps = (frameCount * 1000) / (now - fpsTs);
      elFps.textContent = `${fps.toFixed(0)} fps`;
      elFps.classList.remove("muted");
      fpsTs = now;
      frameCount = 0;
    }
    lastFrameTs = now;
  }
  function requestRedraw() {
    if (needsRedraw) return;
    needsRedraw = true;
    requestAnimationFrame(draw);
  }

  // ---- Color toggle ------------------------------------------------------
  function setColorBy(key) {
    colorBy = key;
    const catLoc = gl.getAttribLocation(program, "a_cat");
    gl.bindBuffer(gl.ARRAY_BUFFER, catBufs[key]);
    gl.enableVertexAttribArray(catLoc);
    // Unnormalized, we want the raw byte value in the shader.
    gl.vertexAttribPointer(catLoc, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    uploadPalette(PALETTES[key]);
    renderLegend();
    requestRedraw();
  }

  // ---- Mode (color-by / highlight) --------------------------------------
  // Single switchpoint that drives both pill rows. A colour-by key
  // ("species", "biotype", …) binds the per-category GL buffer + its
  // palette; a "hl:<track>" key binds the per-track highlight mask
  // (Uint8: 0/1) + its 2-class palette (dim grey + vivid colour) instead.
  // Either way it's the same a_cat attribute and the same draw call, so
  // there's no separate "highlight pass" to keep in sync.
  function setMode(key) {
    currentMode = key;
    const catLoc = gl.getAttribLocation(program, "a_cat");
    if (key.startsWith("hl:")) {
      const trackKey = key.slice(3);
      const buf = hlMasks[trackKey];
      if (!buf) return;   // mask not built yet, ignore
      hlActiveKey = trackKey;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(catLoc);
      gl.vertexAttribPointer(catLoc, 1, gl.UNSIGNED_BYTE, false, 0, 0);
      uploadPalette(PALETTES["hl_" + trackKey]);
      colorPills.forEach(p => p.classList.remove("active"));
      hlPills?.querySelectorAll(".pill").forEach(p =>
        p.classList.toggle("active", p.dataset.track === trackKey));
      // Legend doesn't add anything in highlight mode — the pill + blurb
      // already say what the foreground class is.
      if (legend) legend.innerHTML = "";
    } else {
      hlActiveKey = null;
      colorPills.forEach(p => p.classList.toggle("active", p.dataset.color === key));
      hlPills?.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
      setColorBy(key);
    }
    updateModeDescription();
    requestRedraw();
  }

  // ---- Legend ------------------------------------------------------------
  // Render a continuous-gradient legend bar for one of the two continuous
  // overlays (gc, length). Both share the same SVG shape; they just differ
  // in palette and tick labels, so we factor the duplication out.
  function renderGradientLegend(palette, ticksHtml) {
    const uid = Math.random().toString(36).slice(2, 8);
    const stops = palette
      .filter((_, i) => i % 8 === 0)  // 32 stops is plenty for a 1D bar
      .map((c, i, a) => `<stop offset="${(i / (a.length - 1)) * 100}%" stop-color="rgb(${c[0]},${c[1]},${c[2]})"/>`)
      .join("");
    legend.innerHTML =
      `<span class="item gc-grad">
         <svg width="160" height="10" aria-hidden="true">
           <defs><linearGradient id="umap-grad-${uid}" x1="0" x2="1">${stops}</linearGradient></defs>
           <rect width="160" height="10" fill="url(#umap-grad-${uid})"/>
         </svg>
         <span class="gc-ticks">${ticksHtml}</span>
       </span>`;
  }
  function renderLegend() {
    if (!labels) return;
    // gc_content is continuous, render a horizontal gradient bar with
    // 0.0 / 0.5 / 1.0 ticks instead of one swatch per value (would be
    // 256 entries, useless visually).
    if (colorBy === "gc") {
      renderGradientLegend(GC_PALETTE, "0.0 &middot; 0.5 &middot; 1.0");
      return;
    }
    if (colorBy === "length") {
      // Tick labels span the full bp range using formatBp(). Geometric
      // midpoint (sqrt of low × high) rather than arithmetic so the
      // middle tick lands at the *log-scale* centre of the gradient,
      // which is what the colour ramp is keyed on.
      const lr = labels.length_bp_range;
      const ticks = lr
        ? `${formatBp(lr[0])} &middot; ${formatBp(Math.round(Math.sqrt(lr[0] * lr[1])))} &middot; ${formatBp(lr[1])}`
        : "short &middot; mid &middot; long";
      renderGradientLegend(LENGTH_PALETTE, ticks);
      return;
    }
    const palette = PALETTES[colorBy];
    const itemLabels = (colorBy === "species") ? labels.species
                     : (colorBy === "biotype") ? labels.biotypes
                     :                            labels.strands;
    legend.innerHTML = itemLabels.map((name, i) => {
      const [r, g, b] = palette[i % palette.length];
      return `<span class="item"><span class="swatch" style="background:rgb(${r},${g},${b})"></span>${name}</span>`;
    }).join("");
  }

  // ---- Pan / zoom / hover ------------------------------------------------
  // Reset is a no-op when we're already at the fit-the-data view, so the
  // button switches to a disabled state in that case, same affordance as
  // a back-button greying out at the top of the history stack. Avoids a
  // distracting always-active control on first paint.
  function updateResetEnabled() {
    if (!resetBtn) return;
    const atDefault =
      view.tx === DEFAULT_VIEW.tx &&
      view.ty === DEFAULT_VIEW.ty &&
      view.scale === DEFAULT_VIEW.scale;
    resetBtn.disabled = atDefault;
  }
  function resetView() {
    view = { ...DEFAULT_VIEW };
    updateResetEnabled();
    requestRedraw();
  }

  // Keep the viewport always full of data. The data spans [-0.92, 0.92]·scale
  // in world space; the viewport spans [-1, 1]. As long as 0.92·scale ≥ 1
  // (zoom ≥ ~1.087), there's "slack" we can pan within: |tx| ≤ 0.92·scale-1.
  // Since MIN_SCALE > 1.087 the slack branch is always taken in practice;
  // the m === 0 fallback only kicks in if somebody later relaxes the wheel-
  // handler clamp below ~1.087, in which case data snaps to (0, 0) so no
  // white edge creeps in.
  function clampPan() {
    const m = Math.max(0, 0.92 * view.scale - 1);
    if (m === 0) {
      view.tx = 0; view.ty = 0;
    } else {
      view.tx = Math.max(-m, Math.min(m, view.tx));
      // Asymmetric Y clamp: +Y_EXTRA of slack on the downward side so the
      // editorial default framing (ty = PAN_EDGE + Y_EXTRA) survives a redraw
      // without snapping back to PAN_EDGE. Visitors can also pan that extra
      // sliver down themselves — accepted whitespace cost.
      view.ty = Math.max(-m, Math.min(m + Y_EXTRA, view.ty));
    }
  }

  // Convert a clientX/Y to NDC (-1..1) and to normalized data space ([-1, 1]).
  function clientToNDC(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x:  ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      y: -((e.clientY - rect.top)  / rect.height) * 2 + 1,
    };
  }
  function ndcToData(ndc) {
    const baseScale = 0.92;
    return {
      x: (ndc.x - view.tx) / (baseScale * view.scale),
      y: (ndc.y - view.ty) / (baseScale * view.scale),
    };
  }

  let panning = false, panLast = null;
  canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId);
    panning = true;
    panLast = { x: e.clientX, y: e.clientY };
    canvas.classList.add("panning");
    hideTooltip();
  });
  canvas.addEventListener("pointermove", e => {
    if (panning) {
      const rect = canvas.getBoundingClientRect();
      const dx =  ((e.clientX - panLast.x) / rect.width)  * 2;
      const dy = -((e.clientY - panLast.y) / rect.height) * 2;
      view.tx += dx; view.ty += dy;
      clampPan();
      updateResetEnabled();
      panLast = { x: e.clientX, y: e.clientY };
      requestRedraw();
    } else {
      handleHover(e);
    }
  });
  function endPan(e) {
    if (!panning) return;
    panning = false;
    canvas.classList.remove("panning");
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  }
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
  canvas.addEventListener("pointerleave", () => hideTooltip());

  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const ndc = clientToNDC(e);
    // Zoom factor, natural feeling on both trackpad and mouse wheel.
    const factor = Math.exp(-e.deltaY * 0.0018);
    // Min scale = MIN_SCALE (matches DEFAULT_VIEW.scale): we intentionally
    // disallow zooming further out than the bottom-right framing so the user
    // can't reach the fit-everything view where ~40% of the canvas is empty
    // margin (long whitespace band above the clusters). Max 50× keeps
    // individual points pickable.
    const newScale = Math.min(50, Math.max(MIN_SCALE, view.scale * factor));
    if (newScale === MIN_SCALE) {
      // Floor-zoom: snap back to the editorial framing instead of leaving
      // tx/ty at wherever the zoom-around-cursor formula stranded them.
      // Otherwise an off-centre wheel-out lands you at MIN_SCALE but with a
      // panned offset (Vertebrates half off-screen, big white band on top),
      // breaking the "fully zoomed out = bottom-right framing" promise.
      // The user can still drag to pan from there; the snap only fires the
      // moment we *reach* MIN_SCALE via the wheel.
      view.tx = DEFAULT_VIEW.tx;
      view.ty = DEFAULT_VIEW.ty;
      view.scale = MIN_SCALE;
    } else {
      const k = newScale / view.scale;
      // Zoom around the cursor: shift translate so the point under the cursor
      // stays under the cursor.
      view.tx = ndc.x - (ndc.x - view.tx) * k;
      view.ty = ndc.y - (ndc.y - view.ty) * k;
      view.scale = newScale;
    }
    clampPan();
    updateResetEnabled();
    requestRedraw();
    hideTooltip();
  }, { passive: false });

  resetBtn.addEventListener("click", resetView);

  // ---- Hover picking -----------------------------------------------------
  // De-quantise a uint8 length byte back to bp. Inverse of the
  // packing step in scripts/build_real_umap.py:
  //   bp = round(10 ** (log_min + b/255 * (log_max - log_min)))
  function lengthBpAt(idx) {
    if (!cats.length || !labels || !labels.length_log10_range) return null;
    const [lo, hi] = labels.length_log10_range;
    const t = cats.length[idx] / 255;
    return Math.round(Math.pow(10, lo + t * (hi - lo)));
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
    ));
  }
  function showTooltip(idx, x, y) {
    const sp = labels.species[cats.species[idx]];
    const bt = labels.biotypes[cats.biotype[idx]];
    const st = labels.strands[cats.strand[idx]];
    const gc = cats.gc ? (cats.gc[idx] / 255).toFixed(2) : "·";
    const bp = lengthBpAt(idx);
    const lenStr = bp == null ? "·" : formatBp(bp);
    // `names` may still be null if the user hovers very early (race
    // between WebGL paint and /umap_names landing), fall back to em-
    // dash; the row will silently fill in once the strip arrives.
    const nameStr = names ? escapeHtml(names[idx] || "·") : "·";
    tooltip.innerHTML =
      `<div><span class="t-label">name</span>${nameStr}</div>` +
      `<div><span class="t-label">species</span>${sp}</div>` +
      `<div><span class="t-label">biotype</span>${bt}</div>` +
      `<div><span class="t-label">length</span>${lenStr}</div>` +
      `<div><span class="t-label">strand</span>${st} &nbsp; <span class="t-label">gc</span>${gc}</div>`;
    tooltip.style.left = x + "px";
    tooltip.style.top  = y + "px";
    tooltip.classList.add("visible");
  }
  function hideTooltip() { tooltip.classList.remove("visible"); }

  function handleHover(e) {
    if (!grid) return;
    const ndc = clientToNDC(e);
    const data = ndcToData(ndc);
    // Convert data-space (-1..1) into grid coords.
    const gx = (data.x + 1) * 0.5 * GRID_N;
    const gy = (data.y + 1) * 0.5 * GRID_N;
    const cx = Math.floor(gx), cy = Math.floor(gy);
    if (cx < -1 || cx > GRID_N || cy < -1 || cy > GRID_N) return hideTooltip();

    // Adaptive search radius: at higher zoom, we want a tighter pick radius.
    // ~8px screen radius converted to data space.
    const rect = canvas.getBoundingClientRect();
    const screenR = 8;
    const dataR = (screenR / rect.width) * 2 / (0.92 * view.scale);
    const dataR2 = dataR * dataR;

    let best = -1, bestD2 = dataR2;
    const cellSpan = Math.max(1, Math.ceil(dataR * GRID_N * 0.5) + 1);
    for (let dy = -cellSpan; dy <= cellSpan; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= GRID_N) continue;
      for (let dx = -cellSpan; dx <= cellSpan; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= GRID_N) continue;
        const list = grid[yy * GRID_N + xx];
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const idx = list[k];
          // Recompute the point's normalized [-1, 1] position from posBuf16
          // we don't keep it on CPU, but we can re-derive from int16 cheaply.
          const px = posSnapshot[2*idx]     / 32767;
          const py = posSnapshot[2*idx + 1] / 32767;
          const ex = px - data.x, ey = py - data.y;
          const d2 = ex*ex + ey*ey;
          if (d2 < bestD2) { bestD2 = d2; best = idx; }
        }
      }
    }
    if (best === -1) return hideTooltip();
    // Place tooltip near cursor, offset to the right & above.
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    showTooltip(best, relX, relY);
  }

  // We need an unattached CPU-side copy of positions for hover hit-testing
  // because WebGL buffers aren't readable from JS without a roundtrip.
  let posSnapshot = null;

  // ---- Bootstrap ---------------------------------------------------------
  setupGL();

  colorPills.forEach(p => {
    p.addEventListener("click", () => setMode(p.dataset.color));
  });

  // Defer loading until the umap section is near the viewport, 571K points
  // doesn't need to fight for bandwidth on first paint.
  const io = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    try {
      const pos16 = await loadData();
      posSnapshot = pos16;
      setMode("species");  // initial coloring + first draw + mode description

      // Two-phase load: heavy gene-name strip (~6.5 MB plain text,
      // ~1.9 MB gzipped) lands AFTER the WebGL render is up. The
      // tooltip silently upgrades from "·" to the real name as soon
      // as it's parsed and re-aligned to the shuffled order. Failures
      // here are non-fatal, the scatter still works without names.
      // Curated gene highlights ride the same lazy-load slot: cheap (~12 KB
      // gzipped) but unrelated to the scatter render path, so it shouldn't
      // gate first paint either.
      loadHighlights();

      if (labels && labels.has_names) {
        fetch("/umap_names")
          .then(r => r.ok ? r.text() : Promise.reject(new Error("names " + r.status)))
          .then(txt => {
            const raw = txt.split("\n");
            if (raw.length < n) {
              console.warn(`/umap_names short: ${raw.length} < ${n}, ignoring`);
              return;
            }
            const aligned = new Array(n);
            for (let i = 0; i < n; i++) aligned[i] = raw[shufflePerm[i]];
            names = aligned;
          })
          .catch(err => console.warn("gene names load failed:", err));
      }
    } catch (err) {
      console.error(err);
      setStatus("error", "load failed");
      overlay.textContent = "load failed · " + err.message;
    }
  }, { rootMargin: "400px" });
  io.observe(canvas);

  window.addEventListener("resize", () => requestRedraw());
})();

