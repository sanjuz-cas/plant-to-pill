// =========================================================================
// Carbon banner, animated VERTICAL DNA helix (Canvas 2D)
//
// The helix is drawn upright (long axis = y). The CSS rotates the canvas
// by a few degrees for the "technical drawing on a bench" feel; the math
// here stays axis-aligned to keep the z-sort and rung logic readable.
//
// Compared to the original horizontal version, the only change is which
// coordinate carries the cycles vs the amplitude:
//   horizontal: y = sin(theta(x)) * amplitude
//   vertical:   x = sin(theta(y)) * amplitude
// Everything else (z-sort, rung gaps, glyph shapes) carries over verbatim.
//
// One init() call per .carbon-banner on the page. social-banner.html
// renders two instances (the main stage at the top + the OG thumbnail
// preview lower down), and each carries its own canvas, IntersectionObserver,
// rAF loop and animation phase so their helices can run independently
// without sharing state.
// =========================================================================
(function initAllCarbonBanners() {
  const banners = document.querySelectorAll(".carbon-banner");
  banners.forEach(initCarbonBanner);

function initCarbonBanner(banner) {
  const canvas = banner.querySelector(".cb-helix-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sequence = ["A","T","A","A","C","G","A","C","T","T","C","C","C","T","A","T","T","G"];
  const complement = { A: "T", T: "A", C: "G", G: "C" };

  // All physical parameters in viewBox units. The helix is upright: the long
  // axis runs from startY to endY; sinusoid wiggle is in x around centerX.
  // Numbers tuned for a hero that *dominates* the right half of the banner:
  // big amplitude, thick ribbons, oversized ATCG glyphs.
  const helix = {
    startY: 0, endY: 1100, centerX: 220, amplitude: 150,
    cycles: 4.0, speed: 0.00030,
    rungCount: 26,
    // Dense sampling: each strand section is rendered as a continuous
    // polyline with this many samples (≈128 per cycle at 512), so the
    // curves stay smooth even at the apex of each loop where the tangent
    // direction changes fastest. Cost is negligible: we still only do
    // 4 fills + 8 stroke calls per frame total (one fill per back/front
    // section per strand, plus the 4 edge polylines).
    segmentCount: 512,
    // Strand half-thickness in viewBox units. Trimmed 14 → 11 → 8 so the
    // ribbon reads slimmer/more technical and the saturated green edge gets
    // to do the heavy lifting rather than the cream body fill.
    bodyRadius: 8,
    rungInset: 16, glyphGap: 30,
  };
  // Helix bbox in viewBox coords. Width gives room for amplitude (±138 around
  // centerX=220 → wave reaches x=82..358, fits comfortably in 440-wide VB).
  const VB = { x: 0, y: -30, w: 440, h: 1160 };

  const COLORS = {
    body: "#e4e5dc",
    edge: "#2d332e",
    green: "#317f3f",
  };

  // Depth is rendered ENTIRELY through COLOR modulation, not alpha.
  // Every paint operation runs at alpha = 1, which kills the compositing
  // artifacts (visible "step" at section boundaries / overlap zones) that
  // an alpha-based depth model produces.
  //
  // Each visual layer (body, green hairline, dark edge) is interpolated
  // between a "back" tint (z = -1, washed-out toward the paper) and a
  // "front" tint (z = +1, full ink). At z = 0 the colour is the midpoint;
  // so a strand section that crosses the back/front boundary has a perfectly
  // continuous colour curve, no perceptible plateau.
  //
  // The whole palette is tuned to sit LOW-contrast against the page paper
  // (#f7f5ee). The helix should read as a soft watermark / blueprint, not
  // as a hi-contrast logo: front tints are pulled toward the paper, the
  // outer edge is desaturated forest rather than saturated forest, and the
  // green hairline is more sage than brand-green.
  //
  // [r, g, b] triplets, NOT strings, we do per-frame linear interpolation
  // in JS and emit a single rgb() per gradient stop.
  const TINT = {
    bodyBack:   [243, 240, 230],   // sits almost on top of the paper
    bodyFront:  [232, 230, 218],   // gentle cream, reads as a soft ribbon
    // Inner hairline: muted sage accent, not full brand green.
    greenBack:  [205, 220, 208],
    greenFront: [125, 165, 132],
    // Outer edge: low-contrast desaturated forest. Still green-leaning so
    // the silhouette reads as a strand rather than a grey shape, but lifted
    // far enough off black that the ribbon merges with the paper instead of
    // punching a hole through it.
    edgeBack:   [195, 215, 198],
    edgeFront:  [108, 150, 118],
  };

  // ATCG glyphs, scaled up so they read at the larger banner size. Stroke
  // widths bump in drawFrame() to keep the visual weight consistent.
  const glyphPaths = {
    A: new Path2D("M -11 17 L 0 -17 L 11 17 M -6.6 4 L 6.6 4"),
    C: new Path2D("M 11 -13 C 2 -19 -13 -15 -13 0 C -13 15 2 19 11 13"),
    G: new Path2D("M 11 -13 C 2 -19 -13 -15 -13 0 C -13 15 2 19 11 13 M 11 2 L 2 2 M 11 2 L 11 13"),
    T: new Path2D("M -13 -15 L 13 -15 M 0 -15 L 0 17"),
  };

  // --- Canvas sizing (DPR + viewBox→pixels mapping) ---------------------
  let cssW = 0, cssH = 0, dpr = 1, uniformScale = 1, offsetX = 0, offsetY = 0;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    cssW = rect.width;
    cssH = rect.height;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const sx = canvas.width / VB.w;
    const sy = canvas.height / VB.h;
    // Cover-fit: the helix fills the canvas in both dimensions, with overflow
    // clipped by the parent's overflow:hidden. This makes the helix BLEED
    // beyond the banner top/bottom for a "spilling out of the frame" feel;
    // exactly what "much bigger" calls for.
    uniformScale = Math.max(sx, sy);
    offsetX = (canvas.width  - VB.w * uniformScale) / 2;
    offsetY = (canvas.height - VB.h * uniformScale) / 2;
  }
  function applyVbTransform() {
    ctx.setTransform(
      uniformScale, 0, 0, uniformScale,
      -VB.x * uniformScale + offsetX,
      -VB.y * uniformScale + offsetY,
    );
  }
  // viewBox-units helper for stroke widths (mimics vector-effect:non-scaling).
  function px(cssPx) { return (cssPx * dpr) / uniformScale; }

  // --- Math: vertical helix ---------------------------------------------
  // tangent at (x, y) along the curve has dy=1 (we parameterize by y);
  // dx/dy is the slope. The unit normal in 2D is (-dy, dx)/|tangent|, i.e.
  // (-1, slope) normalised, pointing "outward" perpendicular to the curve.
  function pointAt(y, offset, phase) {
    const t = (y - helix.startY) / (helix.endY - helix.startY);
    const theta = t * helix.cycles * Math.PI * 2 + phase + offset;
    const slope = Math.cos(theta) * helix.amplitude * helix.cycles * Math.PI * 2 / (helix.endY - helix.startY);
    const normalLength = Math.hypot(slope, 1);
    return {
      x: helix.centerX + Math.sin(theta) * helix.amplitude,
      y,
      z: Math.cos(theta),
      nx: 1 / normalLength,
      ny: -slope / normalLength,
    };
  }

  const pointsA = new Array(helix.segmentCount + 1);
  const pointsB = new Array(helix.segmentCount + 1);
  function fillSamples(buf, offset, phase) {
    const span = helix.endY - helix.startY;
    for (let i = 0; i <= helix.segmentCount; i++) {
      buf[i] = pointAt(helix.startY + (span * i) / helix.segmentCount, offset, phase);
    }
  }

  // --- Drawing primitives -----------------------------------------------
  //
  // Each strand is rendered as a series of CONTINUOUS sections (one per
  // contiguous z-half) so the curve never breaks into small straight
  // facets, lineJoin: "round" smooths every junction inside a section.
  //
  // Depth is conveyed entirely through COLOUR (see TINT / strandColourGradient
  // below). Sections are still split at the z = 0 crossing so we can draw
  // back-of-rungs and front-of-rungs in separate passes, that's what
  // produces the visual occlusion when one strand crosses over a rung.
  // Because every section of a given strand shares the same colour
  // gradient, the back↔front handoff is perfectly continuous: at any
  // pixel y the back section and front section paint the same colour.

  // Find contiguous ranges of indices in `points` where (z >= 0) === wantFront.
  // Each range is extended by 1 sample on each side (when possible) so adjacent
  // back/front sections overlap visually, no hairline gap at the z=0 crossing.
  function findRanges(points, wantFront) {
    const ranges = [];
    let runStart = -1;
    for (let i = 0; i < points.length; i++) {
      const isFront = points[i].z >= 0;
      if (isFront === wantFront) {
        if (runStart === -1) runStart = i > 0 ? i - 1 : i;
      } else if (runStart !== -1) {
        ranges.push([runStart, i]);
        runStart = -1;
      }
    }
    if (runStart !== -1) ranges.push([runStart, points.length - 1]);
    return ranges;
  }

  // Trace the OUTLINE of a ribbon section in viewBox space: walk the top
  // edge from `from` to `to`, then the bottom edge back. Used both to fill
  // and to stroke the green hairline outline around the body.
  function ribbonOutlinePath(points, from, to, radius) {
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const p = points[i];
      const x = p.x + p.nx * radius;
      const y = p.y + p.ny * radius;
      if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = to; i >= from; i--) {
      const p = points[i];
      ctx.lineTo(p.x - p.nx * radius, p.y - p.ny * radius);
    }
    ctx.closePath();
  }

  // Open polyline along ONE edge (top or bottom) of a ribbon section. Used
  // for the dark ink edge strokes, which look better drawn as a single
  // continuous path (lineJoin: round smooths every join automatically).
  function edgePath(points, from, to, signedRadius) {
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const p = points[i];
      const x = p.x + p.nx * signedRadius;
      const y = p.y + p.ny * signedRadius;
      if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  // Smoothstep eases the back↔front transition so the colour change happens
  // gradually around z = 0 instead of swinging through that point linearly.
  // Visually: less time spent in the "ambiguous middle tone", more time in
  // pure-back / pure-front colour, the eye reads it as two clear depth
  // zones with a soft crossfade, not as a constant fade.
  function smoothstep(x) {
    const t = x < 0 ? 0 : x > 1 ? 1 : x;
    return t * t * (3 - 2 * t);
  }

  // Build a VERTICAL colour gradient that spans the full strand (startY →
  // endY) and lerps each visual layer between its back-tint and front-tint
  // based on the local z value at every sample. Returns a CanvasGradient
  // ready to use as fillStyle / strokeStyle.
  //
  // CRITICAL: this gradient is built ONCE per frame per strand and reused
  // by every section (back AND front) of that strand. The shared spatial
  // mapping is what makes back↔front transitions perfectly seamless, at
  // any pixel y, both sections compute the exact same colour.
  function strandColourGradient(points, tintBack, tintFront) {
    const y0 = points[0].y;
    const y1 = points[points.length - 1].y;
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    const N = points.length - 1;
    const dR = tintFront[0] - tintBack[0];
    const dG = tintFront[1] - tintBack[1];
    const dB = tintFront[2] - tintBack[2];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const front = smoothstep((points[i].z + 1) * 0.5);
      const r = (tintBack[0] + front * dR) | 0;
      const gg = (tintBack[1] + front * dG) | 0;
      const b = (tintBack[2] + front * dB) | 0;
      g.addColorStop(t, `rgb(${r},${gg},${b})`);
    }
    return g;
  }

  // Pre-built per-frame gradients for the two strands. Each holds the three
  // colour gradients used by drawRibbonSection(), body fill, green
  // hairline, dark ink edge.
  let gradsA = null, gradsB = null;
  function rebuildStrandGradients() {
    gradsA = {
      body:  strandColourGradient(pointsA, TINT.bodyBack,  TINT.bodyFront),
      green: strandColourGradient(pointsA, TINT.greenBack, TINT.greenFront),
      edge:  strandColourGradient(pointsA, TINT.edgeBack,  TINT.edgeFront),
    };
    gradsB = {
      body:  strandColourGradient(pointsB, TINT.bodyBack,  TINT.bodyFront),
      green: strandColourGradient(pointsB, TINT.greenBack, TINT.greenFront),
      edge:  strandColourGradient(pointsB, TINT.edgeBack,  TINT.edgeFront),
    };
  }

  // FILL pass for one section. The closed polygon is FILLED ONLY, never
  // stroked, so the perpendicular caps at the section's two ends stay
  // invisible. Adjacent sections overlap by 1-2 samples, which guarantees
  // that the geometric edge of one polygon falls inside the body of the
  // next, so the anti-aliased polygon outlines never read as a hairline
  // step either.
  function drawRibbonFill(points, from, to, grads) {
    if (to <= from) return;
    ctx.globalAlpha = 1;
    ribbonOutlinePath(points, from, to, helix.bodyRadius);
    ctx.fillStyle = grads.body;
    ctx.fill();
  }

  // EDGES pass for one section. Each of the 4 lines (green hairline top,
  // green hairline bottom, dark ink top, dark ink bottom) is an OPEN
  // polyline drawn separately. No closed-path stroke anywhere, that's
  // what eliminates the perpendicular "step" marks across the strand that
  // a closed-polygon stroke would draw at the cap positions.
  //
  // Round caps at the polyline endpoints DO leak a tiny half-disc past the
  // section boundary, but because adjacent sections overlap and share the
  // same colour gradient, the leak from one section is overdrawn by the
  // body fill / edge polyline of the next section in the same XY position
  // with the same colour. Net visual: a single continuous edge with no
  // visible joint.
  function drawRibbonEdges(points, from, to, grads) {
    if (to <= from) return;
    ctx.globalAlpha = 1;

    // Thin green hairline at the inner rim of the body.
    ctx.strokeStyle = grads.green;
    ctx.lineWidth = px(0.9);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    edgePath(points, from, to,  helix.bodyRadius - 0.2);
    ctx.stroke();
    edgePath(points, from, to, -(helix.bodyRadius - 0.2));
    ctx.stroke();

    // Dark forest edge at the outer rim, the primary depth cue. Kept on
    // the bolder side (1.6 → 2.0 → 1.6) so even with the slimmer ribbon
    // the green outline still reads as a deliberate stroke.
    ctx.strokeStyle = grads.edge;
    ctx.lineWidth = px(1.6);
    edgePath(points, from, to,  helix.bodyRadius + 0.4);
    ctx.stroke();
    edgePath(points, from, to, -(helix.bodyRadius + 0.4));
    ctx.stroke();
  }
  // Rungs are now HORIZONTAL lines (perpendicular to the vertical helix axis).
  function drawRung(y, xStart, letterXs, xEnd, gap) {
    const start = Math.min(xStart, xEnd);
    const end   = Math.max(xStart, xEnd);
    const ranges = [];
    for (const x of letterXs) {
      const f = Math.max(start, x - gap);
      const t = Math.min(end,   x + gap);
      if (t > f) ranges.push([f, t]);
    }
    ranges.sort((u, v) => u[0] - v[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (!last || r[0] > last[1]) merged.push([r[0], r[1]]);
      else last[1] = Math.max(last[1], r[1]);
    }
    ctx.beginPath();
    let cursor = start;
    for (const [f, t] of merged) {
      if (f - cursor > 0.7) { ctx.moveTo(cursor, y); ctx.lineTo(f, y); }
      cursor = t;
    }
    if (end - cursor > 0.7) { ctx.moveTo(cursor, y); ctx.lineTo(end, y); }
    ctx.stroke();
  }
  function drawGlyph(letter, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.stroke(glyphPaths[letter]);
    ctx.restore();
  }

  // Lerp helper for rungs / glyphs, local point in time, doesn't deserve a
  // gradient. Pass two RGB triplets and a `front` value in [0, 1]; returns
  // a CSS rgb() string.
  function tintAt(tintBack, tintFront, front) {
    const f = smoothstep(front);
    const r = (tintBack[0] + f * (tintFront[0] - tintBack[0])) | 0;
    const g = (tintBack[1] + f * (tintFront[1] - tintBack[1])) | 0;
    const b = (tintBack[2] + f * (tintFront[2] - tintBack[2])) | 0;
    return `rgb(${r},${g},${b})`;
  }

  // --- Frame ------------------------------------------------------------
  function drawFrame(phase) {
    if (cssW === 0 || cssH === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyVbTransform();

    fillSamples(pointsA, 0, phase);
    fillSamples(pointsB, Math.PI, phase);
    rebuildStrandGradients();

    // Section the strands so we can draw back-of-rungs and front-of-rungs
    // in separate passes (only way to get the visual crossing). All
    // sections of the same strand share that strand's colour gradient, so
    // the back↔front handoff is perfectly continuous.
    const backA  = findRanges(pointsA, false);
    const backB  = findRanges(pointsB, false);
    const frontA = findRanges(pointsA, true);
    const frontB = findRanges(pointsB, true);

    // Pass 1a: back BODY FILLS of both strands.
    for (const [f, t] of backA) drawRibbonFill(pointsA, f, t, gradsA);
    for (const [f, t] of backB) drawRibbonFill(pointsB, f, t, gradsB);
    // Pass 1b: back EDGES (separate open polylines per side, no caps).
    for (const [f, t] of backA) drawRibbonEdges(pointsA, f, t, gradsA);
    for (const [f, t] of backB) drawRibbonEdges(pointsB, f, t, gradsB);

    // Rungs + ATCG glyphs. The rung connects strand A's point and strand
    // B's point, which sit at OPPOSITE z values at any given y (the strands
    // are π out of phase). We exploit that: the rung's colour fades along
    // its length via a horizontal gradient, bright green near whichever
    // strand is in front, soft sage near whichever strand is in back.
    // Glyphs follow the same logic but as a single-tone tint per letter.
    for (let k = 0; k < helix.rungCount; k++) {
      const t = k / (helix.rungCount - 1);
      const y = helix.startY + (helix.endY - helix.startY) * t;
      const a = pointAt(y, 0, phase);
      const b = pointAt(y, Math.PI, phase);
      const xLeft = Math.min(a.x, b.x);
      const xRight = Math.max(a.x, b.x);
      const span = xRight - xLeft;
      const inset = Math.min(helix.rungInset, Math.max(0, span * 0.5 - 3));
      const visible = Math.max(0, Math.min(1, (span - 34) / 70));
      const aLetterX = a.x + (b.x - a.x) * 0.34;
      const bLetterX = b.x + (a.x - b.x) * 0.34;
      const letterGap = Math.min(helix.glyphGap, Math.max(8.5, span * 0.16));

      // Horizontal gradient along the rung. tA/tB are the colour tints at
      // strand A's and strand B's ends, derived from their respective z.
      const frontA01 = (a.z + 1) * 0.5;
      const frontB01 = (b.z + 1) * 0.5;
      const colA = tintAt(TINT.greenBack, TINT.greenFront, frontA01);
      const colB = tintAt(TINT.greenBack, TINT.greenFront, frontB01);
      const rungGrad = ctx.createLinearGradient(a.x, y, b.x, y);
      rungGrad.addColorStop(0, colA);
      rungGrad.addColorStop(1, colB);

      ctx.globalAlpha = 0.35 + visible * 0.55;     // taper rungs at the cycle apex
      ctx.strokeStyle = rungGrad;
      ctx.lineWidth = px(1.9);
      ctx.lineCap = "round";
      drawRung(y, xLeft + inset, [aLetterX, bLetterX], xRight - inset, letterGap);

      // Glyphs: each letter takes the strand-local tint (sage for back,
      // green for front). The letter sitting on strand A's side uses A's
      // z, the complement on B's side uses B's z.
      // Stroke bumped to px(3.6) so the ATCG glyphs read as bold/poster
      // weight rather than a technical line drawing, they have to hold
      // their own next to a JetBrains Mono 800 wordmark.
      ctx.globalAlpha = 0.35 + visible * 0.6;
      ctx.lineWidth = px(4.6);
      ctx.lineCap = "square";
      ctx.lineJoin = "miter";
      const letter = sequence[k % sequence.length];
      ctx.strokeStyle = colA;
      drawGlyph(letter, aLetterX, y);
      ctx.strokeStyle = colB;
      drawGlyph(complement[letter], bLetterX, y);
    }

    ctx.globalAlpha = 1;

    // Pass 3a: front BODY FILLS, drawn on top of rungs so the front
    // strand visually OCCLUDES rungs it passes in front of.
    for (const [f, t] of frontA) drawRibbonFill(pointsA, f, t, gradsA);
    for (const [f, t] of frontB) drawRibbonFill(pointsB, f, t, gradsB);
    // Pass 3b: front EDGES on top.
    for (const [f, t] of frontA) drawRibbonEdges(pointsA, f, t, gradsA);
    for (const [f, t] of frontB) drawRibbonEdges(pointsB, f, t, gradsB);
  }

  resize();

  if (prefersReduced) {
    drawFrame(0.6);
    return;
  }

  // --- Animation loop, paused off-screen and on hidden tab --------------
  const FRAME_INTERVAL_MS = 1000 / 30;
  let rafId = 0, running = false, inViewport = true, lastFrameTs = 0;

  // Phase is now ACCUMULATED frame-by-frame instead of being computed from
  // raw timestamps. That lets us multiply the per-frame phase delta by a
  // dynamic speed factor, specifically a scroll-driven "boost", without
  // losing the smooth continuity of the animation.
  let phase = 0;
  let lastTickTs = 0;

  // Scroll-driven energy:
  //   boostTarget, set by the scroll listener from instantaneous velocity,
  //                  decays toward 0 every frame (half-life ≈ 700ms).
  //   boost      , lerps toward boostTarget every frame (factor 0.18).
  //
  // Two-stage smoothing gives a clean ramp-UP when the user starts
  // scrolling AND a clean ramp-DOWN once they stop, without ever cutting
  // speed abruptly.
  let boost = 0;
  let boostTarget = 0;
  let scrollLastY = window.scrollY;
  let scrollLastTs = performance.now();

  window.addEventListener("scroll", () => {
    const now = performance.now();
    const dy = Math.abs(window.scrollY - scrollLastY);
    const dt = Math.max(1, now - scrollLastTs);
    const velocity = dy / dt;                       // px per ms
    // Map velocity to an additional speed multiplier on top of the base
    // rotation speed. Capped so very fast scrolls don't turn the hero
    // into a blender.
    boostTarget = Math.max(boostTarget, Math.min(9, velocity * 1.5));
    scrollLastY = window.scrollY;
    scrollLastTs = now;
  }, { passive: true });

  function tick(ts) {
    if (!running) return;
    if (ts - lastFrameTs >= FRAME_INTERVAL_MS) {
      const dt = lastTickTs ? Math.min(64, ts - lastTickTs) : FRAME_INTERVAL_MS;
      lastTickTs = ts;
      lastFrameTs = ts;

      // Smooth ramp toward the current target. Lerp factor tuned so the
      // helix RESPONDS visibly within a handful of frames (~2–3 frames at
      // 30 fps to reach 75% of the target) rather than easing in slowly,
      // while still avoiding any hard cut.
      boost += (boostTarget - boost) * 0.4;
      // Slightly faster decay of the target so the return-to-rest is also
      // less drawn out (half-life ≈ 450 ms).
      boostTarget *= Math.pow(0.25, dt / 1000);

      phase += dt * helix.speed * (1 + boost);
      drawFrame(phase);
    }
    rafId = requestAnimationFrame(tick);
  }
  function start() {
    if (running || !inViewport || document.hidden) return;
    running = true;
    lastFrameTs = 0;
    lastTickTs = 0;             // reset so the first dt after a pause is sane
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
  }

  // Static banners (data-static on the .carbon-banner root) render a
  // single frozen frame and skip the entire animation pipeline. Used
  // by the OG share thumbnail lower on the page, which is meant to be
  // screenshot for the og:image asset — a moving helix would just make
  // the screenshot unpredictable, and the rAF loop is a waste of CPU
  // since the tile is purely a static preview. A ResizeObserver still
  // keeps the frozen frame crisp when the contact-sheet auto-fit
  // factor changes the on-screen pixel size of the canvas.
  const isStatic = banner.hasAttribute("data-static");

  if (isStatic) {
    const roStatic = new ResizeObserver(() => {
      resize();
      drawFrame(0);
    });
    roStatic.observe(canvas);
    drawFrame(0);
    return;
  }

  const io = new IntersectionObserver(entries => {
    inViewport = entries[0].isIntersecting;
    if (inViewport) start();
    else stop();
  }, { rootMargin: "100px" });
  io.observe(banner);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  const ro = new ResizeObserver(() => {
    resize();
    drawFrame(phase);
  });
  ro.observe(canvas);

  drawFrame(0);
  start();
}
})();
