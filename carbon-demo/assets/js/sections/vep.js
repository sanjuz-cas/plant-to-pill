// =========================================================================
// §3, VEP: original vs mutation log-likelihood
//
// Hydrates the variant cache from the precomputed scores baked into
// data/variants.json (each variant ships with ref/alt token logprobs
// for a ~4 kb window), then renders a two-row sequence display:
// the original row up top, a click-editable mutation row below, with
// per-row likelihood scores on the right and an inline verdict sentence
// underneath. Clicking any base in the mutation row cycles A→C→G→T and
// triggers a debounced rescore against the live /score endpoint, so the
// user can explore arbitrary edits beyond the canonical ClinVar alt.
// =========================================================================
(function initDemo2() {
  const els = {
    pills:      document.getElementById("d2-pills"),
    geneBox:    document.getElementById("d2-gene-box"),
    window:     document.getElementById("d2-window"),
    bars:       document.getElementById("d2-bars"),
    status:     document.getElementById("d2-status"),
    statusText: document.querySelector("#d2-status span:last-child"),
  };

  let VARIANTS = null;
  let selected = null;
  const cache = {};  // by rs id → { refSum, altSum, refLps, altLps, n }

  // One-line gene description (what the protein does).
  const GENE_INFO = {
    HBB:   "Hemoglobin β-subunit, the protein that carries oxygen in red blood cells.",
    BRCA2: "Tumor suppressor essential for repairing DNA double-strand breaks by homologous recombination. Germline loss-of-function variants drive much of hereditary breast and ovarian cancer.",
    TP53:  "Tumor suppressor that guards the cell cycle and triggers apoptosis when DNA is damaged. Disabling mutations are the most common driver across cancers.",
    F9:    "Coagulation factor IX, a serine protease in the blood-clotting cascade. Loss-of-function variants cause hemophilia B.",
    LDLR:  "Low-density lipoprotein receptor, which pulls cholesterol-carrying LDL particles out of the blood. Loss-of-function variants cause familial hypercholesterolemia.",
    VHL:   "Tumor suppressor that marks the HIF transcription factors for degradation when oxygen is plentiful. Loss of function drives Von Hippel-Lindau disease, with hemangioblastomas and renal cell carcinoma.",
    LRRK2: "Leucine-rich repeat kinase that regulates vesicle trafficking. Specific mutations are the most common monogenic cause of Parkinson's disease.",
  };

  // Per-variant description, written to flow as a natural sentence after the
  // gene description (so the two paragraphs read as one merged blurb).
  const VARIANT_DESC = {
    rs334:        "The c.20A>T mutation flips a single base in the second exon, replacing glutamic acid with valine at position 6 of the protein (p.Glu6Val). The altered hemoglobin polymerises in low oxygen, deforming red blood cells into the characteristic sickle shape, the cause of sickle cell anemia.",
    rs80359027:   "The c.7976G>T substitution replaces arginine with isoleucine at position 2659 (p.Arg2659Ile) inside one of the helical domains BRCA2 uses to bind its DNA-repair partner proteins. Missense variants in this region are recurrently reported in families with hereditary breast and ovarian cancer.",
    rs1057519981: "The c.712T>A substitution converts cysteine to serine at position 238 (p.Cys238Ser) inside TP53's DNA-binding core. The cysteine helps coordinate a structural zinc ion, and losing it destabilises the fold the tumor suppressor uses to recognise its DNA targets.",
    rs1603267420: "The c.1186T>A mutation swaps cysteine for serine at position 396 (p.Cys396Ser) in factor IX, breaking one of the disulfide bonds that stabilise the protein's catalytic domain. Loss-of-function variants in F9 cause hemophilia B.",
    rs112029328:  "The c.313+1G>T mutation hits the +1 base of an LDLR splice donor, the most conserved position in any intron and one the spliceosome essentially can't miss. With the donor lost, the affected exon is skipped or read through into intronic sequence, producing a non-functional LDL receptor and causing familial hypercholesterolemia.",
    rs1575932011: "The c.475A>T mutation rewrites a lysine codon into a stop, truncating VHL at p.Lys159Ter. The remaining protein is missing the β-domain it needs to bind HIF transcription factors and mark them for degradation, the hallmark loss-of-function pattern behind Von Hippel-Lindau disease.",
    rs34637584:   "The Gly2019Ser (G2019S) mutation sits in LRRK2's kinase activation loop and turbocharges its kinase activity. Carriers have roughly 30% lifetime risk of Parkinson's disease.",
    rs182781943:  "The c.*820A>G change sits 820 bases past VHL's stop codon, deep in the 3' untranslated region. It changes no amino acid and disrupts no splice site, so the encoded protein is identical to the reference and ClinVar classifies it as benign.",
  };

  function setStatus(text, mode = "") {
    if (!els.statusText) return;
    els.statusText.textContent = text;
    // See §1 for the "no idle pill" rationale.
    const hide = !text || text === "idle";
    els.status.className = "status" + (mode ? " " + mode : "") + (hide ? " is-hidden" : "");
  }

  // ref_window is the full ~4kb scoring window. We only render a small slice
  // around the variant for the display; the full window is still used for
  // the /score call.
  const DISPLAY_RADIUS = 30;

  // Editable mutation state. The "slice" is the DISPLAY_RADIUS*2+1 stretch
  // the user sees in the bottom row; resets to the canonical alt whenever a
  // new variant is selected, and updates as the user clicks bases.
  let mutationSlice = "";
  let mutationStart = 0;
  // editedScore overrides the cached canonical when the user has clicked any
  // base in the mutation row. null → fall back to cache[rs].
  let editedScore = null;
  let rescoreTimer = null;

  const BASE_ORDER = "ACGT";
  function cycleBase(b) {
    const i = BASE_ORDER.indexOf(b);
    return i >= 0 ? BASE_ORDER[(i + 1) % 4] : "A";
  }

  function altWindow(v) {
    // Build the full alt window from the current edited mutation slice.
    return v.ref_window.slice(0, mutationStart)
         + mutationSlice
         + v.ref_window.slice(mutationStart + mutationSlice.length);
  }

  function resetMutationFor(v) {
    const start = Math.max(0, v.var_offset - DISPLAY_RADIUS);
    const end   = Math.min(v.ref_window.length, v.var_offset + DISPLAY_RADIUS + 1);
    const orig  = v.ref_window.slice(start, end);
    const off   = v.var_offset - start;
    mutationSlice = orig.slice(0, off) + v.alt + orig.slice(off + 1);
    mutationStart = start;
    // Seed displayed scores from the canonical cache if available; otherwise
    // null means "still pending, show". An edit will clear this again.
    const c = cache[v.rs];
    editedScore = c
      ? { refSum: c.refSum, altSum: c.altSum, n: c.n }
      : null;
  }

  function renderWindowDisplay(v) {
    if (!v) { els.window.innerHTML = "·"; return; }
    const origSlice = v.ref_window.slice(mutationStart, mutationStart + mutationSlice.length);
    const variantIdx = v.var_offset - mutationStart;

    const buildRow = (seq, opts) => seq.split("").map((ch, i) => {
      const cls = ["seq-char"];
      if (i === variantIdx) cls.push("variant-pos");
      if (opts.mutation && ch !== origSlice[i]) cls.push("differs");
      const attrs = opts.editable ? ` data-idx="${i}"` : "";
      return `<span class="${cls.join(" ")}"${attrs}>${ch}</span>`;
    }).join("");

    const origRow = buildRow(origSlice,     { mutation: false, editable: false });
    const mutRow  = buildRow(mutationSlice, { mutation: true,  editable: true  });

    // Arrow line: ↓ above every position that differs from the original
    // (so the user sees an arrow at the canonical variant column AND at
    // any extra bases they click to edit).
    const arrowRow = origSlice.split("").map((ch, i) =>
      mutationSlice[i] !== ch
        ? `<span class="seq-char arrow-char">↓</span>`
        : `<span class="seq-char arrow-char">&nbsp;</span>`
    ).join("");

    // Scores + verdict. While a rescore is pending after a user edit
    // (editedScore == null but cache[v.rs] is set), we fall back to the
    // cached canonical score so the verdict sentence and both score cells
    // keep rendering instead of collapsing to "computing model likelihoods…"
    // — that swap shrank the multi-line verdict to a single line and made
    // the whole demo box jump in height on every click. The "pending"
    // state is communicated by the toolbar status pill (set in
    // onBaseClick) instead. On a first-time load of an unscored variant
    // (no cache yet) s is null and we keep the original placeholder.
    let origVal = "·", mutVal = "·", origCls = "", mutCls = "";
    let verdictHtml = `<span style="color:#888">computing model likelihoods…</span>`;
    const cached = cache[v.rs];
    const s = editedScore || cached;
    if (s) {
      const delta = s.altSum - s.refSum;
      origVal = s.refSum.toFixed(2);
      mutVal  = s.altSum.toFixed(2);
      if (Math.abs(delta) >= 0.5) {
        if (delta > 0) { origCls = "less-likely"; mutCls = "more-likely"; }
        else           { origCls = "more-likely"; mutCls = "less-likely"; }
      }
      // Verdict sentence, three buckets:
      //   delta ≤ -5: model thinks the mutation is much less likely than
      //               the original → consistent with loss-of-function.
      //   |delta| < 5: no meaningful preference → likely benign / no effect.
      //   delta ≥ +5: model thinks the mutation is *more* likely, usually
      //               means a common variant the model has seen often.
      let likelihoodPhrase, verdictPhrase;
      if (delta <= -5) {
        likelihoodPhrase = `<span class="phrase-bad">less likely</span>`;
        verdictPhrase    = `<span class="phrase-bad">likely pathogenic</span>`;
      } else if (delta >= 5) {
        likelihoodPhrase = `<span class="phrase-neutral">more likely</span>`;
        verdictPhrase    = `<span class="phrase-neutral">a common variant</span>`;
      } else {
        likelihoodPhrase = `<span class="phrase-good">about as likely as the original</span>`;
        verdictPhrase    = `<span class="phrase-good">likely benign</span>`;
      }
      verdictHtml =
        `The model considers the mutated sequence to be ${likelihoodPhrase} `
      + `<span class="verdict-math">(${s.altSum.toFixed(2)} − ${s.refSum.toFixed(2)} = `
      + `<strong>${delta.toFixed(2)}</strong>)</span> `
      + `thus ${verdictPhrase}.`;
    }

    els.window.innerHTML = `
      <div class="edit-hint">click any base in the mutation row to introduce a different change:</div>
      <div class="vep-stack">
        <div class="vep-label">original</div>
        <div class="seq-line original">${origRow}</div>
        <div class="vep-score ${origCls}">${origVal}</div>

        <div></div>
        <div class="arrow-line">${arrowRow}</div>
        <div></div>

        <div class="vep-label">mutation</div>
        <div class="seq-line mutation editable">${mutRow}</div>
        <div class="vep-score ${mutCls}">${mutVal}</div>
      </div>
      <div class="vep-verdict">${verdictHtml}</div>
    `;

    els.window.querySelectorAll(".seq-line.editable .seq-char").forEach(el => {
      el.addEventListener("click", () => onBaseClick(v, +el.dataset.idx));
    });
  }

  function onBaseClick(v, idx) {
    const cur = mutationSlice[idx] || "A";
    const next = cycleBase(cur);
    mutationSlice = mutationSlice.slice(0, idx) + next + mutationSlice.slice(idx + 1);
    editedScore = null;            // pending refetch
    // Surface the pending state in the toolbar pill right away (before the
    // 500 ms debounce kicks in). The verdict block keeps the previous
    // sentence visible so the box height stays put while we wait.
    setStatus("pending", "streaming");
    renderWindowDisplay(v);
    clearTimeout(rescoreTimer);
    rescoreTimer = setTimeout(() => rescoreEdited(v), 500);
  }

  async function rescoreEdited(v) {
    setStatus("pending", "streaming");
    try {
      const altFull = altWindow(v);
      const [refResp, altResp] = await Promise.all([
        fetch("/score", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ sequence: v.ref_window }) }).then(r => r.json()),
        fetch("/score", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ sequence: altFull })       }).then(r => r.json()),
      ]);
      if (refResp.error) throw new Error("ref: " + refResp.error);
      if (altResp.error) throw new Error("alt: " + altResp.error);
      const sumLp = (lps) => {
        let s = 0, n = 0;
        for (const lp of lps) if (lp != null && !isNaN(lp)) { s += lp; n++; }
        return { sum: s, n };
      };
      const r = sumLp(refResp.token_logprobs);
      const a = sumLp(altResp.token_logprobs);
      editedScore = { refSum: r.sum, altSum: a.sum, n: r.n };
      // Hydrate the cache too so future selects don't refetch this variant
      // when the user comes back to it (unless they've edited again).
      cache[v.rs] = { refSum: r.sum, altSum: a.sum, n: r.n };
      renderWindowDisplay(v);
      renderForestBars();
      setStatus("done");
    } catch (e) {
      setStatus(e.message, "error");
    }
  }

  function renderForestBars() {
    if (!VARIANTS) return;
    // Layout sized so the SVG renders comfortably tall in the right-hand
    // column of the §3 two-col layout (~828 px of width). The original
    // (W=1000, rowH=32) viewBox was ~3.6:1 wide which scaled down too
    // short at column width, making the per-row text squint-small;
    // (rowH=56) was the other extreme — readable but tall enough to
    // overflow a single frame in the social reel. rowH=46 with tighter
    // top/bottom padding lands at ~2.0:1 → ~415 px rendered, which
    // still keeps variant names and ±Δ values legible without zoom.
    //
    // padT carries two stacked header lines (axis title above, then
    // VARIANT / ← LESS LIKELY / MORE LIKELY → row). padB carries the
    // tick row + a two-line bottom caption.
    const W = 1000, rowH = 46, padL = 320, padR = 80, padT = 58, padB = 70;
    // Sort variants by Δ ascending (most surprising-to-the-model first), but
    // keep unscored ones at the bottom in their original order.
    const indexed = VARIANTS.map((v, i) => ({ v, idx: i, d: cache[v.rs] ? cache[v.rs].altSum - cache[v.rs].refSum : null }));
    const scored   = indexed.filter(x => x.d != null).sort((a, b) => a.d - b.d);
    const unscored = indexed.filter(x => x.d == null);
    const ordered  = scored.concat(unscored);
    const H = padT + ordered.length * rowH + padB;
    els.bars.setAttribute("viewBox", `0 0 ${W} ${H}`);
    els.bars.setAttribute("height", H);

    if (!scored.length) {
      els.bars.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#bbb">no precomputed scores available</text>`;
      return;
    }
    const absMax = Math.max(2, ...scored.map(x => Math.abs(x.d)));
    const innerW = W - padL - padR;
    const center = padL + innerW / 2;
    const scale = (innerW / 2) / absMax;
    const sigColor = (s) => s === "Pathogenic" ? "#bc2e25" : s === "Benign" ? "#317f3f" : "#e69500";

    // Bar color: encode the *model's* opinion of the mutation
    // - Δ < 0 : red (model finds mutation less likely than original).
    // - Δ > 0 : charcoal (model is fine with / prefers mutation).
    // - |Δ| ≈ 0 : muted gray.
    function barColor(d) {
      const ad = Math.abs(d);
      if (ad < 0.5) return "#bbb";
      const t = Math.min(1, ad / 4);  // 4 = saturation point; bigger Δ doesn't get redder
      if (d < 0) {
        // gray → red
        return `rgb(${lerp(170, 216, t)},${lerp(170, 58, t)},${lerp(170, 42, t)})`;
      }
      // gray → charcoal
      return `rgb(${lerp(170, 40, t)},${lerp(170, 40, t)},${lerp(170, 40, t)})`;
    }
    const VALUE_INSIDE_MIN = 64;
    const BAR_H = 22;

    let svg = "";

    // --- Top axis: directional caption ---
    // Two lines: the axis title sits above on its own row, then VARIANT
    // / ← LESS LIKELY / MORE LIKELY → share the row below. Splitting these
    // avoids the centre title colliding with the two side-arrow captions
    // when the chart renders at column width (~778 px on screen, where
    // viewBox 1000 px squashes everything to ~0.78 of its declared size).
    const capTopY1 = 20;  // axis title row
    const capTopY2 = 46;  // VARIANT / arrows row
    svg += `<text x="${center.toFixed(1)}" y="${capTopY1}" font-family="JetBrains Mono" font-size="13" fill="#666" text-anchor="middle" letter-spacing="2" font-weight="500">LOG-LIKELIHOOD DIFFERENCE</text>`;
    svg += `<text x="${(padL - 16).toFixed(1)}" y="${capTopY2}" font-family="JetBrains Mono" font-size="12" fill="#888" text-anchor="end" letter-spacing="1">VARIANT</text>`;
    svg += `<text x="${padL.toFixed(1)}" y="${capTopY2}" font-family="JetBrains Mono" font-size="12" fill="#bc2e25" letter-spacing="1">← MUTATION LESS LIKELY</text>`;
    svg += `<text x="${(W - padR).toFixed(1)}" y="${capTopY2}" font-family="JetBrains Mono" font-size="12" fill="#317f3f" letter-spacing="1" text-anchor="end">MUTATION MORE LIKELY →</text>`;

    // Faint shading: pathogenic-expected zone (left of 0)
    svg += `<rect x="${padL.toFixed(1)}" y="${(padT - 6).toFixed(1)}" width="${(center - padL).toFixed(1)}" height="${(ordered.length * rowH + 12).toFixed(1)}" fill="#bc2e25" opacity="0.04"/>`;

    // Center line
    svg += `<line x1="${center}" y1="${padT - 6}" x2="${center}" y2="${H - padB + 6}" stroke="#bbb" stroke-width="1"/>`;
    // Axis ticks
    for (const t of [-absMax, -absMax/2, 0, absMax/2, absMax]) {
      const x = center + t * scale;
      svg += `<line x1="${x.toFixed(1)}" y1="${(H - padB).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(H - padB + 6).toFixed(1)}" stroke="#aaa"/>`;
      svg += `<text x="${x.toFixed(1)}" y="${(H - padB + 20).toFixed(1)}" font-family="JetBrains Mono" font-size="13" fill="#888" text-anchor="middle">${t.toFixed(1)}</text>`;
    }

    // --- Rows ---
    ordered.forEach(({ v, d }, i) => {
      const y = padT + i * rowH + rowH / 2;

      // Curated category dot next to the variant name
      const dotR = 6;
      const dotX = padL - 16 - dotR;
      svg += `<circle cx="${dotX.toFixed(1)}" cy="${(y - 0.5).toFixed(1)}" r="${dotR}" fill="${sigColor(v.sig)}"><title>${v.sig}</title></circle>`;

      // Variant name + tiny category label
      svg += `<text x="${(dotX - dotR - 8).toFixed(1)}" y="${(y - 1).toFixed(1)}" font-family="JetBrains Mono" font-size="16" fill="#222" text-anchor="end">${v.name}</text>`;
      svg += `<text x="${(dotX - dotR - 8).toFixed(1)}" y="${(y + 16).toFixed(1)}" font-family="JetBrains Mono" font-size="12" fill="${sigColor(v.sig)}" text-anchor="end">${v.sig.toLowerCase()}</text>`;

      if (d == null) {
        svg += `<text x="${(center + 8).toFixed(1)}" y="${(y + 5).toFixed(1)}" font-family="JetBrains Mono" font-size="14" fill="#ccc">not scored</text>`;
        return;
      }

      const x = center + d * scale;
      const color = barColor(d);
      const barX = Math.min(center, x);
      const barW = Math.max(2, Math.abs(x - center));
      svg += `<rect x="${barX.toFixed(1)}" y="${(y - BAR_H / 2).toFixed(1)}" width="${barW.toFixed(1)}" height="${BAR_H}" fill="${color}" stroke="${v === selected ? '#1f1f1d' : 'none'}" stroke-width="${v === selected ? 1 : 0}"/>`;

      const label = (d >= 0 ? "+" : "") + d.toFixed(2);
      const insideOK = barW >= VALUE_INSIDE_MIN && Math.abs(d) >= 0.5;  // color is dark enough only away from neutral
      if (insideOK) {
        const tx = x + (d >= 0 ? -8 : 8);
        const anchor = d >= 0 ? "end" : "start";
        svg += `<text x="${tx.toFixed(1)}" y="${(y + 5).toFixed(1)}" font-family="JetBrains Mono" font-size="14" fill="#fff" text-anchor="${anchor}" font-weight="500">${label}</text>`;
      } else {
        const tx = x + (d >= 0 ? 8 : -8);
        const anchor = d >= 0 ? "start" : "end";
        svg += `<text x="${tx.toFixed(1)}" y="${(y + 5).toFixed(1)}" font-family="JetBrains Mono" font-size="14" fill="#333" text-anchor="${anchor}">${label}</text>`;
      }
    });

    // --- Bottom caption ---
    // Split across two lines so the full sentence fits at column width
    // without truncating on the right edge. Each line is one half of the
    // dichotomy (pathogenic vs benign) so the visual structure mirrors
    // the meaning.
    const capY1 = H - padB + 44;
    const capY2 = H - padB + 60;
    svg += `<text x="${padL.toFixed(1)}" y="${capY1}" font-family="JetBrains Mono" font-size="12" fill="#888" letter-spacing="0.5">pathogenic loss-of-function → mutation much less likely</text>`;
    svg += `<text x="${padL.toFixed(1)}" y="${capY2}" font-family="JetBrains Mono" font-size="12" fill="#888" letter-spacing="0.5">benign / common variants → about as likely as the original</text>`;

    els.bars.innerHTML = svg;
  }

  function selectVariant(rs) {
    const v = VARIANTS.find(x => x.rs === rs);
    if (!v) return;
    selected = v;
    clearTimeout(rescoreTimer);              // drop any pending rescore from the previous variant
    resetMutationFor(v);                     // mutation slice ← canonical alt
    els.pills.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p.dataset.rs === rs));
    const geneDesc = GENE_INFO[v.gene] || "";
    const varDesc  = VARIANT_DESC[v.rs]   || v.blurb;
    els.geneBox.innerHTML =
        `<div class="vep-text">`
      +   `<span class="gene-name">${v.gene}</span>: ${geneDesc} ${varDesc}`
      + `</div>`
      + `<div class="meta-line">`
      +   `<span class="meta-item"><span class="meta-key">mutation location</span>chr${v.chrom}:${v.pos.toLocaleString("en-US")}</span>`
      +   `<span class="meta-item"><span class="meta-key">base change</span>${v.ref} → ${v.alt} <span style="color:#888">(gene strand)</span></span>`
      +   `<span class="meta-item"><span class="meta-key">ClinVar</span>${v.sig}</span>`
      + `</div>`;
    renderWindowDisplay(v);
    renderForestBars();
    // If we don't have cached scores for this variant yet, score it automatically
    // (the SCORE / SCORE ALL buttons are gone).
    if (!cache[v.rs]) {
      clearTimeout(rescoreTimer);
      rescoreTimer = setTimeout(() => rescoreEdited(v), 100);
    }
  }

  fetch("/variants").then(r => r.json()).then(data => {
    VARIANTS = data;
    // Hydrate cache from precomputed scores if present
    for (const v of data) {
      if (v.score) {
        cache[v.rs] = {
          refSum: v.score.ref_sum,
          altSum: v.score.alt_sum,
          refLps: v.score.ref_logprobs,
          altLps: v.score.alt_logprobs,
          n: v.score.n,
        };
      }
    }
    els.pills.innerHTML = data.map((v, i) =>
      `<button class="pill sig-${v.sig}${i === 0 ? " active" : ""}" data-rs="${v.rs}" title="${v.blurb}">${v.gene} ${v.ref}>${v.alt}</button>`
    ).join("");
    els.pills.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => selectVariant(p.dataset.rs));
    });
    selectVariant(data[0].rs);
  }).catch(e => {
    els.geneBox.textContent = "failed to load variants: " + e.message;
  });
})();
