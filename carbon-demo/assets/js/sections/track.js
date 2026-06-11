// =========================================================================
// §3, Likelihood track over a real gene
//
// All tracks are precomputed (each gene in data/genes.json ships with
// its token logprobs under `track`), so this section is read-only: pick
// a gene, the cached track is rendered instantly. There is no "score"
// button, rescoring would just replay numbers we already have.
// =========================================================================
(function initDemo3() {
  const els = {
    pills: document.getElementById("d3-pills"),
    info: document.getElementById("d3-info"),
    track: document.getElementById("d3-track"),
    chart: document.getElementById("d3-chart"),
    bpLabel: document.getElementById("d3-bp-label"),
    meanExon:   document.getElementById("d3-mean-exon"),
    meanIntron: document.getElementById("d3-mean-intron"),
    delta:      document.getElementById("d3-delta"),
    tokens:     document.getElementById("d3-tokens"),
    mean:       document.getElementById("d3-mean"),
  };

  let gene = null;
  let scoreData = null;  // { tokens, token_logprobs, scoredLength }
  const cache = {};      // by gene symbol, hydrated from precomputed tracks
  const MAX_WINDOW = 24000;   // matches scripts/precompute.py TRACK_MAX_BP

  function renderTrack(scoredLen) {
    const W = 1000, H = 40;
    if (!gene) { els.track.innerHTML = ""; return; }
    const total = scoredLen || gene.length;
    const scaleX = (bp) => (bp / total) * W;
    const EXON_H = 16, EXON_Y = (H - EXON_H) / 2;  // vertically centered
    let svg = "";
    svg += `<line class="intron" x1="0" y1="${H/2}" x2="${W}" y2="${H/2}"/>`;
    for (const e of gene.exons) {
      if (e.start > total) continue;
      const x = scaleX(e.start);
      const w = Math.max(1, scaleX(Math.min(e.end, total) - e.start));
      svg += `<rect class="exon" x="${x.toFixed(1)}" y="${EXON_Y}" width="${w.toFixed(1)}" height="${EXON_H}"/>`;
    }
    els.track.innerHTML = svg;
  }

  function renderChart() {
    const W = 1000, H = 140, padT = 6, padB = 16;
    if (!scoreData || !gene) {
      els.chart.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#bbb">no precomputed track for this gene</text>`;
      return;
    }
    const tokens = scoreData.tokens;
    const lps = scoreData.token_logprobs;
    const padBases = scoreData.pad_bases || 0;
    // Skip <dna>, plus the first DNA token when it contains left-pad phantoms.
    const points = [];
    let cursor = 0;  // bp into the *padded* sequence
    let firstDnaSkipped = false;
    for (let i = 0; i < tokens.length; i++) {
      const tlen = tokens[i].length;
      if (tokens[i] === "<dna>") continue;
      if (padBases > 0 && !firstDnaSkipped) {
        firstDnaSkipped = true;
        cursor += tlen;
        continue;
      }
      const lp = lps[i];
      if (lp != null && !isNaN(lp)) {
        // Map midpoint back to gene-relative coords
        const genePos = (cursor - padBases) + tlen / 2;
        points.push({ pos: genePos, lp });
      }
      cursor += tlen;
    }
    if (!points.length) {
      els.chart.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#bbb">no logprobs returned</text>`;
      return;
    }
    const scoredLen = scoreData.scoredLength;

    // Y range
    let lpMin = Infinity, lpMax = -Infinity;
    for (const p of points) { if (p.lp < lpMin) lpMin = p.lp; if (p.lp > lpMax) lpMax = p.lp; }
    // Pad a touch so extremes don't touch the edges
    const lpPad = Math.max(0.2, (lpMax - lpMin) * 0.05);
    const yMin = lpMin - lpPad;
    const yMax = lpMax + lpPad;
    const xScale = (bp) => (bp / scoredLen) * W;
    const yScale = (lp) => padT + (1 - (lp - yMin) / Math.max(1e-9, yMax - yMin)) * (H - padT - padB);

    let svg = "";

    // Exon shading background bands
    for (const e of gene.exons) {
      if (e.start > scoredLen) continue;
      const x = xScale(e.start);
      const w = xScale(Math.min(e.end, scoredLen)) - x;
      svg += `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(1, w).toFixed(1)}" height="${H}" fill="#317f3f" opacity="0.08"/>`;
    }

    // Smoothed line: a moving average over the points (window=5)
    const win = 5;
    const smoothed = points.map((p, i) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(points.length - 1, i + win); j++) {
        s += points[j].lp; c++;
      }
      return { pos: p.pos, lp: s / c };
    });

    // Raw points as faint dots
    let dots = "";
    for (const p of points) {
      dots += `<circle cx="${xScale(p.pos).toFixed(1)}" cy="${yScale(p.lp).toFixed(1)}" r="0.9" fill="#888" opacity="0.35"/>`;
    }
    svg += dots;

    // Smoothed path on top
    let d = "";
    smoothed.forEach((p, i) => {
      d += (i === 0 ? "M" : "L") + xScale(p.pos).toFixed(1) + " " + yScale(p.lp).toFixed(1);
    });
    svg += `<path d="${d}" fill="none" stroke="#1f1f1d" stroke-width="1.2" stroke-linejoin="round"/>`;

    // Y-axis ticks
    const tickLps = [yMin + (yMax - yMin) * 0.1, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.9];
    for (const tl of tickLps) {
      const ty = yScale(tl).toFixed(1);
      svg += `<line x1="0" y1="${ty}" x2="${W}" y2="${ty}" stroke="#eee" stroke-width="1"/>`;
      svg += `<text x="4" y="${(parseFloat(ty) - 2).toFixed(1)}" font-family="JetBrains Mono" font-size="9" fill="#aaa">${tl.toFixed(1)}</text>`;
    }

    els.chart.innerHTML = svg;
    els.bpLabel.textContent = `${scoredLen.toLocaleString("en-US")} bp scored`;
  }

  function updateStats() {
    if (!scoreData || !gene) {
      [els.meanExon, els.meanIntron, els.delta, els.tokens, els.mean].forEach(e => {
        e.textContent = "·"; e.classList.add("muted");
      });
      return;
    }
    const tokens = scoreData.tokens;
    const lps = scoreData.token_logprobs;
    const padBases = scoreData.pad_bases || 0;
    let cursor = 0;
    let firstDnaSkipped = false;
    let exonSum = 0, exonN = 0;
    let intronSum = 0, intronN = 0;
    let allSum = 0, allN = 0;
    function annAt(idx) {
      for (const e of gene.exons) if (idx >= e.start && idx < e.end) return "exon";
      return "intron";
    }
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === "<dna>") continue;
      const tlen = tokens[i].length;
      if (padBases > 0 && !firstDnaSkipped) {
        firstDnaSkipped = true;
        cursor += tlen;
        continue;
      }
      const lp = lps[i];
      if (lp != null && !isNaN(lp)) {
        const mid = (cursor - padBases) + tlen / 2;
        const a = annAt(Math.floor(mid));
        if (a === "exon") { exonSum += lp; exonN++; }
        else { intronSum += lp; intronN++; }
        allSum += lp; allN++;
      }
      cursor += tlen;
    }
    const fmt = (s, n) => n > 0 ? (s / n).toFixed(2) : "·";
    els.meanExon.textContent = fmt(exonSum, exonN);
    els.meanIntron.textContent = fmt(intronSum, intronN);
    if (exonN > 0 && intronN > 0) {
      const d = (exonSum / exonN) - (intronSum / intronN);
      els.delta.textContent = (d >= 0 ? "+" : "") + d.toFixed(2);
    } else {
      els.delta.textContent = "·";
    }
    els.tokens.textContent = String(allN);
    els.mean.textContent = fmt(allSum, allN);
    [els.meanExon, els.meanIntron, els.delta, els.tokens, els.mean].forEach(e => e.classList.remove("muted"));
  }

  function selectGene(symbol) {
    const g = GENES.find(x => x.symbol === symbol);
    if (!g) return;
    gene = g;
    els.pills.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p.dataset.gene === symbol));
    const scoredBp = Math.min(gene.length, MAX_WINDOW).toLocaleString("en-US");
    const totalBp  = gene.length.toLocaleString("en-US");
    els.info.innerHTML = `<strong>${gene.symbol}</strong> · ${gene.blurb} · <span style="color:#888">${scoredBp} bp scored${gene.length > MAX_WINDOW ? ` (of ${totalBp})` : ""}</span>`;
    scoreData = cache[symbol] || null;
    renderTrack(scoreData ? scoreData.scoredLength : Math.min(gene.length, MAX_WINDOW));
    renderChart();
    updateStats();
  }

  loadGenes().then(allGenes => {
    const genes = genesForSection(allGenes, "track");
    // Hydrate cache from precomputed tracks
    for (const g of genes) {
      if (g.track) {
        cache[g.symbol] = {
          tokens: g.track.tokens,
          token_logprobs: g.track.token_logprobs,
          scoredLength: g.track.scored_length,
          pad_bases: g.track.pad_bases || 0,
        };
      }
    }
    els.pills.innerHTML = genes.map((g, i) =>
      `<button class="pill${i === 0 ? " active" : ""}" data-gene="${g.symbol}">${g.symbol}</button>`
    ).join("");
    els.pills.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => selectGene(p.dataset.gene));
    });
    selectGene(genes[0].symbol);
  });
})();

