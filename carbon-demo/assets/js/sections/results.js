// =========================================================================
// §12, Results: training-free benchmark — horizontal Cleveland bar chart
// =========================================================================
// Numbers come straight from HuggingFaceBio/plots-release-code/barplot/barplot.py
// (the canonical paper figure source). NIAH @ 393 kbp matches the
// niah_heatmap CSV (yarn4x · plain · 65,536 tokens).
//
// Layout rationale: the previous vertical grouped-bar plot crammed 32 bars
// into ~750 px of column width; differences were visually crushed and labels
// were two-line mono at 10 px. The horizontal Cleveland format gives each
// task its own row with a fully readable label, lets the reader compare
// models at a glance per row, and keeps the "Carbon vs baselines" message
// front-and-centre via a two-family palette (greens for Carbon, neutrals
// for the rest).
(function initDemo12() {
  const host = document.getElementById("d12-bars");
  if (!host) return;

  // Two-family palette: Carbon variants in editorial green (the demo's brand
  // hue), baselines in warm neutral grey. The point is that the reader can
  // tell "Carbon vs the rest" at a glance — the previous brown/beige pair
  // for Evo2 / GENERator was too close in luminance to the green pair for
  // that to register.
  const MODELS = [
    { name: "Carbon-8B",       color: "#1A7A40", isCarbon: true  },
    { name: "Carbon-3B",       color: "#6DBF7E", isCarbon: true  },
    { name: "Evo2-7B",         color: "#5A5A56", isCarbon: false },
    { name: "GENERator-v2 3B", color: "#B5B0A6", isCarbon: false },
  ];

  // Rows are ordered by capability axis. Category strings group consecutive
  // rows; the renderer collapses runs of identical category into a single
  // italic gutter label on the left.
  // Values from the final-paper-evals dataset (HuggingFaceBio/final-paper-evals).
  // Synonymous codons is the mean of syn_human and syn_mouse (the dataset
  // ships an "avg" column that already does this). Column order in `vals`
  // mirrors MODELS above: [Carbon-8B, Carbon-3B, Evo2-7B, GENERator-v2 3B].
  const ROWS = [
    { task: "Sequence recovery",      cat: "Generative",     vals: [64.05, 61.54, 59.86, 58.56] },
    { task: "BRCA2",                  cat: "Variant effect", vals: [85.72, 84.63, 83.52, 81.93] },
    { task: "TraitGym Mendelian",     cat: "Variant effect", vals: [36.43, 33.65, 37.78, 27.91] },
    { task: "ClinVar coding",         cat: "Variant effect", vals: [93.11, 92.89, 93.33, 91.55] },
    { task: "ClinVar non-coding",     cat: "Variant effect", vals: [91.63, 91.14, 89.79, 90.13] },
    { task: "Triplet expansion",      cat: "Perturbation",   vals: [89.05, 85.20, 88.43, 83.06] },
    { task: "Synonymous codons",      cat: "Perturbation",   vals: [91.46, 88.89, 91.59, 87.03] },
    { task: "Genome-NIAH · 393 kbp",  cat: "Long-context",   vals: [86.00, 79.00, 80.00, null] },
  ];

  // ---- Render ----------------------------------------------------------
  // Layout constants. The SVG renders at viewBox W×H but scales to fit the
  // host width via preserveAspectRatio. Heights are computed from row count
  // so adding/removing tasks doesn't require manual H tweaks.
  //
  // Viewbox aspect ratio: at the previous (1280×638) the rendered chart sat
  // at ~778×388 px in the two-column layout — readable but cramped. We
  // double the internal heights (barH, gaps, fonts) so the viewBox grows
  // to ~1280×1250, which scales to a ~778×760 rendered chart: roughly 2×
  // taller, which makes individual bars and labels comfortable to read.
  function renderBars() {
    const W = 1280;
    const padL = 24;       // outer left padding (svg edge → category gutter)
    const catW = 130;      // category gutter width (italic serif label)
    const taskW = 240;     // task label column width
    const padR = 90;       // room for value label at end of bar
    const padT = 60;       // top padding (axis lives here)
    const padB = 36;       // bottom padding

    const barH = 24;       // bar thickness
    const barGap = 5;      // gap between bars within a task
    const rowH = MODELS.length * barH + (MODELS.length - 1) * barGap; // 4*24 + 3*5 = 111
    const taskGap = 26;    // gap between consecutive tasks in same category
    const catGap = 42;     // extra gap between category groups

    // Compute total H by walking rows + inserting catGap when category changes.
    let bodyH = 0;
    ROWS.forEach((row, i) => {
      bodyH += rowH;
      if (i < ROWS.length - 1) {
        bodyH += (ROWS[i + 1].cat === row.cat) ? taskGap : catGap;
      }
    });
    const H = padT + bodyH + padB;

    const barsX = padL + catW + taskW;             // x where bars start
    const barsW = W - barsX - padR;                // width of bars zone
    const xForVal = (v) => barsX + barsW * (v / 100);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" style="display:block;width:100%;height:auto;background:#fff">`;

    // ---- Axis (top) --------------------------------------------------
    // Light gridlines every 20%, plus a baseline at the left edge. The
    // x-axis ticks sit at the top of the chart so they don't get lost in
    // the row separators below. We skip the "0" label because the strong
    // baseline at x=0 already conveys it (and the label competed visually
    // with the row labels just to its left).
    const axisY = padT - 28;
    for (let tick = 0; tick <= 100; tick += 20) {
      const x = xForVal(tick);
      svg += `<line x1="${x}" y1="${padT - 10}" x2="${x}" y2="${padT + bodyH}" stroke="#eee" stroke-width="1"/>`;
      if (tick > 0) {
        svg += `<text x="${x}" y="${axisY}" font-family="JetBrains Mono" font-size="14" fill="#888" text-anchor="middle">${tick}</text>`;
      }
    }
    svg += `<text x="${xForVal(100) + 12}" y="${axisY}" font-family="JetBrains Mono" font-size="14" fill="#888" text-anchor="start">%</text>`;

    // Strong baseline at x=0 anchors the bars visually.
    svg += `<line x1="${xForVal(0)}" y1="${padT - 6}" x2="${xForVal(0)}" y2="${padT + bodyH}" stroke="#1f1f1d" stroke-width="1.5"/>`;

    // ---- Group rows by category for the gutter labels ----------------
    const groups = [];
    ROWS.forEach((row, i) => {
      const last = groups[groups.length - 1];
      if (last && last.cat === row.cat) last.rows.push(i);
      else groups.push({ cat: row.cat, rows: [i] });
    });

    // ---- Render rows --------------------------------------------------
    let y = padT;
    const rowYs = []; // remember each task's top y for category bracket pass

    ROWS.forEach((row, ri) => {
      rowYs.push(y);
      const rowMid = y + rowH / 2;
      const present = row.vals.filter(v => v !== null);
      const best = Math.max(...present);

      // Task label (left of bars). Sans-serif, slightly bolder so it reads
      // as the row's title rather than as caption.
      svg += `<text x="${barsX - 16}" y="${rowMid + 5}" font-family="Inter, sans-serif" font-size="18" font-weight="500" fill="#1f1f1d" text-anchor="end">${escapeXml(row.task)}</text>`;

      // Bars + values for each model in the row.
      MODELS.forEach((m, mi) => {
        const barY = y + mi * (barH + barGap);
        const v = row.vals[mi];

        // Faint guideline behind the bar so the row reads as continuous
        // even when a model has a short bar or null.
        svg += `<line x1="${xForVal(0)}" y1="${barY + barH / 2}" x2="${xForVal(100)}" y2="${barY + barH / 2}" stroke="#f5f5f1" stroke-width="1"/>`;

        if (v === null) {
          // n/a marker: dashed segment + faint label, in line with baseline
          // grey so it doesn't pop visually.
          svg += `<line x1="${xForVal(0)}" y1="${barY + barH / 2}" x2="${xForVal(100)}" y2="${barY + barH / 2}" stroke="#d8d4c8" stroke-width="1.5" stroke-dasharray="3 4"/>`;
          svg += `<text x="${xForVal(100) + 12}" y="${barY + barH / 2 + 5}" font-family="JetBrains Mono" font-size="14" fill="#aaa" text-anchor="start">n/a</text>`;
          return;
        }

        const w = xForVal(v) - xForVal(0);
        svg += `<rect x="${xForVal(0).toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="${m.color}" rx="2"/>`;

        // Value label at the end of the bar. Best is bold + dark with a
        // chevron; chevron is tinted Carbon-green when a Carbon model leads
        // (subtle editorial flair appuying the "Carbon leads on 6/8" line)
        // and stays neutral grey when Evo2 wins, to read honestly.
        const isBest = v === best;
        const valColor = isBest ? "#1f1f1d" : "#999";
        const valWeight = isBest ? 600 : 400;
        const chevronColor = isBest ? (m.isCarbon ? "#1A7A40" : "#5A5A56") : null;
        const chevron = chevronColor ? `<tspan fill="${chevronColor}" font-weight="700">▸ </tspan>` : "";
        svg += `<text x="${(xForVal(v) + 10).toFixed(1)}" y="${barY + barH / 2 + 5}" font-family="JetBrains Mono" font-size="15" font-weight="${valWeight}" fill="${valColor}" text-anchor="start">${chevron}${v.toFixed(1)}</text>`;
      });

      // Advance y. catGap if next row belongs to a new category.
      y += rowH;
      if (ri < ROWS.length - 1) {
        y += (ROWS[ri + 1].cat === row.cat) ? taskGap : catGap;
      }
    });

    // ---- Category gutter labels -------------------------------------
    // One italic serif label per category, vertically centred on its run
    // of rows. Pure typographic separator — no boxes, no rules — to keep
    // the chart calm.
    // Category labels and hairlines were sitting flush against the
    // svg's left padding which felt visually adrift from the task
    // labels. Nudging the whole gutter right by ~22 px ties the
    // category brackets to the rows they label without crowding them.
    const catLabelX = padL + 24;
    const catHairlineX = padL + catW - 4;
    groups.forEach(g => {
      const yTop = rowYs[g.rows[0]];
      const yBot = rowYs[g.rows[g.rows.length - 1]] + rowH;
      const yMid = (yTop + yBot) / 2 + 6;
      svg += `<text x="${catLabelX}" y="${yMid}" font-family="Georgia, serif" font-size="18" font-style="italic" fill="#666" text-anchor="start">${escapeXml(g.cat)}</text>`;
      // Subtle vertical hairline to bracket the category run when it has
      // more than one row. Skip for solo-row categories (Generative,
      // Long-context) — a hairline next to a single row reads as noise.
      if (g.rows.length > 1) {
        svg += `<line x1="${catHairlineX}" y1="${yTop + 4}" x2="${catHairlineX}" y2="${yBot - 4}" stroke="#d8d4c8" stroke-width="1.5"/>`;
      }
    });

    svg += `</svg>`;
    host.innerHTML = svg;
  }

  // SVG-safe text. The dataset is hard-coded so this is mostly defensive,
  // but cheap insurance if someone later adds a label with "&" or "<".
  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, c => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  renderBars();
})();
