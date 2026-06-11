// =========================================================================
// Shared helpers
// =========================================================================
const DARK_RGB = [31, 31, 29];
const MID_RGB  = [136, 136, 136];
const RED_RGB  = [188, 46, 37];
const PROMPT_RGB = [170, 170, 170];

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function lerpRgb(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function logprobRgb(lp, range) {
  if (lp == null || isNaN(lp) || !range) return DARK_RGB;
  const { min, mid, max } = range;
  if (max === min) return MID_RGB;
  if (lp >= mid) {
    const denom = max - mid;
    const t = denom > 0 ? Math.min(1, Math.max(0, (max - lp) / denom)) : 0;
    return lerpRgb(DARK_RGB, MID_RGB, t);
  }
  const denom = mid - min;
  const t = denom > 0 ? Math.min(1, Math.max(0, (mid - lp) / denom)) : 0;
  return lerpRgb(MID_RGB, RED_RGB, t);
}
function lpRangeOf(tokens) {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const t of tokens) {
    const lp = t.logprob;
    if (lp == null || isNaN(lp)) continue;
    if (lp < min) min = lp;
    if (lp > max) max = lp;
    sum += lp; n++;
  }
  return n ? { min, mid: sum / n, max } : null;
}
function meanLogprob(tokens) {
  const r = lpRangeOf(tokens);
  return r ? r.mid : null;
}

// Render a sequence line-by-line with optional per-base coloring fn `colorAt(absIdx, base)`.
// 10-bp blocks separated by 2 spaces, position number prefix.
function renderSeq(el, seq, basesPerLine, colorAt) {
  if (!seq) {
    el.classList.add("empty");
    el.textContent = "·";
    return;
  }
  el.classList.remove("empty");
  const parts = [];
  for (let i = 0; i < seq.length; i += basesPerLine) {
    const lineSeq = seq.slice(i, i + basesPerLine);
    const pos = String(i + 1).padStart(5, " ");
    let html = `<span class="pos">${pos}</span>  `;
    let j = 0;
    while (j < lineSeq.length) {
      if (j > 0 && j % 10 === 0) html += " ";
      const absIdx = i + j;
      const c = colorAt(absIdx, lineSeq[j]);
      // Group identical-style runs within the 10-base block.
      const blockEnd = Math.min(lineSeq.length, Math.floor(j / 10) * 10 + 10);
      let runEnd = j + 1;
      while (runEnd < blockEnd) {
        const cn = colorAt(i + runEnd, lineSeq[runEnd]);
        if (cn.style !== c.style) break;
        runEnd++;
      }
      html += `<span style="${c.style}">${lineSeq.slice(j, runEnd)}</span>`;
      j = runEnd;
    }
    parts.push(`<div>${html}</div>`);
  }
  el.innerHTML = parts.join("");
}
