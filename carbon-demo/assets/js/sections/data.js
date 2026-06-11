// =========================================================================
// §9, Data composition + signal-to-noise
// =========================================================================
(function initDemo9() {
  const barsEl    = document.getElementById("d9-bars");
  const snrEl     = document.getElementById("d9-snr");
  const tplEl     = document.getElementById("d9-templates");

  const COMPOSITION = [
    { label: "GENERator-v2",  pct: 70, color: "#15803d", desc: "annotation-aware functional genomic backbone (eukaryotic, gene-centric)" },
    { label: "mRNA",          pct: 16, color: "#0369a1", desc: "OpenGenome2 mature transcripts · RNA-level functional context" },
    { label: "GTDB",          pct: 10, color: "#a16207", desc: "OpenGenome2 prokaryotic genomes · compact bacterial structure" },
    { label: "mRNA-splice",   pct:  4, color: "#7c3aed", desc: "OpenGenome2 transcript-derived · splice-related signal" },
  ];

  const TEMPLATES = [
    { pct: "50.0%", body: "<dna>SEQUENCE</dna>", note: "no metadata · default pre-training format" },
    { pct: "16.7%", body: "<species_type><gene_type><dna>SEQUENCE</dna>", note: "both metadata fields" },
    { pct: "16.7%", body: "<species_type><dna>SEQUENCE</dna>", note: "species-conditioned only" },
    { pct: "16.7%", body: "<gene_type><dna>SEQUENCE</dna>", note: "gene-type-conditioned only" },
  ];

  function renderBars() {
    // Horizontal bar rows, one per composition entry. Each bar's width
    // encodes the percentage (1% per CSS pct). Label + percentage sit
    // inside the bar where there's room; the description sits beneath.
    barsEl.innerHTML = COMPOSITION.map(s => {
      const insideLabel = s.pct >= 16;        // enough room to put text inside the fill
      return `
        <div class="d9-bar" style="--bar-color:${s.color}">
          <div class="d9-bar__track">
            <div class="d9-bar__fill" style="width:${s.pct}%;background:${s.color}">
              ${insideLabel
                ? `<span class="d9-bar__label-inside">${s.label}</span><span class="d9-bar__pct-inside">${s.pct}%</span>`
                : ""}
            </div>
            ${insideLabel
              ? ""
              : `<span class="d9-bar__label-outside" style="left:calc(${s.pct}% + 10px)">${s.label}</span><span class="d9-bar__pct-outside">${s.pct}%</span>`}
          </div>
          <div class="d9-bar__desc">${s.desc}</div>
        </div>
      `;
    }).join("");
  }

  function renderSNR() {
    const W = 1000, H = 90;
    const rowY = [22, 60];
    const segH = 18;
    let svg = "";
    // Two rows: raw genome (sparse signal) vs curated (dense signal)
    // Each row has a sequence of background + functional segments.
    function paintRow(y, segs, label) {
      svg += `<text x="6" y="${y + 13}" font-family="JetBrains Mono" font-size="10" fill="#666" letter-spacing="1">${label}</text>`;
      // gutter for the label
      const padL = 110;
      let cursor = padL;
      const rowW = W - padL - 12;
      for (const seg of segs) {
        const w = (seg.frac * rowW);
        svg += `<rect x="${cursor.toFixed(1)}" y="${y}" width="${Math.max(0.5, w).toFixed(1)}" height="${segH}" fill="${seg.func ? '#317f3f' : '#ddd'}"/>`;
        cursor += w;
      }
    }
    // Raw: ~5% functional, scattered
    const rawSegs = [
      { frac: 0.18 }, { frac: 0.015, func: true }, { frac: 0.10 }, { frac: 0.02, func: true },
      { frac: 0.30 }, { frac: 0.005, func: true }, { frac: 0.05 }, { frac: 0.01, func: true },
      { frac: 0.18 }, { frac: 0.005, func: true }, { frac: 0.115 },
    ];
    paintRow(rowY[0], rawSegs, "RAW (5%)");
    // Curated: ~46% functional, denser
    const curSegs = [
      { frac: 0.06 }, { frac: 0.10, func: true }, { frac: 0.04 }, { frac: 0.12, func: true },
      { frac: 0.06 }, { frac: 0.08, func: true }, { frac: 0.05 }, { frac: 0.10, func: true },
      { frac: 0.04 }, { frac: 0.06, func: true }, { frac: 0.05 }, { frac: 0.10, func: true },
      { frac: 0.04 },
    ];
    paintRow(rowY[1], curSegs, "CURATED (46%)");
    snrEl.innerHTML = svg;
  }

  function renderTemplates() {
    let html = "";
    for (const t of TEMPLATES) {
      html += `<div style="text-align:right;color:#317f3f;font-weight:500">${t.pct}</div>`;
      html += `<div><span style="background:#f4f4f4;padding:2px 6px;border-radius:2px;color:#1f1f1d">${t.body.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</span> <span style="color:#888;font-size:10px;margin-left:8px">${t.note}</span></div>`;
    }
    tplEl.innerHTML = html;
  }

  renderBars();
  renderSNR();
  renderTemplates();
})();

