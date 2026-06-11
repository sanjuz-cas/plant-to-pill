// =========================================================================
// §0: Optional bio primer ("The central dogma").
//
// Ported from intro_visual.js. Generators for the four SVGs in §0:
//   [data-base="A|C|G|T"]   skeletal-formula nucleobase
//   [data-helix]            static side-on DNA double helix
//   #cd-protein-3d          live 3Dmol.js viewer (lazy-loaded)
//
// The SVGs render on page load so expanding the <details> wrapper feels
// snappy. The 3D viewer fetches a PDB (hemoglobin, 1A3N) on demand: the
// first time the user opens §0, init3DViewer() fires and downloads it.
// Users who never open the section pay zero network cost.
// =========================================================================
(function initIntroSection() {
  const root = document.querySelector(".section--intro");
  if (!root) return;

  // Tab-navigation: the intro-guide-list uses plain <a href="#tab"> anchors
  // now, which trigger tabs.js's hashchange listener. No JS plumbing here.

  const NS = "http://www.w3.org/2000/svg";
  const STROKE = "#1f1f1d";
  const GREEN  = "#317f3f";
  const SOFT   = "#5b5b56";
  const FAINT  = "#8a8a83";

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, opts = {}) {
    const attrs = {
      x, y,
      "text-anchor": opts.anchor || "middle",
      "dominant-baseline": opts.baseline || "central",
      "font-family": opts.mono ? '"JetBrains Mono", monospace' : '"Inter", sans-serif',
      "font-size": opts.size || 11,
      "font-weight": opts.weight || 500,
      fill: opts.fill || STROKE,
    };
    if (opts.opacity != null) attrs["fill-opacity"] = opts.opacity;
    const t = el("text", attrs, parent);
    t.textContent = str;
    return t;
  }

  // ======================================================================
  //   SKELETAL FORMULA RENDERER
  // ======================================================================
  function drawBond(parent, a, b, type, cx, cy) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const aShort = a.label ? 7 : 0;
    const bShort = b.label ? 7 : 0;
    const x1 = a.x + ux * aShort, y1 = a.y + uy * aShort;
    const x2 = b.x - ux * bShort, y2 = b.y - uy * bShort;

    el("line", {
      x1, y1, x2, y2,
      stroke: STROKE, "stroke-width": 1.2, "stroke-linecap": "round",
    }, parent);

    if (type === "double") {
      const nx = -uy, ny = ux;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const sign = (nx * (cx - mx) + ny * (cy - my)) > 0 ? 1 : -1;
      const gap = 2.6, shrink = 0.22;
      const sx = (x2 - x1) * shrink, sy = (y2 - y1) * shrink;
      el("line", {
        x1: x1 + sign * nx * gap + sx,
        y1: y1 + sign * ny * gap + sy,
        x2: x2 + sign * nx * gap - sx,
        y2: y2 + sign * ny * gap - sy,
        stroke: STROKE, "stroke-width": 1.2, "stroke-linecap": "round",
      }, parent);
    }
  }
  function drawAtomLabel(parent, a) {
    el("circle", { cx: a.x, cy: a.y, r: 7, fill: "#fff", stroke: "none" }, parent);
    text(parent, a.x, a.y, a.label, { size: 9.5, weight: 600, fill: GREEN });
  }
  function molecule(spec) {
    const svg = el("svg", { viewBox: spec.viewBox, xmlns: NS });
    const atoms = spec.atoms;
    const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
    for (const [i, j, type] of spec.bonds) drawBond(svg, atoms[i], atoms[j], type, cx, cy);
    for (const a of atoms) if (a.label) drawAtomLabel(svg, a);
    return svg;
  }

  const ADENINE = {
    viewBox: "0 0 90 70",
    atoms: [
      { x: 37, y: 17 }, { x: 49.1, y: 24 }, { x: 49.1, y: 38 },
      { x: 37, y: 45, label: "N" }, { x: 24.9, y: 38 }, { x: 24.9, y: 24, label: "N" },
      { x: 62.4, y: 19.7, label: "N" }, { x: 70.6, y: 31 }, { x: 62.4, y: 42.3, label: "N" },
      { x: 37, y: 5, label: "NH₂" },
    ],
    bonds: [
      [0, 1, "double"], [1, 2, "single"], [2, 3, "double"],
      [3, 4, "single"], [4, 5, "double"], [5, 0, "single"],
      [1, 6, "single"], [6, 7, "double"], [7, 8, "single"], [8, 2, "single"],
      [0, 9, "single"],
    ],
  };

  const GUANINE = {
    viewBox: "0 0 90 70",
    atoms: [
      { x: 37, y: 17 }, { x: 49.1, y: 24 }, { x: 49.1, y: 38 },
      { x: 37, y: 45, label: "N" }, { x: 24.9, y: 38 }, { x: 24.9, y: 24, label: "N" },
      { x: 62.4, y: 19.7, label: "N" }, { x: 70.6, y: 31 }, { x: 62.4, y: 42.3, label: "N" },
      { x: 37, y: 5, label: "O" },
      { x: 13, y: 45, label: "H₂N" },
    ],
    bonds: [
      [0, 1, "single"], [1, 2, "double"], [2, 3, "single"],
      [3, 4, "double"], [4, 5, "single"], [5, 0, "single"],
      [1, 6, "single"], [6, 7, "double"], [7, 8, "single"], [8, 2, "single"],
      [0, 9, "double"], [4, 10, "single"],
    ],
  };

  const CYTOSINE = {
    viewBox: "0 0 90 70",
    atoms: [
      { x: 45, y: 17, label: "N" }, { x: 57.1, y: 24 }, { x: 57.1, y: 38, label: "N" },
      { x: 45, y: 45 }, { x: 32.9, y: 38 }, { x: 32.9, y: 24 },
      { x: 73, y: 17, label: "O" }, { x: 45, y: 60, label: "NH₂" },
    ],
    bonds: [
      [0, 1, "single"], [1, 2, "single"], [2, 3, "double"],
      [3, 4, "single"], [4, 5, "double"], [5, 0, "single"],
      [1, 6, "double"], [3, 7, "single"],
    ],
  };

  const THYMINE = {
    viewBox: "0 0 90 70",
    atoms: [
      { x: 45, y: 17, label: "N" }, { x: 57.1, y: 24 }, { x: 57.1, y: 38, label: "N" },
      { x: 45, y: 45 }, { x: 32.9, y: 38 }, { x: 32.9, y: 24 },
      { x: 73, y: 17, label: "O" }, { x: 45, y: 60, label: "O" }, { x: 17, y: 45, label: "CH₃" },
    ],
    bonds: [
      [0, 1, "single"], [1, 2, "single"], [2, 3, "single"],
      [3, 4, "single"], [4, 5, "double"], [5, 0, "single"],
      [1, 6, "double"], [3, 7, "double"], [4, 8, "single"],
    ],
  };

  const BASES = { A: ADENINE, C: CYTOSINE, G: GUANINE, T: THYMINE };

  root.querySelectorAll("[data-base]").forEach(slot => {
    const spec = BASES[slot.dataset.base];
    if (spec) slot.appendChild(molecule(spec));
  });

  // ======================================================================
  //   DNA HELIX (row 2)
  // ======================================================================
  function buildHelix(slot) {
    // 20 bp over 2 turns at ~10 bp / turn (matches real B-DNA scale).
    // Vertical layout: brin paths oscillate between y = yc-amp and y = yc+amp
    // (= 22..82). 5'/3' end tags add ySpread+2 = 14px of slack above and
    // below those bounds. H = 96 sits 4px below the lower-most label so the
    // SVG ends almost flush with the legend underneath instead of leaving
    // a fat band of whitespace.
    const W = 480, H = 96;
    const yc = 52, amp = 30, period = 240;
    const phaseA = 0, phaseB = Math.PI;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, xmlns: NS }, slot);

    function yAt(x, phase) { return yc + amp * Math.sin((2 * Math.PI * x) / period + phase); }

    const rungSpacing = 24;
    const topSeq = "ATCGGCATCGTAGCCAGTCA";
    const comp = { A: "T", T: "A", C: "G", G: "C" };
    const rungs = [];
    let seqIdx = 0;
    for (let x = rungSpacing / 2; x < W && seqIdx < topSeq.length; x += rungSpacing) {
      const yA = yAt(x, phaseA);
      const yB = yAt(x, phaseB);
      rungs.push({
        x,
        yTop: Math.min(yA, yB),
        yBot: Math.max(yA, yB),
        sep: Math.abs(yA - yB),
        top: topSeq[seqIdx],
        bot: comp[topSeq[seqIdx]],
        // Which strand currently sits visually higher? Used by letterFade
        // to map each glyph to its attaching strand's depth. The flag flips
        // every time the strands cross, which is what drives the alternating
        // bright/dim pattern of adjacent rungs around the helix waist.
        topOnA: yA <= yB,
      });
      seqIdx++;
    }
    // Depth fade: rungs at the helix waist (small sep) tint towards
    // near-transparent so they read as "behind / out of focus" instead
    // of as front-and-centre rungs. This fills the otherwise-empty gaps
    // at the strand crossings (was previously skipping those rungs
    // outright with a hard minSep filter) while keeping the visible
    // letters concentrated where the helix is wide. Smoothstep echoes
    // the depth-tint logic in the banner helix.
    function fadeForSep(sep) {
      const lo = 12, hi = 28;
      const t = Math.max(0, Math.min(1, (sep - lo) / (hi - lo)));
      // smoothstep, then map to [0.18, 1.0]: the floor stays just visible
      // even at full crossing so the rung never reads as a hard gap.
      const ease = t * t * (3 - 2 * t);
      return 0.18 + 0.82 * ease;
    }

    // Letter glyphs sit *between* the strands (not on them), echoing the
    // banner helix's [strand]─letter─letter─[strand] layout. On wide rungs
    // the two letters sit at 25% / 75% of the rung's vertical span so they
    // read as clearly inside the rung rather than on either strand. As the
    // rung narrows around the helix waist that 25%/75% rule collapses both
    // glyphs onto the strand crossing — they end up stacked on top of each
    // other AND straddled by the X of the two strands, so they disappear.
    // MIN_LETTER_HALF enforces a floor on the half-spread from the rung
    // midline so the pair stays visibly separated from the intersection
    // even at the narrowest rungs; it kicks in once sep < ~28 (= 4 * 7),
    // i.e. only around the waist, leaving wider rungs untouched.
    const LETTER_GAP      = 6;  // half-height of the slot punched out around each glyph
    const STRAND_HALO     = 3;  // pull rungs back from the strand path so they don't kiss it
    const MIN_LETTER_HALF = 0;  // floor on |y - rung-midline| for each glyph at crossings
    function rungLetterYs(r) {
      const sep = r.yBot - r.yTop;
      const mid = (r.yTop + r.yBot) / 2;
      const half = Math.max(sep * 0.25, MIN_LETTER_HALF);
      return [mid - half, mid + half];
    }

    // Split each strand at its DEPTH transitions (z = 0) rather than at
    // its y=yc crossings. In a 3D helix the depth coord is 90° out of
    // phase with the visible y, so z(x) = cos(2πx/T + phase). z hits
    // zero — i.e. the strand is exactly mid-depth, neither front nor
    // back — at the visual PEAKS of the wave (x = T/4, 3T/4, 5T/4, …).
    // Between two consecutive peaks the strand sits entirely on one
    // side of the camera plane: front if z > 0, back if z < 0. Each
    // "back" arc therefore runs diagonally from one peak to the next
    // (bottom-peak → top-peak, or vice versa), passing THROUGH the
    // centerline crossing in its middle. That's exactly where the
    // strand crosses behind the other strand, which is also where we
    // want the strongest fade — STROKE at the peak ends of each arc,
    // STRAND_BACK in the middle, smoothly back to STROKE at the next
    // peak. Net effect: the fade alternates between the upper-going
    // strand and the lower-going strand as we walk along the helix,
    // instead of always tagging the below-centerline lobes as the
    // back (the bug the previous "split at y=yc" version had — both
    // bottom lobes were faded, both top lobes were full ink). The
    // same gradient also handles the strand extremities cleanly: the
    // edge segments are clipped to x=6 / x=W-6 but their gradient
    // still anchors at STROKE there, so the 5'/3' label ties never
    // look ghosted.
    const STRAND_BACK = "rgb(185, 185, 175)";  // ~25% contrast vs paper — clearly recessed

    // Boundaries: the strand extremities plus every depth-zero peak
    // (x = T/4, 3T/4, …) that falls inside the SVG.
    const boundaries = [0];
    for (let k = 0; ; k++) {
      const x = period / 4 + k * (period / 2);
      if (x >= W) break;
      boundaries.push(x);
    }
    boundaries.push(W);

    const defs = el("defs", {}, svg);
    let backGradCount = 0;
    function backGradId(x0, x1) {
      const id = `cd-helix-back-${backGradCount++}`;
      const grad = el("linearGradient", {
        id, gradientUnits: "userSpaceOnUse",
        x1: x0, y1: 0, x2: x1, y2: 0,
      }, defs);
      el("stop", { offset: "0%",   "stop-color": STROKE      }, grad);
      el("stop", { offset: "50%",  "stop-color": STRAND_BACK }, grad);
      el("stop", { offset: "100%", "stop-color": STROKE      }, grad);
      return id;
    }

    function zAt(x, phase) { return Math.cos((2 * Math.PI * x) / period + phase); }

    function buildSegments(phase) {
      const out = [];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const b0 = boundaries[i], b1 = boundaries[i + 1];
        const x0 = Math.max(b0, 6);
        const x1 = Math.min(b1, W - 6);
        if (x1 - x0 < 1) continue;
        // Classify against the UN-clipped segment centre so edge-clipped
        // segments still pick up the right sign of z.
        const isFront = zAt((b0 + b1) / 2, phase) > 0;
        let d = "";
        for (let x = x0; x <= x1; x += 2) {
          d += (d ? " L " : "M ") + x.toFixed(2) + " " + yAt(x, phase).toFixed(2);
        }
        // Make sure the path reaches x1 exactly: the 2-px sampling
        // can otherwise leave a hairline gap right at the join.
        const lastX = x0 + Math.floor((x1 - x0) / 2) * 2;
        if (lastX < x1) d += " L " + x1.toFixed(2) + " " + yAt(x1, phase).toFixed(2);
        out.push({ d, isFront, x0, x1 });
      }
      return out;
    }
    const allSegs = buildSegments(phaseA).concat(buildSegments(phaseB));

    // 1. Back arcs — drawn first so the rungs sit on top of them.
    //    Arcs that touch a strand extremity (the very-left or very-right
    //    edge of the rendered range) skip the fade gradient entirely and
    //    render in solid STROKE: the 5'/3' label ties should land on a
    //    fully-inked stretch of strand, not on a half-ghosted segment.
    //    They still draw in the back z-layer so they sit BEHIND the
    //    rungs like any other recessed arc.
    for (const s of allSegs) {
      if (s.isFront) continue;
      const touchesEdge = s.x0 <= 6 || s.x1 >= W - 6;
      el("path", {
        d: s.d, fill: "none",
        stroke: touchesEdge ? STROKE : `url(#${backGradId(s.x0, s.x1)})`,
        "stroke-width": 2, "stroke-linecap": "round",
      }, svg);
    }

    // 2. Rungs. Each rung becomes up to three short segments,
    //    interrupted around each letter so the letter reads as sitting
    //    *in* the rung. Rungs at the helix waist still get drawn but
    //    with their opacity tapered via fadeForSep so the crossings
    //    don't read as bald gaps.
    for (const r of rungs) {
      const fade = fadeForSep(r.sep);
      const [yA, yB] = rungLetterYs(r);
      const segs = [
        [r.yTop + STRAND_HALO, yA - LETTER_GAP],
        [yA + LETTER_GAP,      yB - LETTER_GAP],
        [yB + LETTER_GAP,      r.yBot - STRAND_HALO],
      ];
      for (const [y1, y2] of segs) {
        if (y2 - y1 < 1) continue;
        el("line", {
          x1: r.x, y1, x2: r.x, y2,
          stroke: GREEN, "stroke-width": 1.4, "stroke-opacity": 0.55 * fade,
        }, svg);
      }
    }

    // 3. Front arcs — on top of the rungs so they visually OCCLUDE
    //    the rungs they pass in front of, completing the depth illusion.
    for (const s of allSegs) {
      if (!s.isFront) continue;
      el("path", {
        d: s.d, fill: "none",
        stroke: STROKE,
        "stroke-width": 2, "stroke-linecap": "round",
      }, svg);
    }

    // 4. Letter glyphs themselves (no haloes, since the rung is already
    //    interrupted around each letter). Each glyph fades independently
    //    of its rung-mate via letterFade: the rung-wide sep fade still
    //    sets the baseline, but each letter is then biased by the depth
    //    (z) of the strand it attaches to. Net result: instead of two
    //    equally-ghosted letters stacked on top of each other at the
    //    crossings, the front-strand letter holds clearly readable while
    //    the back-strand letter recedes to a barely-there ghost. And
    //    because the "front" strand flips at every half-period, the
    //    bright letter alternates between the upper and lower rung
    //    position from one rung to the next around the helix waist —
    //    echoes the strand back-arc gradients painted in step 1.
    function letterFade(r, isTop) {
      const onA = isTop ? r.topOnA : !r.topOnA;
      const z = zAt(r.x, onA ? phaseA : phaseB);     // -1 (back) … +1 (front)
      const lo = 12, hi = 28;
      const t = Math.max(0, Math.min(1, (r.sep - lo) / (hi - lo)));
      const ease = t * t * (3 - 2 * t);
      const sepFade = 0.18 + 0.82 * ease;
      // Bias only kicks in around the crossings; wide rungs (where the
      // strands sit symmetric and z ≈ 0 anyway) keep both letters at
      // full opacity. Amplitude 0.37 lands the front letter near 0.55
      // and the back letter at the 0.08 floor when |z| = 1.
      const bias = z * (1 - ease) * 0.37;
      return Math.max(0.08, Math.min(1, sepFade + bias));
    }

    for (const r of rungs) {
      const [yA, yB] = rungLetterYs(r);
      const topFade = letterFade(r, true);
      const botFade = letterFade(r, false);
      text(svg, r.x, yA, r.top, { mono: true, size: 10, weight: 600, fill: GREEN, opacity: topFade });
      text(svg, r.x, yB, r.bot, { mono: true, size: 10, weight: 600, fill: GREEN, opacity: botFade });
    }

    // 5′ / 3′ end tags. Each label is placed *outside* the higher/lower
    // strand at that x — i.e. min/max over the two strands at the edge —
    // rather than tied to one specific strand. The previous logic pinned
    // 5′ to phaseA (above) and 3′ to phaseB (below), which made the two
    // labels collapse vertically wherever the strands happened to cross
    // close to the SVG edge (left side: ~17px apart) while staying nicely
    // spread on the side where they didn't (right side: ~35px). Using
    // min/max instead gives a symmetric ~35px gap on both ends regardless
    // of where in the helix cycle the edge falls.
    const ySpread = 12;
    const yA0 = yAt(6, phaseA),     yB0 = yAt(6, phaseB);
    const yA1 = yAt(W - 6, phaseA), yB1 = yAt(W - 6, phaseB);
    text(svg, 6,     Math.min(yA0, yB0) - ySpread,     "5′", { mono: true, size: 9, weight: 500, fill: FAINT });
    text(svg, W - 6, Math.min(yA1, yB1) - ySpread,     "3′", { mono: true, size: 9, weight: 500, fill: FAINT });
    text(svg, 6,     Math.max(yA0, yB0) + ySpread + 2, "3′", { mono: true, size: 9, weight: 500, fill: FAINT });
    text(svg, W - 6, Math.max(yA1, yB1) + ySpread + 2, "5′", { mono: true, size: 9, weight: 500, fill: FAINT });
  }

  root.querySelectorAll("[data-helix]").forEach(buildHelix);

  // ======================================================================
  //   LAZY 3D PROTEIN (row 5)
  // ======================================================================
  //
  // Init runs when the Intro tab actually becomes visible (lands on #intro
  // OR user switches to it later). Skipping the PDB fetch when a visitor
  // jumps straight to #demo / #model / #sandbox saves a network round-trip.
  // init3DViewer is idempotent so it's safe to call from both the initial
  // check and the MutationObserver below.

  // PDB is bundled in assets/data/ and served via the /assets static mount.
  // Same-origin fetch ≈ disk read; no RCSB round-trip on every page load,
  // which used to dominate the "loading hemoglobin…" wait.
  const PDB_URL = "/assets/data/1A3N.pdb";

  let viewerInitialised = false;
  function init3DViewer() {
    if (viewerInitialised) return;
    const container = root.querySelector("#cd-protein-3d");
    if (!container) return;
    // 3Dmol is loaded as <script defer> from a CDN, so when intro.js runs
    // synchronously during the body parse the global may not be ready yet.
    // Retry on a short timer rather than giving up, otherwise the viewer
    // never initialises and the panel is stuck on "loading hemoglobin…".
    if (!window.$3Dmol) {
      setTimeout(init3DViewer, 50);
      return;
    }
    viewerInitialised = true;

    const loading = container.querySelector(".cd-protein-3d-loading");
    const viewer = $3Dmol.createViewer(container, {
      backgroundColor: "white",
      antialias: true,
    });

    fetch(PDB_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(pdbText => {
        viewer.addModel(pdbText, "pdb");
        viewer.setStyle({ chain: "A" }, { cartoon: { color: "#317f3f" } });
        viewer.setStyle({ chain: "B" }, { cartoon: { color: "#62a070" } });
        viewer.setStyle({ chain: "C" }, { cartoon: { color: "#1f5024" } });
        viewer.setStyle({ chain: "D" }, { cartoon: { color: "#a5d4ac" } });
        viewer.setStyle({ resn: "HEM" }, { stick: { color: "#b8862c", radius: 0.22 } });
        viewer.addStyle({ resn: "HEM", elem: "FE" }, { sphere: { color: "#cd5c2a", radius: 1.0 } });
        viewer.zoomTo();
        // Slow editorial spin: 0.15 deg / tick at 3Dmol's ~30 fps render
        // = ~4.5 deg/sec, a full rotation every ~80 seconds. Slow enough
        // that the molecule reads as "alive" in peripheral vision but
        // never demands attention while the visitor reads the prose.
        viewer.spin("y", 0.15);
        viewer.render();
        if (loading) loading.remove();
      })
      .catch(err => {
        console.error("intro: failed to load hemoglobin PDB:", err);
        if (loading) loading.textContent = "failed to load model";
      });

    // 3Dmol installs a wheel listener on its internal canvas that zooms
    // the camera AND preventDefaults the page scroll, which traps the
    // page scroll whenever the cursor is over the viewer (the molecule
    // sits mid-page so this hits constantly). Intercept wheel on the
    // container in capture phase and stopImmediatePropagation so 3Dmol
    // never sees the event — no preventDefault → the browser's native
    // scroll (with trackpad momentum etc.) runs untouched. Pan / rotate
    // (mouse-drag) are unaffected. Same pattern as §5 folding.
    container.addEventListener("wheel", (e) => {
      e.stopImmediatePropagation();
    }, { capture: true, passive: true });
  }
  function maybeInit() {
    if (root.classList.contains("active")) init3DViewer();
  }
  // Fire if the Intro tab is the landing tab.
  maybeInit();
  // Otherwise, fire the first time tabs.js adds .active to this panel.
  new MutationObserver(maybeInit).observe(root, {
    attributes: true, attributeFilter: ["class"],
  });
})();
