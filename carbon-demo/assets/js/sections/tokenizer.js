// =========================================================================
// §7, Tokenizer (1-mer vs 6-mer)
// =========================================================================
(function initDemo7() {
  const els = {
    input:  document.getElementById("d7-input"),
    len:    document.getElementById("d7-len"),
    oneSeq: document.getElementById("d7-1mer"),
    sixSeq: document.getElementById("d7-6mer"),
    oneTok: document.getElementById("d7-1mer-tok"),
    sixTok: document.getElementById("d7-6mer-tok"),
    oneAtt: document.getElementById("d7-1mer-att"),
    sixAtt: document.getElementById("d7-6mer-att"),
    bars:   document.getElementById("d7-bars"),
    speedup: document.getElementById("d7-speedup"),
  };
  // 8-color palette for 6-mer tokens (cycle); 1-mer uses base coloring.
  // A modern jewel-tone set: teal / violet / sky / pink / slate / amber /
  // green / purple. Roughly matched saturation + lightness so adjacent chips
  // read as siblings rather than a yellow-pages rainbow.
  const TOKEN_PALETTE = [
    "#0f766e", "#7c3aed", "#0369a1", "#be185d",
    "#475569", "#a16207", "#15803d", "#9333ea",
  ];
  // 1-mer bases follow the conventional sequence-viewer mapping (A green,
  // C blue, G amber, T pink) but in the same darker register so they sit
  // next to the 6-mer chips without clashing.
  const BASE_FILL = {
    A: "#15803d",
    C: "#0369a1",
    G: "#a16207",
    T: "#be185d",
    N: "#64748b",
  };

  function clean(s) { return (s || "").toUpperCase().replace(/[^ACGTN]/g, ""); }

  function render() {
    const seq = clean(els.input.value);
    els.len.textContent = `${seq.length} bp`;

    // 1-mer: each base its own pill
    let one = "";
    for (let i = 0; i < seq.length; i++) {
      const b = seq[i];
      one += `<span style="display:inline-block;background:${BASE_FILL[b]||"#888"};color:#fff;padding:2px 4px;margin:1px;border-radius:2px;font-size:10px;letter-spacing:0">${b}</span>`;
    }
    els.oneSeq.classList.toggle("empty", seq.length === 0);
    els.oneSeq.innerHTML = seq.length ? one : "·";

    // 6-mer: chunks of 6, alternating palette colors
    let six = "";
    for (let i = 0; i < seq.length; i += 6) {
      const chunk = seq.slice(i, i + 6);
      const isFull = chunk.length === 6;
      const c = TOKEN_PALETTE[(i / 6) % TOKEN_PALETTE.length];
      const padded = isFull ? chunk : chunk + "•".repeat(6 - chunk.length);
      six += `<span style="display:inline-block;background:${c};color:#fff;padding:3px 7px;margin:2px;border-radius:3px;font-size:11px;letter-spacing:1px;${isFull?"":"opacity:0.55"}">${padded}</span>`;
    }
    els.sixSeq.classList.toggle("empty", seq.length === 0);
    els.sixSeq.innerHTML = seq.length ? six : "·";

    const n1 = seq.length;
    const n6 = Math.ceil(seq.length / 6);
    els.oneTok.textContent = n1.toLocaleString("en-US");
    els.sixTok.textContent = n6.toLocaleString("en-US");
    els.oneAtt.innerHTML = `${(n1*n1).toLocaleString("en-US")}<span style="color:#999;font-size:9px;margin-left:3px">L²</span>`;
    els.sixAtt.innerHTML = `${(n6*n6).toLocaleString("en-US")}<span style="color:#999;font-size:9px;margin-left:3px">L²</span>`;

    // Speedup bars: visualize attention cost ratio
    const maxCost = n1 * n1 || 1;
    const W = 1000, H = 70, padL = 110, padR = 80, rowH = 18, padT = 12;
    let svg = "";
    const rows = [
      { label: "1-mer", n: n1, cost: n1 * n1, color: "#888" },
      { label: "6-mer", n: n6, cost: n6 * n6, color: "#317f3f" },
    ];
    rows.forEach((r, i) => {
      const y = padT + i * (rowH + 8);
      svg += `<text x="${padL - 8}" y="${y + 13}" font-family="JetBrains Mono" font-size="11" fill="#333" text-anchor="end">${r.label}</text>`;
      const w = (r.cost / maxCost) * (W - padL - padR);
      svg += `<rect x="${padL}" y="${y}" width="${Math.max(2, w)}" height="${rowH}" fill="${r.color}"/>`;
      svg += `<text x="${padL + w + 6}" y="${y + 13}" font-family="JetBrains Mono" font-size="10" fill="#333">${r.cost.toLocaleString("en-US")}</text>`;
    });
    els.bars.setAttribute("viewBox", `0 0 ${W} ${H}`);
    els.bars.style.height = `${H}px`;
    els.bars.innerHTML = svg;

    const ratio = n1 > 0 ? (n1 * n1) / Math.max(1, n6 * n6) : 36;
    els.speedup.textContent = `${ratio.toFixed(1)}× cheaper attention`;
  }

  els.input.addEventListener("input", render);
  render();
})();

