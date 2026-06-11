// =========================================================================
// §4, Same gene across species
// =========================================================================
(function initDemo4() {
  const els = {
    pills:       document.getElementById("d4-pills"),
    prefixPills: document.getElementById("d4-prefix-pills"),
    genPills:    document.getElementById("d4-gen-pills"),
    info:        document.getElementById("d4-info"),
    rows:        document.getElementById("d4-rows"),
    go:          document.getElementById("d4-go"),
    status:      document.getElementById("d4-status"),
    statusText:  document.querySelector("#d4-status span:last-child"),
  };

  let SPECIES_DATA = null;
  let entry = null;     // { symbol, species: [...] }
  let prefixLen = 400;
  let genLen = 60;
  // Per species: { genText, genTokens, genTokenAtBase, status }
  let runState = {};

  function setStatus(text, mode = "") {
    els.statusText.textContent = text;
    // See §1 for the "no idle pill" rationale.
    const hide = !text || text === "idle";
    els.status.className = "status" + (mode ? " " + mode : "") + (hide ? " is-hidden" : "");
  }

  function basesPerLine(el) {
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const contentW = el.clientWidth - padL - padR;
    const charW = 7.4;
    const prefixW = 7 * charW;
    const blockW = 10 * charW + charW;
    if (contentW <= prefixW) return 60;
    const blocks = Math.floor((contentW - prefixW) / blockW);
    return Math.max(20, Math.min(blocks, 12) * 10);
  }

  // Choose where the prompt sits inside the species seq. The §1 finding is
  // that Carbon is most predictive when it's continuing the 2nd exon with
  // some intron context behind it. We replicate that here: anchor prefixEnd
  // a bit past the start of exon 2 (35 bp of exon context, like §1) and
  // slide prefixStart back by the user-selected `prefixLen`. If exon 2
  // isn't visible in the trimmed seq, fall back to a flat slice from start.
  function getPromptWindow(s, prefixLen) {
    const exons = s.exons || [];
    const exon2 = exons.length >= 2 ? exons[1] : null;
    if (exon2) {
      const EXON_CTX = 35;
      const exonLen = exon2.end - exon2.start;
      const exonCtx = Math.min(EXON_CTX, Math.max(0, exonLen - 30));
      const prefixEnd = Math.min(s.length, exon2.start + exonCtx);
      const prefixStart = Math.max(0, prefixEnd - prefixLen);
      return { prefixStart, prefixEnd };
    }
    return { prefixStart: 0, prefixEnd: Math.min(s.length, prefixLen) };
  }

  function renderRow(s) {
    const wrap = document.createElement("div");
    wrap.className = "species-row";
    wrap.dataset.id = s.species_id;

    const stat = runState[s.species_id] || {};
    const genText = stat.genText || "";
    const { prefixStart, prefixEnd } = getPromptWindow(s, prefixLen);
    const refSlice = s.seq.slice(prefixEnd, prefixEnd + genLen);
    let match = 0, total = 0;
    for (let i = 0; i < genText.length && i < refSlice.length; i++) {
      total++;
      if (genText[i] === refSlice[i]) match++;
    }
    const idPct = total > 0 ? `${((match / total) * 100).toFixed(0)}%` : "·";
    const meanLp = stat.genTokens ? meanLogprob(stat.genTokens) : null;
    const promptBp = prefixEnd - prefixStart;

    wrap.innerHTML = `
      <div class="species-meta">
        <div class="species-name" style="border-left-color:${s.color}">${s.common}</div>
        <div class="species-sub">${s.ortholog_symbol}</div>
        <div class="species-sub">chr${s.chrom} · strand ${s.strand}</div>
        <div class="species-sub" style="color:#999">${promptBp} bp prompt</div>
        <div class="species-stats">
          <div class="stat-id">${idPct}</div>
          <div class="stat-sub">${total > 0 ? `${match}/${total} bases` : "not run"}</div>
          ${meanLp == null ? "" : `<div class="stat-sub">logP ${meanLp.toFixed(2)}</div>`}
        </div>
      </div>
      <div>
        <div class="species-seq" data-role="output"></div>
        <div class="species-seq" data-role="ref" style="margin-top:4px"></div>
      </div>
    `;

    const outEl = wrap.querySelector('[data-role="output"]');
    const refEl = wrap.querySelector('[data-role="ref"]');

    if (stat.status === "error") {
      outEl.classList.add("empty");
      outEl.style.color = "#b00020";
      outEl.textContent = stat.error || "error";
      refEl.style.display = "none";
    } else {
      outEl.classList.remove("empty");
      const bpl = basesPerLine(outEl);
      const prompt = s.seq.slice(prefixStart, prefixEnd);
      const total = prompt + genText;
      const lpRange = stat.genTokens ? lpRangeOf(stat.genTokens) : null;
      const colorOut = (absIdx) => {
        if (absIdx < prompt.length) return { style: `color:rgb(${PROMPT_RGB.join(",")})` };
        const tok = stat.genTokens && stat.genTokenAtBase
          ? stat.genTokens[stat.genTokenAtBase[absIdx - prompt.length]]
          : null;
        const [r, g, b] = logprobRgb(tok ? tok.logprob : null, lpRange);
        return { style: `color:rgb(${r},${g},${b})` };
      };
      renderSeq(outEl, total, bpl, colorOut);

      // Reference (only the generated span)
      if (genText.length > 0) {
        const refSpanEnd = Math.min(s.length, prefixEnd + genLen);
        const refSeq = s.seq.slice(prefixEnd, refSpanEnd);
        const colorRef = (absIdx, base) => {
          // absIdx is local to refSeq (starts at 0)
          const genIdx = absIdx;
          if (genIdx >= genText.length) return { style: "color:#ccc" };
          const matches = genText[genIdx] === base;
          return matches
            ? { style: "color:#bbb" }
            : { style: "color:#b00020;background:rgba(188,46,37,0.18)" };
        };
        const bpl2 = basesPerLine(refEl);
        renderSeq(refEl, refSeq, bpl2, colorRef);
        refEl.style.display = "";
      } else {
        refEl.style.display = "none";
      }
    }

    els.rows.appendChild(wrap);
  }

  function renderAll() {
    els.rows.innerHTML = "";
    if (!entry) return;
    for (const s of entry.species) renderRow(s);
  }

  async function generateForSpecies(s) {
    const { prefixStart, prefixEnd } = getPromptWindow(s, prefixLen);
    const prompt = s.seq.slice(prefixStart, prefixEnd);
    const stat = { genText: "", genTokens: [], genTokenAtBase: [], status: "running" };
    runState[s.species_id] = stat;
    renderAll();
    try {
      const resp = await fetch("/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt, max_tokens: Math.ceil(genLen / 6) + 4, temperature: 0.5, top_p: 0.9,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
              const tokIdx = stat.genTokens.length;
              stat.genTokens.push({ text: lp.tokens[i], logprob: lp.token_logprobs[i] });
              for (let j = 0; j < lp.tokens[i].length; j++) stat.genTokenAtBase.push(tokIdx);
            }
          }
          if (data.text) {
            const cleaned = data.text.toUpperCase().replace(/[^ACGTN]/g, "");
            const room = Math.max(0, genLen - stat.genText.length);
            stat.genText += cleaned.slice(0, room);
            renderAll();
            if (stat.genText.length >= genLen) return;
          }
        }
      }
      stat.status = "done";
    } catch (e) {
      stat.status = "error";
      stat.error = e.message;
      throw e;
    } finally {
      renderAll();
    }
  }

  async function runAll() {
    if (!entry) return;
    runState = {};
    setStatus("running…", "streaming");
    els.go.disabled = true;
    try {
      // Generate all species in parallel. Each call streams into its own
      // runState slot and triggers its own renderAll(), so rows fill in
      // roughly together rather than one-after-another. The endpoint
      // (vLLM with batching) handles a handful of concurrent /generate
      // calls fine for the species count we have here.
      await Promise.all(entry.species.map(s =>
        generateForSpecies(s).catch(() => { /* let other species finish */ })
      ));
      setStatus("done");
    } finally {
      els.go.disabled = false;
    }
  }

  function selectGene(symbol) {
    entry = SPECIES_DATA.find(x => x.symbol === symbol);
    if (!entry) return;
    els.pills.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p.dataset.gene === symbol));
    els.info.innerHTML = `<strong>${entry.symbol}</strong> · same gene, ${entry.species.length} species · prefix anchored to the 2nd exon of each species (intron context, then generate into the exon)`;
    runState = {};
    renderAll();
    setStatus("idle");
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

  fetch("/species").then(r => r.json()).then(data => {
    SPECIES_DATA = data;
    els.pills.innerHTML = data.map((g, i) =>
      `<button class="pill${i === 0 ? " active" : ""}" data-gene="${g.symbol}">${g.symbol}</button>`
    ).join("");
    els.pills.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => selectGene(p.dataset.gene));
    });
    selectGene(data[0].symbol);
  }).catch(e => {
    els.info.textContent = "failed to load species: " + e.message;
  });

  bindPills(els.prefixPills, "prefix", (v) => { prefixLen = +v; runState = {}; renderAll(); });
  bindPills(els.genPills,    "gen",    (v) => { genLen = +v; runState = {}; renderAll(); });
  els.go.addEventListener("click", runAll);
  window.addEventListener("resize", () => renderAll());
})();

