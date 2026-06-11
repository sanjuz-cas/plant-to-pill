// =========================================================================
// §8, Training objective: CE vs FNS
// =========================================================================
(function initDemo8() {
  const targetPills = document.getElementById("d8-target-pills");
  const canvas      = document.getElementById("d8-canvas");

  let target = "TATATA";

  // Stable candidate set per target (target itself + near-misses + far-miss + unrelated)
  function candidatesFor(t) {
    // Generate near-misses: flip one base at each of a few positions
    const flip = (s, i, b) => s.slice(0,i) + b + s.slice(i+1);
    const t1 = flip(t, 5, t[5] === "A" ? "T" : "A");   // last base flipped
    const t2 = flip(flip(t, 4, t[4] === "A" ? "G" : "A"), 5, t[5] === "A" ? "G" : "A"); // 2 flipped
    const t3 = flip(flip(flip(t, 0, t[0] === "A" ? "C" : "A"), 2, t[2] === "T" ? "G" : "T"), 4, t[4] === "A" ? "C" : "A"); // 3 flipped
    const tFar = "CGCGCG";  // mostly different
    const candidates = [t, t1, t2, t3, tFar];
    return [...new Set(candidates)].slice(0, 5);
  }

  function nMatches(a, b) {
    let n = 0;
    for (let i = 0; i < 6; i++) if (a[i] === b[i]) n++;
    return n;
  }

  function ceCredit(c, t) {
    return c === t ? 1.0 : 0.0;  // all-or-nothing
  }
  function fnsCredit(c, t) {
    return nMatches(c, t) / 6.0;   // fraction of bases matching
  }

  function render() {
    const cands = candidatesFor(target);
    let html = "";
    html += `<div style="display:grid;grid-template-columns:140px 1fr 1fr;gap:8px 14px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:11px">`;
    // Header (always side-by-side: CE on the left, FNS on the right)
    html += `<div></div>`;
    html += `<div style="font-size:9px;color:#1f1f1d;text-transform:uppercase;letter-spacing:1.5px">cross-entropy</div>`;
    html += `<div style="font-size:9px;color:#1f1f1d;text-transform:uppercase;letter-spacing:1.5px">FNS</div>`;

    cands.forEach(c => {
      // Highlight matching positions in the candidate 6-mer.
      let badges = "";
      for (let i = 0; i < 6; i++) {
        const match = c[i] === target[i];
        const color = match ? "#317f3f" : "#bc2e25";
        const bg = match ? "rgba(49,127,63,0.10)" : "rgba(188,46,37,0.08)";
        badges += `<span style="display:inline-block;background:${bg};color:${color};padding:2px 5px;margin:1px;border-radius:2px;font-weight:${match?500:400}">${c[i]}</span>`;
      }
      const isExact = c === target;
      const labelText = isExact ? "exact target" : `${nMatches(c, target)}/6 match`;
      html += `<div style="display:flex;flex-direction:column;gap:2px">
        <div>${badges}</div>
        <div style="font-size:9px;color:${isExact?'#317f3f':'#888'};letter-spacing:1px;text-transform:uppercase;padding-left:4px">${labelText}</div>
      </div>`;

      // CE column (all-or-nothing credit).
      const ceVal = ceCredit(c, target);
      html += creditCell(ceVal, isExact ? "credit = 1" : "credit = 0");

      // FNS column (per-base partial credit).
      const fnsVal = fnsCredit(c, target);
      const fnsLabel = isExact ? "credit = 1" : `credit = ${fnsVal.toFixed(2)}  (${nMatches(c, target)}/6)`;
      html += creditCell(fnsVal, fnsLabel);
    });
    html += `</div>`;
    canvas.innerHTML = html;
  }

  function creditCell(value, label) {
    // value in [0, 1]; render as a horizontal bar.
    const w = (value * 100).toFixed(0);
    const barColor = value === 0 ? "#bc2e25" : (value < 1 ? "#888" : "#317f3f");
    return `<div>
      <div style="position:relative;height:10px;background:#f0f0f0;border-radius:2px;overflow:hidden">
        <div style="position:absolute;inset:0 auto 0 0;width:${w}%;background:${barColor}"></div>
      </div>
      <div style="font-size:9px;color:#888;margin-top:3px;letter-spacing:0.5px">${label}</div>
    </div>`;
  }

  // Bind
  targetPills.querySelectorAll(".pill").forEach(p => {
    p.addEventListener("click", () => {
      targetPills.querySelectorAll(".pill").forEach(x => x.classList.remove("active"));
      p.classList.add("active");
      target = p.dataset.target;
      render();
    });
  });
  render();
})();

