// =========================================================================
// §1, Gene completion + annotation overlay
// =========================================================================
(function initDemo1() {
  const els = {
    pills:   document.getElementById("d1-pills"),
    info:    document.getElementById("d1-info"),
    track:   document.getElementById("d1-track"),
    seq:     document.getElementById("d1-seq"),
    go:      document.getElementById("d1-go"),
    stop:    document.getElementById("d1-stop"),
    status:  document.getElementById("d1-status"),
    statusText: document.querySelector("#d1-status span:last-child"),
    id:      document.getElementById("d1-id"),
    idExon:  document.getElementById("d1-id-exon"),
    idIntron:document.getElementById("d1-id-intron"),
    tok:     document.getElementById("d1-tok"),
    lp:      document.getElementById("d1-lp"),
    ppl:     document.getElementById("d1-ppl"),
  };

  let gene = null;
  let prefixStart = 0;
  let prefixEnd = 200;
  let genEnd = 460;              // end of generated region (genLen = genEnd - prefixEnd)
  const MIN_PROMPT_BP = 6;       // at least one BPE token's worth
  const MIN_GEN_BP = 6;
  const DEFAULT_PROMPT_BP = 200; // context bases before the prompt end
  const DEFAULT_GEN_BP = 200;    // bases the model is asked to generate
  let abortCtrl = null;
  let dragging = null;           // "start" | "end" | "genend" | null

  let promptBases = "";
  let genText = "";
  let genTokens = [];      // [{text, logprob}]
  let genTokenAtBase = []; // index into genTokens for each generated base

  function setStatus(text, mode = "") {
    els.statusText.textContent = text;
    // No "idle" UI: an empty or "idle" text means the demo hasn't done
    // anything meaningful yet → hide the pill entirely so the toolbar
    // stays clean. setStatus("done · 432 bp", ...) or any non-idle text
    // brings it back via the className reset.
    const hide = !text || text === "idle";
    els.status.className = "status" + (mode ? " " + mode : "") + (hide ? " is-hidden" : "");
  }

  function renderTrack() {
    const W = 1000, H = 52;
    if (!gene) { els.track.innerHTML = ""; return; }
    const scaleX = (bp) => (bp / gene.length) * W;
    // Track body sits y=12..40; arrow tips reach y=0 (start/genend, top) and y=52 (end, bottom).
    const TRACK_TOP = 12, TRACK_BOT = 40, INTRON_Y = 26, EXON_Y = 20, EXON_H = 12;
    // Triangle half-width and arrow vertical run: bumped so the draggable
    // handles read clearly without dominating the timeline body.
    const TRI_HW = 9, ARROW = 12;
    let svg = "";
    // Background line through introns
    svg += `<line class="intron" x1="0" y1="${INTRON_Y}" x2="${W}" y2="${INTRON_Y}"/>`;
    // Exon rectangles
    for (const e of gene.exons) {
      const x = scaleX(e.start);
      const w = Math.max(1, scaleX(e.end - e.start));
      svg += `<rect class="exon" x="${x.toFixed(1)}" y="${EXON_Y}" width="${w.toFixed(1)}" height="${EXON_H}"/>`;
    }
    // Selected prompt region (very faint, between handles)
    const xStart = scaleX(prefixStart);
    const xEnd   = scaleX(prefixEnd);
    svg += `<rect class="prompt-region" x="${xStart.toFixed(1)}" y="${TRACK_TOP}" width="${(xEnd - xStart).toFixed(1)}" height="${TRACK_BOT - TRACK_TOP}"/>`;
    // Generated region (muted green box, between prompt-end and gen-end handles)
    const xGenEnd = scaleX(genEnd);
    svg += `<rect class="gen-region" x="${xEnd.toFixed(1)}" y="${TRACK_TOP}" width="${(xGenEnd - xEnd).toFixed(1)}" height="${TRACK_BOT - TRACK_TOP}"/>`;
    // START handle: vertical line through the track body + downward triangle on top.
    svg += `<g class="handle${dragging === "start" ? " dragging" : ""}" data-role="start" transform="translate(${xStart.toFixed(1)},0)">`
        +    `<line x1="0" y1="${TRACK_TOP}" x2="0" y2="${TRACK_BOT}"/>`
        +    `<polygon points="-${TRI_HW},0 ${TRI_HW},0 0,${ARROW}"/>`
        +    `<rect x="-${TRI_HW + 4}" y="0" width="${(TRI_HW + 4) * 2}" height="${H}" fill="transparent"/>`
        + `</g>`;
    // END handle (prompt end / gen start): vertical line + upward triangle on bottom.
    svg += `<g class="handle${dragging === "end" ? " dragging" : ""}" data-role="end" transform="translate(${xEnd.toFixed(1)},0)">`
        +    `<line x1="0" y1="${TRACK_TOP}" x2="0" y2="${TRACK_BOT}"/>`
        +    `<polygon points="0,${TRACK_BOT} -${TRI_HW},${H} ${TRI_HW},${H}"/>`
        +    `<rect x="-${TRI_HW + 4}" y="0" width="${(TRI_HW + 4) * 2}" height="${H}" fill="transparent"/>`
        + `</g>`;
    // GEN-END handle: vertical line + downward triangle on top, green.
    svg += `<g class="handle gen${dragging === "genend" ? " dragging" : ""}" data-role="genend" transform="translate(${xGenEnd.toFixed(1)},0)">`
        +    `<line x1="0" y1="${TRACK_TOP}" x2="0" y2="${TRACK_BOT}"/>`
        +    `<polygon points="-${TRI_HW},0 ${TRI_HW},0 0,${ARROW}"/>`
        +    `<rect x="-${TRI_HW + 4}" y="0" width="${(TRI_HW + 4) * 2}" height="${H}" fill="transparent"/>`
        + `</g>`;
    els.track.innerHTML = svg;
  }

  function bpFromClientX(clientX) {
    if (!gene) return 0;
    const rect = els.track.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(gene.length, Math.round(frac * gene.length)));
  }

  function renderInfo() {
    if (!gene) { els.info.textContent = "loading genes…"; return; }
    const promptLen = prefixEnd - prefixStart;
    const genLen = genEnd - prefixEnd;
    els.info.innerHTML = `<strong>${gene.symbol}</strong> · ${gene.blurb} · <span style="color:#888">${gene.length.toLocaleString("en-US")} bp</span>`
      + ` · <span style="color:#888">prompt: ${prefixStart}–${prefixEnd} (${promptLen} bp)</span>`
      + ` · <span style="color:#317f3f">generate: ${prefixEnd}–${genEnd} (${genLen} bp)</span>`;
  }

  function basesPerLine() {
    // Match the existing index.html dynamic computation, but coarser.
    const cs = getComputedStyle(els.seq);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const contentW = els.seq.clientWidth - padL - padR;
    // Approx ~9px per character at 12px JBM with 1px letter-spacing
    const charW = 8.4;
    const prefixW = 7 * charW;  // "   N  "
    const blockW = 10 * charW + charW; // 10 bases + space
    if (contentW <= prefixW) return 60;
    const blocks = Math.floor((contentW - prefixW) / blockW);
    return Math.max(20, Math.min(blocks, 12) * 10);
  }

  function annotationAt(idx) {
    if (!gene) return "intergenic";
    for (const e of gene.exons) if (idx >= e.start && idx < e.end) return "exon";
    return "intron";
  }

  function renderSequenceAndRef() {
    const bpl = basesPerLine();
    const prompt = promptBases;
    const total = prompt + genText;
    const lpRange = lpRangeOf(genTokens);

    // Output: prompt in gray; generated colored by logprob, underlined green/red by ref match.
    const colorOutput = (absIdx, base) => {
      if (absIdx < prompt.length) {
        return { style: `color:rgb(${PROMPT_RGB.join(",")})` };
      }
      const genIdx = absIdx - prompt.length;
      const tok = genTokens[genTokenAtBase[genIdx]];
      const [r, g, b] = logprobRgb(tok ? tok.logprob : null, lpRange);
      const refBase = gene ? gene.seq[prefixEnd + genIdx] : undefined;
      const ulColor = refBase == null
        ? "transparent"
        : (base === refBase ? "#317f3f" : "#b00020");
      return {
        style: `color:rgb(${r},${g},${b});`
             + `text-decoration:underline;`
             + `text-decoration-color:${ulColor};`
             + `text-decoration-thickness:1.5px;`
             + `text-underline-offset:2px`
      };
    };
    renderSeq(els.seq, total, bpl, colorOutput);
  }

  function updateStats() {
    if (!gene || genText.length === 0) {
      [els.id, els.idExon, els.idIntron, els.tok, els.lp, els.ppl].forEach(e => {
        e.textContent = "·"; e.classList.add("muted");
      });
      return;
    }
    const refSlice = gene.seq.slice(prefixEnd, prefixEnd + genText.length);
    let match = 0, total = 0;
    let exonMatch = 0, exonTotal = 0;
    let intronMatch = 0, intronTotal = 0;
    for (let i = 0; i < genText.length; i++) {
      if (i >= refSlice.length) break;
      total++;
      const ok = genText[i] === refSlice[i];
      if (ok) match++;
      const ann = annotationAt(prefixEnd + i);
      if (ann === "exon") { exonTotal++; if (ok) exonMatch++; }
      else if (ann === "intron") { intronTotal++; if (ok) intronMatch++; }
    }
    const pct = (n, d) => d > 0 ? `${((n/d)*100).toFixed(0)}%` : "·";
    els.id.textContent = `${pct(match, total)} (${match}/${total})`;
    els.idExon.textContent = exonTotal > 0 ? `${pct(exonMatch, exonTotal)} (${exonMatch}/${exonTotal})` : "·";
    els.idIntron.textContent = intronTotal > 0 ? `${pct(intronMatch, intronTotal)} (${intronMatch}/${intronTotal})` : "·";
    els.tok.textContent = String(genTokens.length);
    const mlp = meanLogprob(genTokens);
    els.lp.textContent = mlp == null ? "·" : mlp.toFixed(2);
    els.ppl.textContent = mlp == null ? "·" : Math.exp(-mlp).toFixed(1);
    [els.id, els.idExon, els.idIntron, els.tok, els.lp, els.ppl].forEach(e => e.classList.remove("muted"));
  }

  function reset() {
    promptBases = gene ? gene.seq.slice(prefixStart, prefixEnd) : "";
    genText = "";
    genTokens = [];
    genTokenAtBase = [];
    renderInfo();
    renderTrack();
    renderSequenceAndRef();
    updateStats();
  }

  async function generate() {
    if (abortCtrl || !gene) return;
    reset();
    abortCtrl = new AbortController();
    els.go.disabled = true;
    els.stop.disabled = false;
    setStatus("connecting…", "streaming");

    const genLen = genEnd - prefixEnd;

    try {
      const resp = await fetch("/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptBases,
          max_tokens: Math.ceil(genLen / 6) + 4,  // tokens are ~6 bases each
          temperature: 0.5,
          top_p: 0.9,
        }),
        signal: abortCtrl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      setStatus("streaming", "streaming");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith("data:")) continue;
          const data = JSON.parse(line.slice(5).trim());
          if (data.error) throw new Error(data.error);
          if (data.done) continue;
          if (data.logprobs) {
            const lp = data.logprobs;
            for (let i = 0; i < lp.tokens.length; i++) {
              const tokIdx = genTokens.length;
              genTokens.push({ text: lp.tokens[i], logprob: lp.token_logprobs[i] });
              for (let j = 0; j < lp.tokens[i].length; j++) genTokenAtBase.push(tokIdx);
            }
          }
          if (data.text) {
            const cleaned = data.text.toUpperCase().replace(/[^ACGTN]/g, "");
            // Stop appending once we've covered the requested gen window.
            const room = Math.max(0, genLen - genText.length);
            genText += cleaned.slice(0, room);
            renderSequenceAndRef();
            updateStats();
            if (genText.length >= genLen) abortCtrl?.abort();
          }
        }
      }
      setStatus("done");
    } catch (e) {
      if (e.name === "AbortError") setStatus("done");
      else setStatus(e.message, "error");
    } finally {
      abortCtrl = null;
      els.go.disabled = false;
      els.stop.disabled = true;
      renderSequenceAndRef();
      updateStats();
    }
  }

  function stop() { if (abortCtrl) abortCtrl.abort(); }

  function selectGene(symbol) {
    const g = GENES.find(x => x.symbol === symbol);
    if (!g) return;
    gene = g;
    // Default selection: prompt = (intron context before the 2nd exon) +
    // (first 35 bp of the 2nd exon). Generation = the rest of the 2nd exon.
    // We use exons[1] (1st exon is usually 5' UTR). For very narrow exons
    // the exon-context is shortened so at least 30 bp of generation room
    // remains inside the exon.
    const exon2 = (gene.exons && gene.exons.length >= 2) ? gene.exons[1] : null;
    if (exon2) {
      const exonLen = exon2.end - exon2.start;
      const EXON_CONTEXT_BP = 35;                // first 35 bp of the exon
      const exonContextBp = Math.min(EXON_CONTEXT_BP, Math.max(0, exonLen - 30));
      prefixEnd   = exon2.start + exonContextBp;
      prefixStart = Math.max(0, prefixEnd - DEFAULT_PROMPT_BP);
      genEnd      = Math.min(gene.length, exon2.end);
    } else {
      prefixStart = 0;
      prefixEnd  = Math.min(DEFAULT_PROMPT_BP, Math.max(MIN_PROMPT_BP, gene.length - DEFAULT_GEN_BP));
      genEnd     = Math.min(gene.length, prefixEnd + DEFAULT_GEN_BP);
    }
    els.pills.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p.dataset.gene === symbol));
    reset();
  }

  function bindPills(container, attr, onSelect) {
    container.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => {
        container.querySelectorAll(".pill").forEach(x => x.classList.remove("active"));
        p.classList.add("active");
        onSelect(p.dataset[attr]);
      });
    });
  }

  // Bootstrap
  loadGenes().then(allGenes => {
    const genes = genesForSection(allGenes, "completion");
    els.pills.innerHTML = genes.map((g, i) =>
      `<button class="pill${i === 0 ? " active" : ""}" data-gene="${g.symbol}">${g.symbol}</button>`
    ).join("");
    bindPills(els.pills, "gene", selectGene);
    selectGene(genes[0].symbol);
  }).catch(e => {
    els.info.textContent = "failed to load genes: " + e.message;
  });

  els.go.addEventListener("click", generate);
  els.stop.addEventListener("click", stop);

  // Drag handles on the track to set the prompt range.
  els.track.addEventListener("pointerdown", (e) => {
    const target = e.target.closest(".handle");
    if (!target || !gene) return;
    dragging = target.dataset.role;
    els.track.setPointerCapture(e.pointerId);
    renderTrack();           // re-render so the picked handle shows its `.dragging` style
    e.preventDefault();
  });
  els.track.addEventListener("pointermove", (e) => {
    if (!dragging || !gene) return;
    const bp = bpFromClientX(e.clientX);
    if (dragging === "start") {
      prefixStart = Math.max(0, Math.min(bp, prefixEnd - MIN_PROMPT_BP));
    } else if (dragging === "end") {
      prefixEnd = Math.max(prefixStart + MIN_PROMPT_BP, Math.min(bp, genEnd - MIN_GEN_BP));
    } else if (dragging === "genend") {
      genEnd = Math.max(prefixEnd + MIN_GEN_BP, Math.min(bp, gene.length));
    }
    reset();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = null;
    try { els.track.releasePointerCapture(e.pointerId); } catch (_) {}
    renderTrack();
  };
  els.track.addEventListener("pointerup", endDrag);
  els.track.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    if (gene) renderSequenceAndRef();
  });
})();

