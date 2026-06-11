// =========================================================================
// §11, Long context: context-ladder + Genome-NIAH retrieval
// =========================================================================
// Numbers come from the public release:
//   ladder thresholds: paper §6-Training (pretrain 8k / extend 32k / YaRN 2×–4×)
//   NIAH "plain" gen_em values: HuggingFaceBio/plots-release-code,
//     niah_heatmap/niah_heatmap_data.csv (Carbon-3B yarn4x, Carbon-8B yarn4x)
//   Evo2-7B NIAH: paper tables/eval_niah_context.tex (single source for Evo2)
(function initDemo11() {
  const ladderEl = document.getElementById("d11-ladder");
  const niahEl   = document.getElementById("d11-niah");
  if (!ladderEl || !niahEl) return;

  // ---------- context ladder ----------
  const STAGES = [
    { tokens:   8192, kbp:  49, label: "pretrain",             tone: "#1f1f1d", stageRole: "8k context · CE → FNS objective switch happens here" },
    { tokens:  32768, kbp: 197, label: "train-time extension", tone: "#317f3f", stageRole: "RoPE θ rescaled 500k → 5M · +50B tokens FNS" },
    { tokens:  65536, kbp: 393, label: "YaRN 2× · 3B reach",   tone: "#6DBF7E", stageRole: "inference-time extrapolation · Carbon-3B stops here" },
    { tokens: 131072, kbp: 786, label: "YaRN 4× · 8B reach",   tone: "#1A7A40", stageRole: "the 8B has the headroom to absorb 4× YaRN" },
  ];

  function formatTokens(t) {
    if (t >= 1024) return (t / 1024).toFixed(t % 1024 === 0 ? 0 : 1) + "k tok";
    return t + " tok";
  }

  function renderLadder() {
    const W = 1000, H = 150, padL = 80, padR = 80, padT = 32, padB = 64;
    const innerW = W - padL - padR;
    const lo = Math.log2(STAGES[0].tokens);
    const hi = Math.log2(STAGES[STAGES.length - 1].tokens);
    const xFor = tok => padL + ((Math.log2(tok) - lo) / (hi - lo)) * innerW;

    const railY = padT + 22;
    let svg = "";
    svg += `<line x1="${padL}" y1="${railY}" x2="${W - padR}" y2="${railY}" stroke="#ddd" stroke-width="1"/>`;

    // Stage segments tinted between stops
    for (let i = 0; i < STAGES.length - 1; i++) {
      const x1 = xFor(STAGES[i].tokens), x2 = xFor(STAGES[i + 1].tokens);
      svg += `<rect x="${x1}" y="${railY - 4}" width="${x2 - x1}" height="8" fill="${STAGES[i + 1].tone}" opacity="0.18"/>`;
    }

    STAGES.forEach((s) => {
      const x = xFor(s.tokens);
      svg += `<line x1="${x}" y1="${railY - 10}" x2="${x}" y2="${railY + 10}" stroke="${s.tone}" stroke-width="2"/>`;
      svg += `<text x="${x}" y="${railY - 14}" font-family="JetBrains Mono" font-size="9" fill="${s.tone}" text-anchor="middle" letter-spacing="1">${s.label.toUpperCase()}</text>`;
      svg += `<text x="${x}" y="${railY + 26}" font-family="JetBrains Mono" font-size="11" fill="#1f1f1d" text-anchor="middle" font-weight="500">${formatTokens(s.tokens)}</text>`;
      svg += `<text x="${x}" y="${railY + 40}" font-family="JetBrains Mono" font-size="10" fill="#888" text-anchor="middle">${s.kbp.toLocaleString()} kbp</text>`;
    });

    // stage descriptors centered under each segment
    for (let i = 0; i < STAGES.length - 1; i++) {
      const xMid = (xFor(STAGES[i].tokens) + xFor(STAGES[i + 1].tokens)) / 2;
      svg += `<text x="${xMid}" y="${H - 18}" font-family="JetBrains Mono" font-size="9" fill="${STAGES[i + 1].tone}" text-anchor="middle" letter-spacing="0.5">${STAGES[i + 1].stageRole}</text>`;
    }

    ladderEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    ladderEl.innerHTML = svg;
  }

  // ---------- NIAH line chart ----------
  // Plain-NIAH (no near-duplicate distractors). YaRN values for Carbon mirror
  // the niah_heatmap_data.csv yarn4x rows; Evo2-7B values are from paper
  // tables/eval_niah_context.tex (the only public Evo2 numbers we have).
  const NIAH = {
    "Carbon 8B": {
      color: "#1A7A40", weight: 2.4,
      points: [
        { tokens: 16384,  acc: 0.89 },
        { tokens: 32768,  acc: 0.87 },
        { tokens: 65536,  acc: 0.86 },
        { tokens: 131072, acc: 0.65 },
      ],
    },
    "Carbon 3B": {
      color: "#6DBF7E", weight: 2.0,
      points: [
        { tokens: 16384,  acc: 0.91 },
        { tokens: 32768,  acc: 0.90 },
        { tokens: 65536,  acc: 0.79 },
        { tokens: 131072, acc: 0.27 },
      ],
    },
    "Evo2-7B": {
      color: "#8C7355", weight: 2.0, dash: "4,3",
      points: [
        { tokens: 16384,  acc: 0.97 },
        { tokens: 32768,  acc: 0.95 },
        { tokens: 65536,  acc: 0.80 },
        { tokens: 131072, acc: 0.53 },
      ],
    },
  };

  function renderNiah() {
    const W = 1000, H = 280, padL = 70, padR = 110, padT = 18, padB = 56;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const lo = Math.log2(16384), hi = Math.log2(131072);
    const xFor = tok => padL + ((Math.log2(tok) - lo) / (hi - lo)) * innerW;
    const yFor = acc => padT + (1 - acc) * innerH;

    let svg = "";

    // y-axis gridlines + labels
    [0, 0.25, 0.50, 0.75, 1.0].forEach(v => {
      const y = yFor(v);
      svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/>`;
      svg += `<text x="${padL - 8}" y="${y + 3}" font-family="JetBrains Mono" font-size="10" fill="#888" text-anchor="end">${(v * 100).toFixed(0)}%</text>`;
    });
    svg += `<text x="20" y="${padT + innerH / 2}" font-family="JetBrains Mono" font-size="10" fill="#888" text-anchor="middle" transform="rotate(-90 20 ${padT + innerH / 2})" letter-spacing="1">RETRIEVAL EM</text>`;

    // x-axis ticks
    const TICKS = [
      { tokens: 16384,  kbp:  98 },
      { tokens: 32768,  kbp: 196 },
      { tokens: 65536,  kbp: 393 },
      { tokens: 131072, kbp: 786 },
    ];
    TICKS.forEach(t => {
      const x = xFor(t.tokens);
      svg += `<line x1="${x}" y1="${padT + innerH}" x2="${x}" y2="${padT + innerH + 4}" stroke="#888" stroke-width="1"/>`;
      svg += `<text x="${x}" y="${padT + innerH + 18}" font-family="JetBrains Mono" font-size="10" fill="#1f1f1d" text-anchor="middle">${formatTokens(t.tokens)}</text>`;
      svg += `<text x="${x}" y="${padT + innerH + 32}" font-family="JetBrains Mono" font-size="9" fill="#888" text-anchor="middle">${t.kbp} kbp</text>`;
    });

    // lines (8B last so it sits on top)
    const drawOrder = ["Evo2-7B", "Carbon 3B", "Carbon 8B"];
    drawOrder.forEach(name => {
      const s = NIAH[name];
      let d = "";
      s.points.forEach((p, i) => {
        d += (i === 0 ? "M" : "L") + xFor(p.tokens).toFixed(1) + " " + yFor(p.acc).toFixed(1);
      });
      const dash = s.dash ? `stroke-dasharray="${s.dash}"` : "";
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.weight}" ${dash}/>`;
      s.points.forEach(p => {
        svg += `<circle cx="${xFor(p.tokens).toFixed(1)}" cy="${yFor(p.acc).toFixed(1)}" r="3.5" fill="${s.color}" stroke="#fff" stroke-width="1"/>`;
      });
    });

    // end-of-line labels in the right gutter
    const endLabels = [
      { name: "Carbon 8B", acc: 0.65, color: "#1A7A40" },
      { name: "Evo2-7B",   acc: 0.53, color: "#8C7355" },
      { name: "Carbon 3B", acc: 0.27, color: "#6DBF7E" },
    ];
    const xEnd = xFor(131072);
    endLabels.forEach(l => {
      svg += `<text x="${xEnd + 10}" y="${yFor(l.acc) + 3}" font-family="JetBrains Mono" font-size="10" fill="${l.color}" font-weight="500">${l.name}</text>`;
      svg += `<text x="${xEnd + 10}" y="${yFor(l.acc) + 16}" font-family="JetBrains Mono" font-size="9" fill="#888">${(l.acc * 100).toFixed(0)}%</text>`;
    });

    niahEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    niahEl.innerHTML = svg;
  }

  renderLadder();
  renderNiah();
})();
