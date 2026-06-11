// =========================================================================
// Sandbox (tab 3), DNA continuation playground
// =========================================================================
(function initSandbox() {
  const els = {
    prompt: document.getElementById("sb-prompt"),
    maxTokens: document.getElementById("sb-max-tokens"),
    temperature: document.getElementById("sb-temperature"),
    topP: document.getElementById("sb-top-p"),
    generate: document.getElementById("sb-generate-btn"),
    stop: document.getElementById("sb-stop-btn"),
    clear: document.getElementById("sb-clear-btn"),
    modeBtns: document.getElementById("sb-mode-btns"),
    copy: document.getElementById("sb-copy-btn"),
    seq: document.getElementById("sb-seq"),
    meta: document.getElementById("sb-meta"),
    status: document.getElementById("sb-status"),
    statusText: document.getElementById("sb-status-text"),
    legend: document.getElementById("sb-legend"),
    statPrompt: document.getElementById("sb-stat-prompt"),
    statGen: document.getElementById("sb-stat-gen"),
    statTok: document.getElementById("sb-stat-tok"),
    statTime: document.getElementById("sb-stat-time"),
    statRate: document.getElementById("sb-stat-rate"),
    statGc: document.getElementById("sb-stat-gc"),
    statLp: document.getElementById("sb-stat-lp"),
    statPpl: document.getElementById("sb-stat-ppl"),
  };

  const BASE_RGB = {
    A: [58, 138, 62], C: [46, 107, 184], G: [181, 137, 30], T: [181, 58, 58], N: [136, 136, 136],
  };
  const PROMPT_RGB_S = [170, 170, 170];
  const DARK_RGB_S = [31, 31, 29];
  const MID_RGB_S  = [136, 136, 136];
  const RED_RGB_S  = [188, 46, 37];
  const BG_ALPHA = 0.12;

  let promptBases = "";
  let genText = "";
  let genTokens = [];
  let genTokenAtBase = [];
  let abortCtrl = null;
  let startTime = 0;
  let timer = null;
  let colorMode = "none";
  let charMetrics = null;
  let lpRange = null;

  function recomputeLpRange() {
    if (!genTokens.length) { lpRange = null; updateLegend(); return; }
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (const t of genTokens) {
      if (t.logprob == null || isNaN(t.logprob)) continue;
      if (t.logprob < min) min = t.logprob;
      if (t.logprob > max) max = t.logprob;
      sum += t.logprob; n++;
    }
    lpRange = n ? { min, mid: sum / n, max } : null;
    updateLegend();
  }
  function updateLegend() {
    const minEl = document.getElementById("sb-lp-min");
    const midEl = document.getElementById("sb-lp-mid");
    const maxEl = document.getElementById("sb-lp-max");
    const bar   = document.getElementById("sb-legend-bar");
    if (!lpRange) {
      minEl.textContent = midEl.textContent = maxEl.textContent = "·";
      bar.style.background = "linear-gradient(to right, #bc2e25, #888, #1f1f1d)";
    } else {
      const { min, mid, max } = lpRange;
      minEl.textContent = min.toFixed(1);
      midEl.textContent = mid.toFixed(1);
      maxEl.textContent = max.toFixed(1);
      const midPct = max > min ? ((mid - min) / (max - min)) * 100 : 50;
      bar.style.background = `linear-gradient(to right, #bc2e25 0%, #888 ${midPct.toFixed(1)}%, #1f1f1d 100%)`;
    }
    updateLpChart();
  }
  function updateLpChart() {
    const svg = document.getElementById("sb-lp-chart");
    if (!svg) return;
    if (!lpRange || genTokens.length < 2) { svg.innerHTML = ""; return; }
    const W = 200, H = 40, pad = 2;
    const { min, max } = lpRange;
    const yTop = pad, yBot = H - pad;
    const yScale = (lp) => yTop + (1 - (lp - min) / Math.max(1e-9, max - min)) * (yBot - yTop);
    const n = genTokens.length;
    const target = 1000;
    let step = 1;
    while (Math.ceil(n / step) > target) step *= 2;
    const xScale = (i) => (n === 1 ? W / 2 : pad + (i / (n - 1)) * (W - 2 * pad));
    let d = "";
    let started = false;
    for (let i = 0; i < n; i += step) {
      const lp = genTokens[i].logprob;
      if (lp == null || isNaN(lp)) continue;
      d += (started ? "L" : "M") + xScale(i).toFixed(1) + " " + yScale(lp).toFixed(1);
      started = true;
    }
    if ((n - 1) % step !== 0) {
      const lp = genTokens[n - 1].logprob;
      if (lp != null && !isNaN(lp)) {
        d += "L" + xScale(n - 1).toFixed(1) + " " + yScale(lp).toFixed(1);
      }
    }
    const midPct = max > min ? ((lpRange.mid - min) / (max - min)) * 100 : 50;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="sb-lp-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${H - pad}" x2="0" y2="${pad}">
          <stop offset="0%" stop-color="#bc2e25"/>
          <stop offset="${midPct.toFixed(1)}%" stop-color="#888"/>
          <stop offset="100%" stop-color="#1f1f1d"/>
        </linearGradient>
      </defs>
      <path d="${d}" fill="none" stroke="url(#sb-lp-grad)" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>
    `;
  }
  function logprobRgbSb(lp) {
    if (lp == null || isNaN(lp) || !lpRange) return DARK_RGB_S;
    const { min, mid, max } = lpRange;
    if (max === min) return MID_RGB_S;
    if (lp >= mid) {
      const denom = max - mid;
      const t = denom > 0 ? Math.min(1, Math.max(0, (max - lp) / denom)) : 0;
      return lerpRgb(DARK_RGB_S, MID_RGB_S, t);
    }
    const denom = mid - min;
    const t = denom > 0 ? Math.min(1, Math.max(0, (mid - lp) / denom)) : 0;
    return lerpRgb(MID_RGB_S, RED_RGB_S, t);
  }

  function autoGrow() {
    els.prompt.style.height = "auto";
    els.prompt.style.height = els.prompt.scrollHeight + "px";
  }
  function cleanPrompt(s) { return s.toUpperCase().replace(/[^ACGTN]/g, ""); }

  els.prompt.addEventListener("input", () => {
    const cleaned = cleanPrompt(els.prompt.value);
    if (cleaned !== els.prompt.value) {
      const pos = els.prompt.selectionStart;
      els.prompt.value = cleaned;
      els.prompt.setSelectionRange(pos, pos);
    }
    autoGrow();
  });

  function rgbForBase(absIdx, base) {
    if (absIdx < promptBases.length) return PROMPT_RGB_S;
    if (colorMode === "bases") return BASE_RGB[base] || DARK_RGB_S;
    if (colorMode === "logprob") {
      const genIdx = absIdx - promptBases.length;
      const tok = genTokens[genTokenAtBase[genIdx]];
      return tok ? logprobRgbSb(tok.logprob) : DARK_RGB_S;
    }
    return DARK_RGB_S;
  }
  function measureSeqChars() {
    // Measure inside the actual seq block so the probe inherits the same
    // font, size, weight, letter-spacing, font-feature-settings and any
    // ancestor-driven context. Earlier this lived on document.body with
    // hand-mirrored font styles, but that drifted from the real rendering
    // context (font fallback while the web font was still loading, or any
    // future style change on .sb-seq-block) and the resulting blockW was
    // narrower than reality → bpl overshot → lines overflowed.
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;top:-9999px;left:-9999px;white-space:pre;pointer-events:none";
    probe.textContent = "    1  ";
    els.seq.appendChild(probe);
    const prefixW = probe.getBoundingClientRect().width;
    probe.textContent = "AAAAAAAAAA  ";
    const blockW = probe.getBoundingClientRect().width;
    els.seq.removeChild(probe);
    charMetrics = { prefixW, blockW };
  }
  function basesPerLineSb() {
    if (!charMetrics) measureSeqChars();
    const cs = getComputedStyle(els.seq);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const contentW = els.seq.clientWidth - padL - padR;
    if (contentW <= 0 || !charMetrics.blockW) return 60;
    const blocks = Math.floor((contentW - charMetrics.prefixW) / charMetrics.blockW);
    return Math.max(10, Math.min(blocks, 30) * 10);
  }
  function colorKey(absIdx, base) {
    if (absIdx < promptBases.length) return "p";
    if (colorMode === "none") return "g";
    if (colorMode === "bases") return "b" + base;
    if (colorMode === "logprob") return "t" + genTokenAtBase[absIdx - promptBases.length];
    return "g";
  }
  function buildLineHTML(start, lineBases) {
    const pos = String(start + 1).padStart(5, " ");
    let html = `<span class="sb-pos">${pos}</span>  `;
    let j = 0;
    while (j < lineBases.length) {
      if (j > 0 && j % 10 === 0) html += "  ";
      const startAbs = start + j;
      const startKey = colorKey(startAbs, lineBases[j]);
      const blockEnd = Math.min(lineBases.length, Math.floor(j / 10) * 10 + 10);
      let runEnd = j + 1;
      while (runEnd < blockEnd && colorKey(start + runEnd, lineBases[runEnd]) === startKey) runEnd++;
      const runText = lineBases.slice(j, runEnd);
      const [r, g, b] = rgbForBase(startAbs, lineBases[j]);
      const tinted = colorMode !== "none" && startAbs >= promptBases.length;
      const bg = tinted ? `;background:rgba(${r},${g},${b},${BG_ALPHA})` : "";
      html += `<span style="color:rgb(${r},${g},${b})${bg}">${runText}</span>`;
      j = runEnd;
    }
    return html;
  }
  function updateTail() {
    const prev = els.seq.querySelector(".sb-seq-line.tail");
    if (prev) prev.classList.remove("tail");
    const last = els.seq.lastElementChild;
    if (abortCtrl && last && last.classList.contains("sb-seq-line")) last.classList.add("tail");
  }
  function lpRangeShifted(prev, curr) {
    if (!prev || !curr) return prev !== curr;
    const range = Math.max(0.1, prev.max - prev.min);
    const tol = Math.max(0.2, range * 0.05);
    return Math.abs(prev.min - curr.min) > tol
        || Math.abs(prev.mid - curr.mid) > tol
        || Math.abs(prev.max - curr.max) > tol;
  }
  let lastRenderedMode = null;
  let lastRenderedBpl = null;
  let lastRenderedLpRange = null;
  function fullRender(bpl) {
    const total = promptBases + genText;
    if (!total) {
      els.seq.classList.add("empty");
      els.seq.textContent = "prompt + generated bases will stream here";
    } else {
      els.seq.classList.remove("empty");
      const parts = [];
      for (let i = 0; i < total.length; i += bpl) {
        parts.push(`<div class="sb-seq-line">${buildLineHTML(i, total.slice(i, i + bpl))}</div>`);
      }
      els.seq.innerHTML = parts.join("");
    }
    lastRenderedMode = colorMode;
    lastRenderedBpl = bpl;
    lastRenderedLpRange = lpRange ? { ...lpRange } : null;
    updateTail();
  }
  function incrementalRender(bpl) {
    const total = promptBases + genText;
    // Transition out of the empty-placeholder state: when generation
    // kicks in straight from the idle placeholder, renderSequence() picks
    // the incremental path (no mode/bpl change, totalLines >= renderedLines),
    // so we never go through fullRender(). Without this guard the `.empty`
    // class (display:flex + align-items:center) stays applied and the
    // placeholder text node lingers next to the new <div class="sb-seq-line">
    // children, which makes every line render as a flex-row item, all on a
    // single overflowing horizontal line instead of a normal stack.
    if (els.seq.classList.contains("empty")) {
      els.seq.classList.remove("empty");
      els.seq.textContent = "";
    }
    const totalLines = Math.ceil(total.length / bpl);
    const lineDivs = els.seq.children;
    if (lineDivs.length > 0) {
      const lastIdx = lineDivs.length - 1;
      const start = lastIdx * bpl;
      lineDivs[lastIdx].innerHTML = buildLineHTML(start, total.slice(start, start + bpl));
    }
    if (totalLines > lineDivs.length) {
      const parts = [];
      for (let li = lineDivs.length; li < totalLines; li++) {
        const start = li * bpl;
        parts.push(`<div class="sb-seq-line">${buildLineHTML(start, total.slice(start, start + bpl))}</div>`);
      }
      els.seq.insertAdjacentHTML("beforeend", parts.join(""));
    }
    lastRenderedLpRange = lpRange ? { ...lpRange } : null;
    updateTail();
  }
  function renderSequence() {
    if (colorMode === "logprob") recomputeLpRange();
    const total = promptBases + genText;
    els.copy.disabled = total.length === 0;
    let bpl = basesPerLineSb();
    const totalLines = total ? Math.ceil(total.length / bpl) : 0;
    const renderedLines = els.seq.children.length;
    const needFull =
      !total ||
      lastRenderedMode !== colorMode ||
      lastRenderedBpl !== bpl ||
      totalLines < renderedLines ||
      (colorMode === "logprob" && lpRangeShifted(lastRenderedLpRange, lpRange));
    if (needFull) fullRender(bpl);
    else incrementalRender(bpl);
    // Self-correct: the probe-based bpl can overshoot when the web font
    // wasn't loaded yet at measure-time (the fallback monospace is
    // narrower than JetBrains Mono → blockW too small → bpl too large).
    // Measure the actual rendered first line, scale bpl down proportionally
    // until it fits, then back-solve charMetrics so future renders converge
    // on the right value without the loop.
    if (total) {
      const cs = getComputedStyle(els.seq);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const fit = els.seq.clientWidth - padL - padR;
      let safety = 3;
      while (safety-- > 0 && fit > 0) {
        const first = els.seq.firstElementChild;
        if (!first || first.scrollWidth <= fit + 2) break;
        if (bpl <= 10) break;
        // Proportional shrink so we converge in 1-2 iterations even when
        // the probe was off by 2x (font fallback case).
        const ratio = fit / first.scrollWidth;
        const next = Math.max(10, Math.floor((bpl * ratio) / 10) * 10);
        if (next >= bpl) break;
        bpl = next;
        fullRender(bpl);
      }
      const first = els.seq.firstElementChild;
      if (first && fit > 0 && bpl >= 10) {
        // Back-solve charMetrics from the rendered first line so the next
        // basesPerLineSb call lands at this bpl without retriggering the loop.
        const renderedW = first.getBoundingClientRect().width;
        const usedBlocks = bpl / 10;
        const assumedPrefix = (charMetrics && charMetrics.prefixW) || 65;
        const recoveredBlockW = (renderedW - assumedPrefix) / usedBlocks;
        if (recoveredBlockW > 0 && isFinite(recoveredBlockW)) {
          charMetrics = { prefixW: assumedPrefix, blockW: recoveredBlockW };
        }
      }
    }
  }
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderSequence(); });
  }
  function gcContent(s) {
    if (!s) return null;
    let gc = 0;
    for (const c of s) if (c === "G" || c === "C") gc++;
    return (gc / s.length) * 100;
  }
  function meanLpSb() {
    if (!genTokens.length) return null;
    let sum = 0, n = 0;
    for (const t of genTokens) {
      if (t.logprob != null && !isNaN(t.logprob)) { sum += t.logprob; n++; }
    }
    return n ? sum / n : null;
  }
  function updateStats() {
    els.statPrompt.innerHTML = `${promptBases.length}<span class="sb-unit">bp</span>`;
    els.statGen.innerHTML = `${genText.length}<span class="sb-unit">bp</span>`;
    els.statTok.textContent = genTokens.length;
    const elapsed = startTime ? (performance.now() - startTime) / 1000 : 0;
    els.statTime.innerHTML = `${elapsed.toFixed(1)}<span class="sb-unit">s</span>`;
    const rate = elapsed > 0 ? Math.round(genText.length / elapsed) : 0;
    els.statRate.innerHTML = `${rate}<span class="sb-unit">bp/s</span>`;
    const gc = gcContent(genText);
    els.statGc.textContent = gc == null ? "·" : `${gc.toFixed(1)}%`;
    const mlp = meanLpSb();
    els.statLp.textContent = mlp == null ? "·" : mlp.toFixed(2);
    els.statPpl.textContent = mlp == null ? "·" : Math.exp(-mlp).toFixed(1);
  }
  function setStatus(text, mode = "") {
    els.statusText.textContent = text;
    // Hide the pill outright in the idle/empty state, same "no idle UI"
    // pattern used by the other demos in §1–§5. The pill comes back as
    // soon as setStatus is called with a meaningful state ("connecting…",
    // "streaming", "done", an error message, etc.).
    const hide = !text || text === "idle";
    els.status.className = "sb-status" + (mode ? " " + mode : "") + (hide ? " is-hidden" : "");
  }

  els.modeBtns.querySelectorAll(".sb-mode-btn").forEach(b => {
    b.addEventListener("click", () => {
      colorMode = b.dataset.mode;
      els.modeBtns.querySelectorAll(".sb-mode-btn").forEach(x => x.classList.toggle("active", x === b));
      els.legend.classList.toggle("show", colorMode === "logprob");
      renderSequence();
    });
  });

  async function generate() {
    if (abortCtrl) return;
    promptBases = cleanPrompt(els.prompt.value);
    genText = "";
    genTokens = [];
    genTokenAtBase = [];
    startTime = performance.now();
    abortCtrl = new AbortController();
    els.generate.disabled = true;
    els.stop.disabled = false;
    setStatus("connecting…", "streaming");
    renderSequence();
    updateStats();
    timer = setInterval(updateStats, 100);
    const body = {
      prompt: promptBases,
      max_tokens: parseInt(els.maxTokens.value),
      temperature: parseFloat(els.temperature.value),
      top_p: parseFloat(els.topP.value),
    };
    try {
      const resp = await fetch("/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      setStatus("streaming", "streaming");
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
              const tokIdx = genTokens.length;
              genTokens.push({
                text: lp.tokens[i],
                logprob: lp.token_logprobs[i],
                top: lp.top_logprobs[i],
              });
              for (let j = 0; j < lp.tokens[i].length; j++) genTokenAtBase.push(tokIdx);
            }
          }
          if (data.text) {
            genText += cleanPrompt(data.text);
            scheduleRender();
          }
        }
      }
      setStatus("done");
    } catch (e) {
      if (e.name === "AbortError") setStatus("stopped");
      else setStatus(e.message, "error");
    } finally {
      abortCtrl = null;
      clearInterval(timer);
      updateStats();
      renderSequence();
      els.generate.disabled = false;
      els.stop.disabled = true;
    }
  }
  function stop() { if (abortCtrl) abortCtrl.abort(); }
  function clearAll() {
    if (abortCtrl) return;
    promptBases = "";
    genText = "";
    genTokens = [];
    genTokenAtBase = [];
    startTime = 0;
    renderSequence();
    updateStats();
    setStatus("idle");
  }
  els.generate.addEventListener("click", generate);
  els.stop.addEventListener("click", stop);
  els.clear.addEventListener("click", clearAll);
  els.copy.addEventListener("click", async () => {
    const text = promptBases + genText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      els.copy.classList.add("copied");
      els.copy.textContent = "copied";
    } catch {
      els.copy.textContent = "failed";
    }
    setTimeout(() => {
      els.copy.classList.remove("copied");
      els.copy.textContent = "copy";
    }, 1200);
  });
  els.prompt.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });
  document.querySelectorAll("#panel-sandbox .sb-ex-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      els.prompt.value = btn.dataset.ex;
      autoGrow();
      els.prompt.focus();
    });
  });
  // Init meta from /config (fires regardless of which tab is active).
  // Reuses the shared promise from fetchConfig(), no double network roundtrip.
  fetchConfig().then(cfg => {
    els.meta.textContent = cfg.model;
  }).catch(() => { els.meta.textContent = "config unavailable"; });

  updateStats();
  autoGrow();

  let roPending = false;
  const ro = new ResizeObserver(() => {
    if (roPending) return;
    roPending = true;
    requestAnimationFrame(() => { roPending = false; renderSequence(); });
  });
  ro.observe(els.seq);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { charMetrics = null; renderSequence(); });
  }
  // First time the sandbox panel is shown (or any time we come back to
  // it), the seq block may have been laid out at display:none, leaving
  // basesPerLineSb with a stale measurement (clientWidth = 0 → bpl
  // fallback, or font-not-yet-loaded probe → blockW too small → bpl too
  // large → overflow). Drop charMetrics and re-render once the panel is
  // actually visible, after the browser has had a frame to paint it.
  window.addEventListener("tab:changed", e => {
    if (e.detail?.name !== "sandbox") return;
    requestAnimationFrame(() => { charMetrics = null; renderSequence(); });
  });
})();

