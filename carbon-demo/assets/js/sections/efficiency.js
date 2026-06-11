// =========================================================================
// §13, Efficiency: inference throughput vs number of prompts
// =========================================================================
// Numbers come from the public release dataset:
//   HuggingFaceBio/carbon-inference-evals (data/train-00000-of-00001.parquet),
//   filtered to non-remote prompt-scan runs through 512 prompts. Carbon and
//   GENERator runs use vLLM dynamic batching (so batch ≡ num_prompts).
//   Evo2 caps batch size to fit a single H100: Evo2 1B caps at 34 prompts,
//   7B at 13, 20B and 40B at 4. Past those caps the throughput curve flattens
//   because additional prompts spill into a second sequential mini-batch
//   instead of widening the live one.
//
// Two-family palette: cool greens for the Carbon checkpoints (light → dark
// = small → large), warm browns for the Evo2 baselines. Echoes the rest of
// the demo so "Carbon vs Evo2" reads at a glance even when several lines
// stack inside the lower decade of the log axis.
(function initDemo13() {
  const host = document.getElementById("d13-throughput");
  if (!host) return;

  const PROMPTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

  // throughput in output bp/s, indexed positionally against PROMPTS above.
  // Source: carbon-inference-evals · output_bp_per_second column.
  const SERIES = [
    { name: "Carbon-500M", color: "#A8DCB4", weight: 2.8,
      throughput: [3416.78, 5395.16, 11071.54, 21723.72, 43443.40, 74971.36, 110803.57, 161581.87, 146471.03, 152044.37] },
    { name: "Carbon-3B",   color: "#6DBF7E", weight: 3.0,
      throughput: [1489.33, 2916.85,  5561.60, 11309.62, 20109.93, 40027.81,  65218.26, 100126.89, 125130.82, 122840.91] },
    { name: "Carbon-8B",   color: "#1A7A40", weight: 3.2,
      throughput: [ 811.71, 1737.51,  3274.83,  6576.03, 12675.68, 22560.89,  39248.04,  46435.76,  76582.70,  85084.69] },
    { name: "Evo2 1B",     color: "#C9A06A", weight: 2.6, capLabel: "min(n, 34)",
      throughput: [  42.32,   86.48,   176.82,   351.63,   705.34,  1409.67,   1436.89,   1435.27,   1342.48,   1400.36] },
    { name: "Evo2 7B",     color: "#8C7355", weight: 2.6, capLabel: "min(n, 13)",
      throughput: [  33.28,   68.78,   132.86,   269.00,   267.13,   360.91,    441.94,    432.32,    453.76,    444.48] },
    { name: "Evo2 20B",    color: "#5A4A38", weight: 2.6, capLabel: "min(n, 4)",
      throughput: [  43.97,   86.04,   169.45,   175.90,   176.45,   177.16,    177.88,    180.47,    177.46,    177.17] },
    { name: "Evo2 40B",    color: "#2A211A", weight: 2.6, capLabel: "min(n, 4)",
      throughput: [  21.75,   43.01,    85.12,    85.74,    84.94,    87.20,     87.93,     85.63,     87.07,     86.78] },
  ];

  // ----- Layout ----------------------------------------------------------
  // Right gutter is wider than longcontext.js's NIAH chart because we have
  // 7 lines to label end-on (instead of 3) and Evo2 capLabels add a second
  // line under each model name. Font sizes are bumped one notch above the
  // §6 NIAH chart because this figure renders inside the same ~828 px
  // section column as a 1000 px viewBox, so the type optically lands at
  // ~10–11 px on screen — too small for a 7-series log–log plot. Sticking
  // with the 1000×460 viewBox keeps the section grid intact and just
  // restyles the contents.
  const W = 1000, H = 460;
  const padL = 86, padR = 178, padT = 30, padB = 64;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xLo = Math.log2(1), xHi = Math.log2(512);
  const yLo = Math.log10(10), yHi = Math.log10(300000);
  const xFor = n => padL + ((Math.log2(n) - xLo) / (xHi - xLo)) * innerW;
  const yFor = v => padT + ((yHi - Math.log10(v)) / (yHi - yLo)) * innerH;

  // ----- Render ----------------------------------------------------------
  function render() {
    let svg = "";

    // y-axis gridlines + labels (1-3-1-3 log decades, matches the source ref)
    const Y_TICKS = [10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000];
    Y_TICKS.forEach(v => {
      const y = yFor(v);
      const isMajor = v === 10 || v === 100 || v === 1000 || v === 10000 || v === 100000;
      svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${isMajor ? "#e5e5e5" : "#f4f4f1"}" stroke-width="1"/>`;
      svg += `<text x="${padL - 10}" y="${(y + 4).toFixed(1)}" font-family="JetBrains Mono" font-size="13" fill="${isMajor ? "#666" : "#b5b5b5"}" text-anchor="end">${formatY(v)}</text>`;
    });
    // Axis title (rotated, left side)
    svg += `<text x="22" y="${(padT + innerH / 2).toFixed(1)}" font-family="JetBrains Mono" font-size="12" fill="#666" text-anchor="middle" transform="rotate(-90 22 ${(padT + innerH / 2).toFixed(1)})" letter-spacing="1.2">THROUGHPUT · BP/S · LOG</text>`;

    // x-axis ticks + labels
    PROMPTS.forEach(n => {
      const x = xFor(n);
      svg += `<line x1="${x.toFixed(1)}" y1="${(padT + innerH).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(padT + innerH + 5).toFixed(1)}" stroke="#666" stroke-width="1"/>`;
      svg += `<text x="${x.toFixed(1)}" y="${(padT + innerH + 22).toFixed(1)}" font-family="JetBrains Mono" font-size="13" fill="#1f1f1d" text-anchor="middle">${n}</text>`;
    });
    // x-axis title
    svg += `<text x="${(padL + innerW / 2).toFixed(1)}" y="${(padT + innerH + 50).toFixed(1)}" font-family="JetBrains Mono" font-size="12" fill="#666" text-anchor="middle" letter-spacing="1.2">NUMBER OF PROMPTS · LOG</text>`;

    // baseline at the bottom of the plot zone
    svg += `<line x1="${padL}" y1="${(padT + innerH).toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" stroke="#1f1f1d" stroke-width="1.2"/>`;

    // lines (drawn lightest → darkest so the dark Carbon-8B sits on top of
    // its lighter Carbon siblings where the curves cross at low n)
    const drawOrder = [
      "Carbon-500M", "Evo2 1B", "Evo2 20B", "Evo2 40B", "Evo2 7B",
      "Carbon-3B", "Carbon-8B"
    ];
    drawOrder.forEach(name => {
      const s = SERIES.find(s => s.name === name);
      let d = "";
      s.throughput.forEach((v, i) => {
        const x = xFor(PROMPTS[i]);
        const y = yFor(v);
        d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
      });
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.weight}" stroke-linejoin="round" stroke-linecap="round"/>`;
      s.throughput.forEach((v, i) => {
        const x = xFor(PROMPTS[i]);
        const y = yFor(v);
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="${s.color}" stroke="#fff" stroke-width="1.2"/>`;
      });
    });

    // End-of-line labels in the right gutter. Each label sits at the y of
    // the n=512 data point; we then nudge overlapping labels apart so the
    // 7-line stack stays legible (Carbon-500M / Carbon-3B are within 0.09
    // log-decades of each other).
    const xEnd = xFor(512) + 14;
    const labels = SERIES.map(s => {
      const last = s.throughput[s.throughput.length - 1];
      return { name: s.name, color: s.color, capLabel: s.capLabel, value: last, y: yFor(last) };
    }).sort((a, b) => a.y - b.y);

    const minGap = 36;        // px, room for two text lines per label
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < minGap) {
        labels[i].y = labels[i - 1].y + minGap;
      }
    }

    labels.forEach(l => {
      svg += `<text x="${xEnd.toFixed(1)}" y="${l.y.toFixed(1)}" font-family="JetBrains Mono" font-size="14" fill="${l.color}" font-weight="600">${l.name}</text>`;
      const sub = l.capLabel
        ? `<tspan fill="#aaa">batch </tspan>${l.capLabel}`
        : `<tspan fill="#aaa">${formatBp(l.value)} bp/s</tspan>`;
      svg += `<text x="${xEnd.toFixed(1)}" y="${(l.y + 16).toFixed(1)}" font-family="JetBrains Mono" font-size="11" fill="#888">${sub}</text>`;
    });

    host.setAttribute("viewBox", `0 0 ${W} ${H}`);
    host.innerHTML = svg;
  }

  // 10 → "10", 1000 → "1k", 30000 → "30k", 100000 → "100k"
  function formatY(v) {
    if (v >= 1000) return (v / 1000) + "k";
    return String(v);
  }
  function formatBp(v) {
    if (v >= 10000) return Math.round(v / 1000) + "k";
    if (v >= 1000)  return (v / 1000).toFixed(1) + "k";
    return Math.round(v).toLocaleString();
  }

  render();
})();
