// =========================================================================
// §7, Species tree (Carbon-derived phylogeny)
//
// Renders the precomputed species_tree.json (built once by
// scripts/build_species_tree.py) as:
//   - an SVG dendrogram spine on the left, with rounded Bezier elbows
//     so the branches feel organic rather than CAD-like
//   - a column of right-aligned data tracks (italic name, kingdom chip,
//     log-scaled sequence count bar, NCBI agreement glyph)
// The two halves share the same row height (ROW_H px) so each leaf in
// the SVG lines up exactly with its row in the data tracks.
//
// User can toggle:
//   - linkage = ward | upgma  → swaps the precomputed layout
//   - scope = kingdom | sister → swaps the NCBI agreement metric
// Hovering a row pops a tooltip listing the top-3 nearest neighbours
// in embedding space + their cosine distances.
// =========================================================================
(function initDemoSpeciesTree() {
  const root = document.getElementById("demoSpeciesTree");
  if (!root) return;

  const ROW_H = 22;          // px, must match .tree-row height in CSS
  // SVG-internal padding kept at 0: vertical alignment with the rows
  // grid is handled entirely by the CSS padding on .tree-spine /
  // .tree-rows (both = 12px top). Doubling it would shift the spine
  // down by 12px relative to the row labels.
  const SPINE_PAD_TOP = 0;
  const SPINE_PAD_BOTTOM = 0;
  const ROWS_PAD_TOP = 12;   // must match .tree-rows padding
  const ROWS_PAD_BOTTOM = 28;
  const SPINE_LABEL_INSET = 4; // tiny gap between spine tip and labels

  const KINGDOM_COLOR = {
    vertebrates:   "#1f1f1d",
    invertebrates: "#7a6242",
    plants:        "#317f3f",
    fungi:         "#a9762f",
    bacteria:      "#b00020",
  };

  const els = {
    spine:    document.getElementById("dtree-spine"),
    svg:      document.getElementById("dtree-svg"),
    rows:     document.getElementById("dtree-rows"),
    info:     document.getElementById("dtree-info"),
    score:    document.getElementById("dtree-score"),
    scorePct: document.getElementById("dtree-score-pct"),
    scoreSx:  document.getElementById("dtree-score-suffix"),
    nSp:      document.getElementById("dtree-n"),
    nSeq:     document.getElementById("dtree-nseq"),
    tooltip:  document.getElementById("dtree-tooltip"),
    frame:    root.querySelector(".tree-frame"),
    pillsLink:  document.getElementById("dtree-link-pills"),
    pillsScope: document.getElementById("dtree-scope-pills"),
  };

  let tree = null;
  let state = { linkage: "ward", scope: "kingdom" };
  let agreement = {};   // species -> 'match' | 'mismatch' | 'solo'
  let nnTop = {};       // species -> [{name, dist, sameKingdom, sameClade}, ...]

  // -------- nearest-neighbour computation --------
  function buildNN() {
    const sp = tree.species;
    const D = tree.distance_matrix;
    const kingdom = Object.fromEntries(sp.map((s, i) => [s, tree.kingdom[i]]));
    const clade   = Object.fromEntries(sp.map((s, i) => [s, tree.expected_clade[i]]));
    const cladeSize = {};
    sp.forEach(s => { const c = clade[s]; cladeSize[c] = (cladeSize[c] || 0) + 1; });

    nnTop = {};
    agreement = {};
    for (let i = 0; i < sp.length; i++) {
      // sort other species by distance ascending
      const ranked = [];
      for (let j = 0; j < sp.length; j++) {
        if (j === i) continue;
        ranked.push({
          name: sp[j], dist: D[i][j],
          sameKingdom: kingdom[sp[j]] === kingdom[sp[i]],
          sameClade:   clade[sp[j]]   === clade[sp[i]],
        });
      }
      ranked.sort((a, b) => a.dist - b.dist);
      nnTop[sp[i]] = ranked.slice(0, 3);

      // agreement state for the active scope
      const nn = ranked[0];
      if (state.scope === "kingdom") {
        agreement[sp[i]] = nn.sameKingdom ? "match" : "mismatch";
      } else {
        if ((cladeSize[clade[sp[i]]] || 0) <= 1) agreement[sp[i]] = "solo";
        else agreement[sp[i]] = nn.sameClade ? "match" : "mismatch";
      }
    }
  }

  // -------- score chip --------
  // Three pieces of typography: headline % (Carbon green), raw ratio
  // (m of total, muted), uppercase caption naming the comparison.
  function updateScore() {
    let m = 0, total = 0;
    Object.values(agreement).forEach(v => {
      if (v === "solo") return;
      total += 1;
      if (v === "match") m += 1;
    });
    const pct = total ? Math.round(100 * m / total) : 0;
    if (els.scorePct) els.scorePct.textContent = `${pct}%`;
    els.score.textContent = `${m} of ${total}`;
    els.scoreSx.textContent = `match · ncbi ${state.scope}`;
  }

  // -------- SVG dendrogram spine --------
  // scipy gives icoord/dcoord for each merge:
  //   icoord = [xL, xL, xR, xR]   (in "leaf-index space": leaves at 5,15,25,...)
  //   dcoord = [yChildL, yMerge, yMerge, yChildR]   (in distance space)
  // We need to render this with leaf-index → vertical row position
  // and distance → horizontal x position (with root on the LEFT, tips
  // on the RIGHT, so labels sit next to the leaves).
  function renderSpine() {
    const layout = tree[state.linkage === "ward" ? "layout_ward" : "layout_upgma"];
    const leafOrder = layout.leaf_order;
    const ic = layout.icoord;
    const dc = layout.dcoord;

    const N = leafOrder.length;
    const innerH = N * ROW_H;
    const totalH = innerH + SPINE_PAD_TOP + SPINE_PAD_BOTTOM;

    const w = els.spine.clientWidth || 320;
    els.svg.style.height = totalH + "px";
    els.svg.setAttribute("viewBox", `0 0 ${w} ${totalH}`);

    // distance domain
    let dmax = 0;
    dc.forEach(arr => arr.forEach(v => { if (v > dmax) dmax = v; }));
    if (dmax === 0) dmax = 1;

    // In mobile (<=720px) the right-hand .tree-rows block stacks BELOW
    // the spine instead of beside it, so the spine renders inline labels
    // (kingdom chip + species name) at each tip, otherwise the user sees
    // an unlabelled dendrogram followed by a list, which doesn't connect.
    const isMobile = window.matchMedia("(max-width: 720px)").matches;
    const padL = 4;                // a hair from the SVG left edge (= root)
    const padR = isMobile ? 130 : SPINE_LABEL_INSET; // room for inline labels in mobile
    const innerW = w - padL - padR;

    const xOfDist = d => padL + (1 - d / dmax) * innerW;
    const yOfLeafIdx = idx => SPINE_PAD_TOP + (idx + 0.5) * ROW_H;
    const yOfICoord = ix => yOfLeafIdx((ix - 5) / 10);

    // Classic dendrogram elbows: top arm horizontal → vertical → bottom
    // arm horizontal, sharp 90° corners. Single <path> for perf.
    let d = "";
    for (let i = 0; i < ic.length; i++) {
      const xs = ic[i], ys = dc[i];
      const yTop   = yOfICoord(xs[0]);
      const yBot   = yOfICoord(xs[3]);
      const xMerge  = xOfDist(ys[1]);
      const xTopArm = xOfDist(ys[0]);
      const xBotArm = xOfDist(ys[3]);
      d += ` M ${xTopArm} ${yTop}`
        +  ` L ${xMerge} ${yTop}`
        +  ` L ${xMerge} ${yBot}`
        +  ` L ${xBotArm} ${yBot}`;
    }

    // Pastilles at each leaf tip, coloured by kingdom, that visually
    // connect the muted-grey tree spine to the kingdom-coloured tracks
    // on the right. They also act as a discrete "row marker" so the eye
    // can follow horizontally even where the spine background tint is
    // very pale (chicken / frog / zebrafish in the vertebrate band).
    const kingdom = Object.fromEntries(tree.species.map((s, i) => [s, tree.kingdom[i]]));
    let tips = "";
    for (let i = 0; i < leafOrder.length; i++) {
      const sp = leafOrder[i];
      const cy = yOfLeafIdx(i);
      const cx = w - padR;
      const k = kingdom[sp];
      const fill = (
        k === "vertebrates"   ? "#1f1f1d" :
        k === "invertebrates" ? "#7a6242" :
        k === "plants"        ? "#317f3f" :
        k === "fungi"         ? "#a9762f" :
        k === "bacteria"      ? "#b00020" : "#888"
      );
      tips += `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${fill}" stroke="#fff" stroke-width="0.8"/>`;
      if (isMobile) {
        // chip + species label rendered inline at the tip, only visible
        // in mobile (desktop hides them via CSS, see .leaf-svg-label).
        tips += `<rect class="leaf-svg-chip" x="${cx + 6}" y="${cy - 4}" width="8" height="8" fill="${fill}"/>`;
        tips += `<text class="leaf-svg-label" x="${cx + 18}" y="${cy + 3.5}" fill="${fill}">${sp.replace(/_/g, " ")}</text>`;
      }
    }

    els.svg.innerHTML =
      `<path d="${d}" fill="none" stroke="#bbb8ad" stroke-width="1"
             stroke-linecap="square" stroke-linejoin="miter"
             shape-rendering="crispEdges" />` + tips;
    return leafOrder;
  }

  // -------- rows --------
  function renderRows(leafOrder) {
    const counts = Object.fromEntries(tree.species.map((s, i) => [s, tree.counts[i]]));
    const kingdom = Object.fromEntries(tree.species.map((s, i) => [s, tree.kingdom[i]]));
    const maxLog = Math.log10(Math.max(...tree.counts) + 1);

    let html = "";
    for (let i = 0; i < leafOrder.length; i++) {
      const sp = leafOrder[i];
      const k  = kingdom[sp];
      const c  = counts[sp];
      const logFrac = Math.log10(c + 1) / maxLog;
      const a = agreement[sp] || "solo";
      const glyph = a === "match" ? "✓" : a === "mismatch" ? "✗" : "·";
      html +=
        `<div class="tree-row" data-species="${sp}" data-kingdom="${k}">` +
          `<div class="tree-chip" style="background:${KINGDOM_COLOR[k]}"></div>` +
          `<div class="tree-name">${sp.replace(/_/g, " ")}</div>` +
          `<div class="tree-bar">` +
            `<div class="bar-track">` +
              `<div class="bar-fill" style="width:${(logFrac * 100).toFixed(1)}%"></div>` +
            `</div>` +
            `<div class="bar-num">${c.toLocaleString("en-US")}</div>` +
          `</div>` +
          `<div class="tree-ncbi" data-state="${a}">${glyph}</div>` +
        `</div>`;
    }
    els.rows.innerHTML = html;
    bindRowHover();
  }

  // -------- hover tooltip --------
  function bindRowHover() {
    els.rows.querySelectorAll(".tree-row").forEach(rowEl => {
      rowEl.addEventListener("mouseenter", () => {
        const sp = rowEl.dataset.species;
        const top = nnTop[sp] || [];
        const expected = state.scope === "kingdom"
          ? "same kingdom" : "same ncbi sister clade";
        let tt =
          `<div class="tt-title">${sp.replace(/_/g, " ")} · top neighbours</div>`;
        top.forEach((nb, i) => {
          const isExpected = state.scope === "kingdom" ? nb.sameKingdom : nb.sameClade;
          const cls = isExpected ? "tt-name expected" : "tt-name";
          const glyph = isExpected ? "✓" : "·";
          tt +=
            `<div class="tt-pair">` +
              `<span class="tt-glyph">${glyph}</span>` +
              `<span class="${cls}">${nb.name.replace(/_/g, " ")}</span>` +
              `<span class="tt-dist">${nb.dist.toFixed(4)}</span>` +
            `</div>`;
        });
        tt += `<div class="tt-pair" style="margin-top:6px;color:#888">` +
              `<span class="tt-glyph"></span>` +
              `<span style="font-size:9px">match = ${expected}</span></div>`;
        els.tooltip.innerHTML = tt;
        els.tooltip.classList.add("show");
      });
      rowEl.addEventListener("mousemove", (ev) => {
        const fr = els.frame.getBoundingClientRect();
        const tt = els.tooltip;
        const x = ev.clientX - fr.left + 12;
        const y = ev.clientY - fr.top + 12;
        // keep on-screen
        const ttw = tt.offsetWidth, tth = tt.offsetHeight;
        const fitX = (x + ttw > fr.width) ? (ev.clientX - fr.left - ttw - 12) : x;
        const fitY = (y + tth > fr.height) ? (ev.clientY - fr.top - tth - 12) : y;
        tt.style.left = fitX + "px";
        tt.style.top  = fitY + "px";
      });
      rowEl.addEventListener("mouseleave", () => {
        els.tooltip.classList.remove("show");
      });
    });
  }

  // -------- toggles --------
  function bindToggles() {
    els.pillsLink.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => {
        if (p.classList.contains("active")) return;
        els.pillsLink.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
        p.classList.add("active");
        state.linkage = p.dataset.link;
        rerender();
      });
    });
    els.pillsScope.querySelectorAll(".pill").forEach(p => {
      p.addEventListener("click", () => {
        if (p.classList.contains("active")) return;
        els.pillsScope.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
        p.classList.add("active");
        state.scope = p.dataset.scope;
        // scope only changes agreement, not layout, but it's cheap to redo all
        buildNN();
        const layout = tree[state.linkage === "ward" ? "layout_ward" : "layout_upgma"];
        renderRows(layout.leaf_order);
        updateScore();
      });
    });
  }

  function rerender() {
    buildNN();
    const order = renderSpine();
    renderRows(order);
    updateScore();
  }

  // -------- bootstrap --------
  fetch("/species_tree")
    .then(r => r.json())
    .then(t => {
      tree = t;
      els.nSp.textContent  = tree.species.length;
      els.nSeq.textContent = tree.n_total_points.toLocaleString("en-US");
      bindToggles();
      rerender();
      // The SVG width depends on the laid-out grid → recompute on resize.
      const ro = new ResizeObserver(() => {
        const order = renderSpine();
        renderRows(order);  // re-bind row hover after rebuild
      });
      ro.observe(els.spine);
      // matchMedia covers the exact breakpoint transition where the
      // spine width may not actually change (e.g. desktop window shrunk
      // to 720px → still occupies the same column width but switches
      // role from "tree" to "tree + inline labels").
      const mq = window.matchMedia("(max-width: 720px)");
      const onMQ = () => { const order = renderSpine(); renderRows(order); };
      if (mq.addEventListener) mq.addEventListener("change", onMQ);
      else mq.addListener(onMQ); // Safari < 14 fallback
    })
    .catch(err => {
      els.info.textContent = "failed to load species tree: " + (err.message || err);
    });
})();

