// =========================================================================
// §5, Folding (Carbon → ESMFold → 3Dmol side-by-side)
//
// Pipeline per click:
//   reference  : gene.seq exons concatenated → mRNA → longest ORF → AA
//   carbon     : gene.seq[0..prefix] → /generate (temp=0.7) → DNA continuation
//                → longest ORF across 3 frames → AA
//   both AA strings → POST /fold in parallel → 3Dmol cartoons
//   stats      : pLDDT mean for each, 1D identity between the two AA strings
//
// Reference uses exon annotation (a biological prior the model never sees)
// so we get the "true" protein for the chosen gene. Carbon gets only raw
// bases and has to figure the ORF out by itself, the asymmetry is exactly
// the point of the section.
// =========================================================================
(function initDemoFold() {
  // --- Standard genetic code (canonical, no selenocysteine handling) -----
  // Indexed by uppercase 3-letter codon. "*" marks the three stop codons.
  const CODON_TABLE = {
    TTT:"F",TTC:"F",TTA:"L",TTG:"L", CTT:"L",CTC:"L",CTA:"L",CTG:"L",
    ATT:"I",ATC:"I",ATA:"I",ATG:"M", GTT:"V",GTC:"V",GTA:"V",GTG:"V",
    TCT:"S",TCC:"S",TCA:"S",TCG:"S", CCT:"P",CCC:"P",CCA:"P",CCG:"P",
    ACT:"T",ACC:"T",ACA:"T",ACG:"T", GCT:"A",GCC:"A",GCA:"A",GCG:"A",
    TAT:"Y",TAC:"Y",TAA:"*",TAG:"*", CAT:"H",CAC:"H",CAA:"Q",CAG:"Q",
    AAT:"N",AAC:"N",AAA:"K",AAG:"K", GAT:"D",GAC:"D",GAA:"E",GAG:"E",
    TGT:"C",TGC:"C",TGA:"*",TGG:"W", CGT:"R",CGC:"R",CGA:"R",CGG:"R",
    AGT:"S",AGC:"S",AGA:"R",AGG:"R", GGT:"G",GGC:"G",GGA:"G",GGG:"G",
  };

  // Walk a DNA string in 3-base steps starting at `frame`, look for ATG
  // start codons, and translate from each one. Prefers an ORF ending on a
  // clean stop codon; falls back to a truncated ORF (reached the end of
  // `dna` with no stop), that happens when Carbon mutates the canonical
  // stop and the translation reads into the 3'UTR. Truncated ORFs are
  // tagged so the UI can hint at that.
  function findLongestORF(dna, minAA = 30) {
    let bestClean = null;
    let bestTrunc = null;
    for (let frame = 0; frame < 3; frame++) {
      let i = frame;
      while (i <= dna.length - 3) {
        if (dna.slice(i, i + 3) !== "ATG") { i += 3; continue; }
        let aa = "";
        let j = i;
        let stoppedCleanly = false;
        let invalid = false;
        while (j + 3 <= dna.length) {
          const a = CODON_TABLE[dna.slice(j, j + 3)];
          if (!a) { invalid = true; break; }     // Non-ACGT codon, bail.
          if (a === "*") { stoppedCleanly = true; break; }
          aa += a;
          j += 3;
        }
        if (!invalid && aa.length >= minAA) {
          const entry = { aa, frame, startBP: i, endBP: j, lenBP: j - i, truncated: !stoppedCleanly };
          if (stoppedCleanly) {
            if (!bestClean || aa.length > bestClean.aa.length) bestClean = entry;
          } else {
            if (!bestTrunc || aa.length > bestTrunc.aa.length) bestTrunc = entry;
          }
        }
        i += 3;
      }
    }
    return bestClean || bestTrunc;
  }

  // Splice exons out of a (genomic) DNA string using the given exon
  // coordinates and return the mature mRNA. Exons whose `end` exceeds the
  // DNA length are truncated; exons fully past the end are dropped. This
  // lets us reuse the same routine for the reference (full genomic seq)
  // and for Carbon's continuation (which may be shorter than the gene).
  function spliceExons(dna, exons) {
    const parts = [];
    for (const e of exons) {
      if (e.start >= dna.length) break;
      parts.push(dna.slice(e.start, Math.min(e.end, dna.length)));
    }
    return parts.join("");
  }

  function translateReference(gene) {
    return findLongestORF(spliceExons(gene.seq, gene.exons), 30);
  }

  // A gene is "demo-friendly" if Carbon can plausibly generate enough DNA
  // in one shot to cover all exons. Anything past ~2500 bp of genomic DNA
  // takes minutes on the live endpoint, so we hard-cap there and surface
  // the limitation in the UI instead of silently producing a broken ORF.
  const MAX_GENOMIC_BP = 2500;
  function geneFeasibility(gene) {
    const lastExonEnd = gene.exons.length ? gene.exons[gene.exons.length - 1].end : 0;
    return { lastExonEnd, feasible: lastExonEnd <= MAX_GENOMIC_BP };
  }

  // Fraction of positions where two AA strings match. Compared over the
  // shorter of the two, Carbon and ref may have wildly different ORF
  // lengths (or the same), and we just want a 0-1 number for the stat row.
  function identity1D(a, b) {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 0;
    let m = 0;
    for (let i = 0; i < n; i++) if (a[i] === b[i]) m++;
    return m / n;
  }

  // Drain the SSE response from /generate and return the concatenated DNA.
  // Matches the framing already in §1 (one event per "data: …\n\n" block).
  async function streamGenerate(prompt, maxTokens, temperature, abortSignal) {
    const resp = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, max_tokens: maxTokens, temperature, top_p: 1.0 }),
      signal: abortSignal,
    });
    if (!resp.ok) throw new Error(`/generate HTTP ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let out = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop();
      for (const ev of events) {
        const line = ev.trim();
        if (!line.startsWith("data:")) continue;
        const data = JSON.parse(line.slice(5).trim());
        if (data.error) throw new Error(data.error);
        if (data.text) out += data.text;
      }
    }
    return out.toUpperCase().replace(/[^ACGT]/g, "");
  }

  // --- DOM ---------------------------------------------------------------
  let GENES_LOCAL = null;
  let currentGeneSymbol = null;
  let prefixLen = 200;
  let viewerCarbon = null;
  let viewerRef = null;
  let abortCtrl = null;

  const els = {
    pills:       document.getElementById("dfold-pills"),
    prefixPills: document.getElementById("dfold-prefix-pills"),
    info:        document.getElementById("dfold-info"),
    mrna:        document.getElementById("dfold-mrna"),
    aa:          document.getElementById("dfold-aa"),
    aaLabel:     document.getElementById("dfold-aa-label"),
    refAa:       document.getElementById("dfold-ref-aa"),
    refAaLabel:  document.getElementById("dfold-ref-aa-label"),
    go:          document.getElementById("dfold-go"),
    status:      document.getElementById("dfold-status"),
    statusText:  document.querySelector("#dfold-status span:last-child"),
    vCarbon:     document.getElementById("dfold-viewer-carbon"),
    vRef:        document.getElementById("dfold-viewer-ref"),
    nRes:        document.getElementById("dfold-n"),
    plddtC:      document.getElementById("dfold-plddt-c"),
    plddtR:      document.getElementById("dfold-plddt-r"),
    identity:    document.getElementById("dfold-id"),
  };

  // No-ops gracefully when the status indicator isn't rendered (current
  // cached-only UI doesn't ship one). All call sites are kept so the
  // live-fold path stays a drop-in restore.
  function setStatus(text, cls) {
    if (!els.status) return;
    els.status.className = "status" + (cls ? " " + cls : "");
    if (els.statusText) els.statusText.textContent = text;
  }

  function renderInfo(extra = "") {
    const g = GENES_LOCAL?.find(x => x.symbol === currentGeneSymbol);
    if (!g) { els.info.textContent = "·"; return; }
    const blurb = g.blurb ? ` · ${g.blurb}` : "";
    els.info.innerHTML = `<strong>${g.symbol}</strong> · ${g.length.toLocaleString("en-US")} bp${blurb}` + (extra ? ` · ${extra}` : "");
  }

  // Render the "DNA → mRNA → protein" progression for the current gene
  // by reusing the same splicing + ORF logic the rest of the pipeline
  // runs on the reference side. The numbers shown are gene-intrinsic
  // (architecture of the gene + canonical reference protein), so they
  // hold whether the user has clicked fold yet or not, they materialise
  // the splicing step that's otherwise invisible between the toolbar
  // and the AA block.
  //
  // Prefix is "reference:" because every number here comes from the canonical
  // sequence in genes.json, NOT from Carbon's prediction. Without the prefix
  // it's easy to read the strip, scroll past it, and assume the AA block
  // below shows that same length, but Carbon's ORF is usually shorter
  // (e.g. HBB ref 147 aa vs Carbon 131 aa).
  function renderMRNAInfo() {
    const g = GENES_LOCAL?.find(x => x.symbol === currentGeneSymbol);
    if (!g) { els.mrna.textContent = "·"; return; }

    // "completion-fold" genes ship as a CDS-only fixture (no genomic
    // intron annotation): the prompt is the first ~75% of the CDS, Carbon
    // is asked to predict the remaining ~25%, and only that C-terminal
    // tail is folded. Render a reading of THAT pipeline rather than the
    // genomic→mRNA→ORF chain that suits the original §5 fixtures.
    if (g.fold_setup?.mode === "completion-fold") {
      const fs = g.fold_setup;
      const totalBP = g.length;
      const promptBP = fs.prompt_bp;
      const genBP    = fs.generated_bp;
      const promptPct = Math.round((promptBP / totalBP) * 100);
      const genPct    = 100 - promptPct;
      const aaLen     = g.fold_example?.ref_aa?.length ?? Math.floor(genBP / 3);
      els.mrna.innerHTML =
        `<strong>${totalBP.toLocaleString("en-US")} bp</strong> CDS` +
        ` <span class="arrow">→</span> prompt <strong>${promptBP.toLocaleString("en-US")} bp</strong> (${promptPct}%)` +
        ` <span class="arrow">→</span> predict <strong>${genBP.toLocaleString("en-US")} bp</strong> (${genPct}%)` +
        ` <span class="arrow">→</span> fold <strong>${aaLen} aa</strong> C-term`;
      return;
    }

    const mrna = spliceExons(g.seq, g.exons);
    const orf  = findLongestORF(mrna, 30);
    const genomicBP = g.length;
    const mrnaBP    = mrna.length;
    const nExons    = g.exons.length;
    if (!orf) {
      els.mrna.innerHTML =
        `<strong>${genomicBP.toLocaleString("en-US")} bp</strong> genomic` +
        ` · <strong>${nExons}</strong> exon${nExons === 1 ? "" : "s"}` +
        ` <span class="arrow">→</span> <strong>${mrnaBP.toLocaleString("en-US")} bp</strong> mRNA` +
        ` <span class="arrow">→</span> no ORF ≥30 aa`;
      return;
    }
    const trunc = orf.truncated
      ? `<span class="mrna-trunc">truncated · no stop codon</span>` : "";
    els.mrna.innerHTML =
      `<strong>${genomicBP.toLocaleString("en-US")} bp</strong> genomic` +
      ` · <strong>${nExons}</strong> exon${nExons === 1 ? "" : "s"}` +
      ` <span class="arrow">→</span> <strong>${mrnaBP.toLocaleString("en-US")} bp</strong> mRNA` +
      ` <span class="arrow">→</span> <strong>${orf.aa.length} aa</strong>` +
      ` from ATG @ ${orf.startBP + 1}${trunc}`;
  }

  // Render Carbon's translated protein AND the reference protein side by
  // side, with mismatches highlighted in red on both rows so the visitor
  // can read the divergence in either direction. Mirrors §1's two-row
  // model-output / reference layout so the visual grammar carries over.
  //
  // Length asymmetry handling:
  //  - When Carbon's ORF is shorter than the reference (typical case),
  //    positions past Carbon's end are highlighted on the reference row
  //    only, they materialise "Carbon stopped early".
  //  - When Carbon's ORF is longer than the reference (rarer), positions
  //    past the reference's end are highlighted on Carbon's row, they
  //    materialise "Carbon kept reading past the real stop codon".
  function renderAAComparison(carbonAA, refAA) {
    const nC = carbonAA.length;
    const nR = refAA.length;

    // Carbon row: render every position of carbon, highlight when c[i] != r[i]
    // (or when ref ran out at i, extra Carbon residue).
    const cParts = new Array(nC);
    for (let i = 0; i < nC; i++) {
      const c = carbonAA[i], r = refAA[i];
      cParts[i] = (r === undefined || c !== r)
        ? `<span class="ref-mismatch">${c}</span>` : c;
    }
    // Reference row: symmetric, render every position of ref, highlight
    // when r[i] != c[i] (or when carbon ran out, Carbon stopped early).
    const rParts = new Array(nR);
    for (let i = 0; i < nR; i++) {
      const r = refAA[i], c = carbonAA[i];
      rParts[i] = (c === undefined || r !== c)
        ? `<span class="ref-mismatch">${r}</span>` : r;
    }
    // Soft-wrap at 40 chars, the two columns are narrower than §1's
    // single-column block, so a tighter wrap keeps lines from spilling
    // and lets the eye scan Carbon ↔ Reference at the same y position.
    const wrap = parts => {
      let out = "";
      for (let i = 0; i < parts.length; i += 40) out += parts.slice(i, i + 40).join("") + "\n";
      return out;
    };
    els.aa.innerHTML    = wrap(cParts);
    els.refAa.innerHTML = wrap(rParts);

    // Length-aware labels, the visitor sees that 131 ≠ 147 at a glance and
    // doesn't have to cross-reference with the stat row at the bottom.
    const lenTag = (n, prefix) =>
      `<span class="aa-len-tag">${prefix}${n} aa</span>`;
    const mismatches = (() => {
      const k = Math.min(nC, nR);
      let m = 0;
      for (let i = 0; i < k; i++) if (carbonAA[i] !== refAA[i]) m++;
      return m;
    })();
    els.aaLabel.innerHTML =
      `<span class="seq-tag carbon">carbon</span>` +
      lenTag(nC, "") +
      `<span class="seq-label-stat">· ${mismatches} mismatches</span>`;
    els.refAaLabel.innerHTML =
      `<span class="seq-tag ref">reference</span>` +
      lenTag(nR, "");
  }

  // Hydrate the viewers and stat row from a precomputed `fold_example`
  // shipped in genes.json by scripts/precompute.py. Avoids a cold-start
  // round-trip to the inference endpoints on first paint; the visitor
  // can still trigger a fresh run with the ▶ fold button.
  function hydrateFoldExample(ex) {
    if (!ensureViewers()) return false;
    setPending(false);  // clear any leftover "fixture pending" state
    renderStructure(viewerCarbon, ex.carbon_pdb);
    renderStructure(viewerRef,    ex.ref_pdb);
    els.nRes.textContent     = `${ex.carbon_aa.length} / ${ex.ref_aa.length}`;
    els.plddtC.textContent   = (ex.carbon_plddt_mean ?? 0).toFixed(1);
    els.plddtR.textContent   = (ex.ref_plddt_mean    ?? 0).toFixed(1);
    els.identity.textContent = (ex.identity_1d * 100).toFixed(1) + "%";
    for (const el of [els.nRes, els.plddtC, els.plddtR, els.identity]) {
      el.classList.remove("muted");
    }
    renderAAComparison(ex.carbon_aa, ex.ref_aa);
    setStatus("cached example", "");
    return true;
  }

  // Used when a gene has no precomputed fold_example. In the shipped
  // cached-only build this happens for genes whose fixture is still
  // queued for precompute (e.g. when the Carbon HF endpoint was in
  // error during the last `python scripts/precompute.py --folds` run).
  // We surface that state explicitly via an overlay on both viewers so
  // it doesn't read as a bug.
  function resetFoldUI() {
    els.aa.innerHTML = "fixture pending · precompute hasn't run yet for this gene";
    for (const el of [els.nRes, els.plddtC, els.plddtR, els.identity]) {
      el.textContent = "·";
      el.classList.add("muted");
    }
    if (viewerCarbon) { viewerCarbon.removeAllModels(); viewerCarbon.render(); }
    if (viewerRef)    { viewerRef.removeAllModels();    viewerRef.render();    }
    if (ensureViewers()) setPending(true, "fixture pending");
  }

  function selectGene(symbol) {
    currentGeneSymbol = symbol;
    els.pills.querySelectorAll(".pill").forEach(p =>
      p.classList.toggle("active", p.dataset.gene === symbol)
    );
    renderInfo();
    renderMRNAInfo();
    const g = GENES_LOCAL?.find(x => x.symbol === symbol);
    if (g?.fold_example) {
      // 3Dmol might not be loaded on the very first paint; retry shortly.
      if (!hydrateFoldExample(g.fold_example)) {
        setTimeout(() => hydrateFoldExample(g.fold_example), 300);
      }
    } else {
      setStatus("idle", "");
      resetFoldUI();
    }
  }

  // No-ops in the cached-only build, the prefix selector isn't rendered.
  // Kept here so re-adding the .pills element in the toolbar wires it
  // back up without a JS change.
  function bindPrefixPills() {
    if (!els.prefixPills) return;
    els.prefixPills.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => {
        prefixLen = +p.dataset.prefix;
        els.prefixPills.querySelectorAll(".pill").forEach(x => x.classList.remove("active"));
        p.classList.add("active");
      });
    });
  }

  async function postFold(sequence) {
    const resp = await fetch("/fold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence }),
    });
    return resp.json();
  }

  function makeViewer(host) {
    if (!window.$3Dmol) return null;
    host.innerHTML = "";
    const v = $3Dmol.createViewer(host, { backgroundColor: "#fafaf7", antialias: true });
    // 3Dmol installs a wheel listener on its internal canvas that zooms
    // the camera AND preventDefaults the page scroll. We only want orbit
    // controls; scroll should keep scrolling the page. Intercept wheel
    // events at the host in capture phase and stopImmediatePropagation
    // so 3Dmol never sees them. No preventDefault → browser scroll runs.
    // We also use this hook to bump the idle-rotation timer below so
    // ambient spin pauses the instant the visitor touches a viewer.
    host.addEventListener("wheel", (e) => {
      e.stopImmediatePropagation();
      bumpInteraction();
    }, { capture: true, passive: true });
    for (const ev of ["pointerdown", "touchstart"]) {
      host.addEventListener(ev, bumpInteraction, { capture: true, passive: true });
    }
    return v;
  }

  // ── Idle auto-rotation ────────────────────────────────────────────
  // Gentle constant-velocity Y-spin while the visitor isn't interacting,
  // to give the side-by-side comparison some life without forcing them
  // to drag every time. Any pointer/wheel input pauses immediately;
  // after IDLE_DELAY_MS of silence we ramp the spin back in over RAMP_MS
  // with an ease-in-out so the resume isn't jarring. We rotate only
  // viewerCarbon, linkViewer mirrors it onto viewerRef in the same
  // frame, so the two cartoons stay perfectly in sync.
  const IDLE_ROT_DELAY_MS = 2500;
  const IDLE_ROT_RAMP_MS  = 900;
  const IDLE_ROT_MAX_DPS  = 1;   // ~one revolution per minute
  const PREFERS_REDUCED_MOTION = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  let lastInteractionAt = performance.now();
  let idleRotRAF = 0;
  let idleRotLastT = 0;
  let idleRotSectionVisible = true;
  function bumpInteraction() { lastInteractionAt = performance.now(); }
  function idleRotStep(now) {
    idleRotRAF = 0;
    if (!viewerCarbon || !viewerRef) return;
    const dt = idleRotLastT ? Math.min(100, now - idleRotLastT) : 16;
    idleRotLastT = now;
    const idle = now - lastInteractionAt;
    if (idle >= IDLE_ROT_DELAY_MS && idleRotSectionVisible && !PREFERS_REDUCED_MOTION) {
      const k = Math.min(1, (idle - IDLE_ROT_DELAY_MS) / IDLE_ROT_RAMP_MS);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const deg = IDLE_ROT_MAX_DPS * eased * (dt / 1000);
      if (deg > 0) viewerCarbon.rotate(deg, "y", 0, false);
    }
    idleRotRAF = requestAnimationFrame(idleRotStep);
  }
  function startIdleRotation() {
    if (idleRotRAF || PREFERS_REDUCED_MOTION) return;
    idleRotLastT = 0;
    idleRotRAF = requestAnimationFrame(idleRotStep);
  }

  // Pause the rAF loop when the §5 section is offscreen, no point
  // burning frames on cartoons the visitor can't see.
  function watchFoldingVisibility() {
    const section = document.getElementById("folding");
    if (!section || !window.IntersectionObserver) return;
    new IntersectionObserver((entries) => {
      for (const e of entries) idleRotSectionVisible = e.isIntersecting;
    }, { threshold: 0.01 }).observe(section);
  }
  watchFoldingVisibility();

  // Create both viewers (idempotent) and link them so an orbit drag on
  // one propagates to the other. Mirrors the side-by-side "synced
  // cameras" setup PyMOL/ChimeraX use for structure comparison, the
  // visitor sees the same orientation of both proteins, which is what
  // makes the visual comparison meaningful. (Wheel zoom is intentionally
  // disabled in makeViewer so scroll keeps scrolling the page.)
  let viewersLinked = false;
  function ensureViewers() {
    if (!window.$3Dmol) return false;
    if (!viewerCarbon) { viewerCarbon = makeViewer(els.vCarbon); attachOverlay(els.vCarbon); }
    if (!viewerRef)    { viewerRef    = makeViewer(els.vRef);    attachOverlay(els.vRef);    }
    if (!viewersLinked && viewerCarbon && viewerRef &&
        typeof viewerCarbon.linkViewer === "function") {
      viewerCarbon.linkViewer(viewerRef);
      viewerRef.linkViewer(viewerCarbon);
      viewersLinked = true;
    }
    startIdleRotation();
    return !!(viewerCarbon && viewerRef);
  }

  // Inject the "running" overlay once per viewer host. CSS keeps it
  // hidden until the host gets the .running class via setRunning().
  function attachOverlay(host) {
    if (host.querySelector(".fold-overlay")) return;
    const o = document.createElement("div");
    o.className = "fold-overlay";
    o.innerHTML = '<span class="dot"></span><span class="fold-overlay-label">computing</span>';
    host.appendChild(o);
  }

  // Toggle the running state on both viewers + the stat row. The cached
  // cartoon stays underneath at low opacity so the visitor still has
  // visual context while waiting (vs blanking everything to a spinner).
  function setRunning(running, label = "computing") {
    for (const host of [els.vCarbon, els.vRef]) {
      host.classList.toggle("running", running);
      if (running) {
        const t = host.querySelector(".fold-overlay-label");
        if (t) t.textContent = label;
      }
    }
    for (const el of [els.nRes, els.plddtC, els.plddtR, els.identity]) {
      el.classList.toggle("muted", running);
    }
    if (els.go) els.go.textContent = running ? "running…" : "▶ fold";
  }

  // Mirror of setRunning for the "fixture not ready" state. Reuses the
  // same overlay markup but a different CSS class, so the two states
  // can never visually conflict.
  function setPending(pending, label = "fixture pending") {
    for (const host of [els.vCarbon, els.vRef]) {
      host.classList.toggle("pending", pending);
      if (pending) {
        const t = host.querySelector(".fold-overlay-label");
        if (t) t.textContent = label;
      }
    }
  }

  // Editorial pLDDT palette. The three anchor colours match the legend
  // bar under the viewers (#b00020 demo-red / #f0e8e0 paper-beige /
  // #2c5aa0 demo-blue), same tones used throughout §1 mismatches and
  // §2 base coloring, so the cartoons land in the same visual world as
  // the rest of the page instead of 3Dmol's stock primary rwb.
  const PLDDT_STOPS = [
    { v: 50,  rgb: [0xb0, 0x00, 0x20] },
    { v: 75,  rgb: [0xf0, 0xe8, 0xe0] },
    { v: 100, rgb: [0x2c, 0x5a, 0xa0] },
  ];
  function plddtToColor(plddt) {
    const x = Math.max(PLDDT_STOPS[0].v, Math.min(PLDDT_STOPS[PLDDT_STOPS.length - 1].v, plddt));
    for (let i = 0; i < PLDDT_STOPS.length - 1; i++) {
      const a = PLDDT_STOPS[i], b = PLDDT_STOPS[i + 1];
      if (x >= a.v && x <= b.v) {
        const k = (x - a.v) / (b.v - a.v);
        const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k);
        const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k);
        const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k);
        return (r << 16) | (g << 8) | bl;
      }
    }
    return 0x888888;
  }

  function renderStructure(viewer, pdb) {
    if (!viewer) return;
    viewer.removeAllModels();
    viewer.addModel(pdb, "pdb");
    // Slightly thinner ribbons + softer arrows than the 3Dmol defaults
    // to better match the demo's "editorial diagram" feel rather than a
    // textbook figure. colorfunc reads pLDDT from the PDB B-factor column.
    viewer.setStyle({}, {
      cartoon: {
        colorfunc: (atom) => plddtToColor(atom.b || 50),
        thickness: 0.5,
        arrows: true,
        tubes: false,
        opacity: 0.95,
      },
    });
    viewer.zoomTo();
    viewer.render();
    // No spin, the linked viewers share the camera, so a manual drag
    // by the visitor rotates both at once. Two independent spin loops
    // would desynchronise the cartoons visually.
  }

  async function runFold() {
    if (!window.$3Dmol) { setStatus("3Dmol not loaded, retry in a sec", "error"); return; }
    const gene = GENES_LOCAL?.find(g => g.symbol === currentGeneSymbol);
    if (!gene) return;

    // Bail early on genes whose introns push the last exon past our live-
    // demo budget. The pipeline would otherwise spend minutes generating
    // intronic filler that gets spliced out anyway.
    const f = geneFeasibility(gene);
    if (!f.feasible) {
      setStatus(
        `${gene.symbol} spans ${f.lastExonEnd.toLocaleString("en-US")} bp of genomic DNA, ` +
        `outside what Carbon can generate live. Try HBB or INS.`,
        "error"
      );
      return;
    }

    abortCtrl?.abort();
    abortCtrl = new AbortController();
    if (els.go) els.go.disabled = true;
    ensureViewers();  // overlay must exist before we toggle .running on it

    try {
      // --- Reference: spliced mRNA → longest ORF → AA -------------------
      const refORF = translateReference(gene);
      if (!refORF) throw new Error(`reference ${gene.symbol} has no valid ORF`);

      // --- Carbon: prompt → /generate → splice → ORF → AA ---------------
      // We ask Carbon to extend the prompt far enough to cover the gene's
      // last exon. Then we apply the SAME exon coordinates as the reference
      // to assemble a mature mRNA from Carbon's output. Without this splice
      // step the Carbon side reads through introns and produces nonsense
      // that has nothing to do with the model's actual coding-region skill.
      const promptDNA = gene.seq.slice(0, prefixLen).toUpperCase().replace(/[^ACGT]/g, "");
      const targetBP  = f.lastExonEnd;
      const genBP     = Math.max(0, targetBP - prefixLen) + 60; // 60-bp safety margin
      const maxTokens = Math.ceil(genBP / 6) + 8;

      setRunning(true, `generating · ${targetBP} bp`);
      setStatus(`carbon generating (${prefixLen}→${targetBP} bp)…`, "streaming");
      const continuation = await streamGenerate(promptDNA, maxTokens, 0.7, abortCtrl.signal);
      const carbonDNA    = (promptDNA + continuation).slice(0, prefixLen + genBP);
      const carbonMRNA   = spliceExons(carbonDNA, gene.exons);
      const carbonORF    = findLongestORF(carbonMRNA, 30);
      if (!carbonORF) {
        throw new Error(
          "Carbon's spliced mRNA didn't yield an ORF ≥30 aa, likely a premature stop in an early exon"
        );
      }

      // --- Fold both in parallel ----------------------------------------
      setRunning(true, "folding · esmfold");
      setStatus("folding both…", "streaming");
      const [carbonR, refR] = await Promise.all([
        postFold(carbonORF.aa),
        postFold(refORF.aa),
      ]);
      if (carbonR.error) throw new Error("carbon fold: " + carbonR.error);
      if (refR.error)    throw new Error("ref fold: "    + refR.error);

      // --- Render -------------------------------------------------------
      renderStructure(viewerCarbon, carbonR.pdb);
      renderStructure(viewerRef,    refR.pdb);

      const idn = identity1D(carbonORF.aa, refORF.aa);
      els.nRes.textContent   = `${carbonORF.aa.length} / ${refORF.aa.length}`;
      els.plddtC.textContent = (carbonR.plddt_mean ?? 0).toFixed(1);
      els.plddtR.textContent = (refR.plddt_mean    ?? 0).toFixed(1);
      els.identity.textContent = (idn * 100).toFixed(1) + "%";
      for (const el of [els.nRes, els.plddtC, els.plddtR, els.identity]) {
        el.classList.remove("muted");
      }

      renderAAComparison(carbonORF.aa, refORF.aa);

      const cacheTag = (carbonR.cached || refR.cached) ? " (cache hit)" : "";
      setStatus("done" + cacheTag, "");
    } catch (e) {
      if (e.name === "AbortError") setStatus("aborted", "");
      else setStatus("error: " + (e.message || e), "error");
    } finally {
      setRunning(false);
      abortCtrl = null;
      if (els.go) els.go.disabled = false;
    }
  }

  // --- Bootstrap ---------------------------------------------------------
  loadGenes().then(allGenes => {
    const genes = genesForSection(allGenes, "folding");
    GENES_LOCAL = genes;
    els.pills.innerHTML = genes.map((g, i) =>
      `<button class="pill${i === 0 ? " active" : ""}" data-gene="${g.symbol}">${g.symbol}</button>`
    ).join("");
    els.pills.querySelectorAll(".pill").forEach(p =>
      p.addEventListener("click", () => selectGene(p.dataset.gene))
    );
    selectGene(genes[0].symbol);
    bindPrefixPills();
    els.go?.addEventListener("click", runFold);
  }).catch(e => {
    els.info.textContent = "failed to load genes: " + (e.message || e);
  });
})();

