// =========================================================================
// Tab switching + hash routing
// =========================================================================
(function initTabs() {
  const TABS = ["intro", "dna-lab", "recipe", "sandbox"];
  // What we land on when the URL has no hash. Also the safety fallback
  // when setTab is called with an unrecognised tab name.
  const DEFAULT_TAB = "intro";
  // Wire BOTH the in-banner nav (#tab-nav) and the sticky-on-scroll copy
  // (#tab-nav-sticky). Same data-tab values → setTab() syncs active state
  // across both NodeLists in one shot, and click on either invokes setTab.
  const tabButtons = document.querySelectorAll("#tab-nav .tab, #tab-nav-sticky .tab");
  const panels = document.querySelectorAll(".tab-panel");

  function setTab(name, opts = {}) {
    if (!TABS.includes(name)) name = DEFAULT_TAB;
    document.body.dataset.tab = name;
    tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    panels.forEach(p => p.classList.toggle("active", p.dataset.tab === name));
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: opts.smooth ? "smooth" : "auto" });
    if (opts.updateHash !== false) {
      // Preserve any anchor inside the tab if requested
      if (opts.anchor) location.hash = opts.anchor;
      else if (location.hash.replace("#", "") !== name) location.hash = name;
    }
    // Inform tab modules that own layout-measured DOM (e.g. sandbox's
    // bases-per-line calc, which depends on the seq block's clientWidth)
    // that they should re-measure on the next frame, after the new panel
    // has actually been laid out at display:block. Without this, a panel
    // that was first measured while hidden (clientWidth = 0, or before
    // its web font loaded) keeps stale metrics until the user nudges it.
    window.dispatchEvent(new CustomEvent("tab:changed", { detail: { name } }));
  }
  // Exposed so the §0 intro-guide cards (in sections/intro.js) can jump tabs.
  window.setTab = setTab;

  // Map a section anchor → which tab contains it
  const SECTION_TO_TAB = {
    primer: "intro",
    completion: "dna-lab", vep: "dna-lab", track: "dna-lab", species: "dna-lab", folding: "dna-lab", umap: "dna-lab",
    tokenizer: "recipe", loss: "recipe", data: "recipe", architecture: "recipe", longcontext: "recipe", results: "recipe", efficiency: "recipe",
    sandbox: "sandbox",
  };

  function applyHash() {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) { setTab(DEFAULT_TAB, { updateHash: false }); return; }
    if (TABS.includes(hash)) { setTab(hash, { updateHash: false }); return; }
    if (SECTION_TO_TAB[hash]) {
      setTab(SECTION_TO_TAB[hash], { updateHash: false, scroll: false });
      // Defer scroll until panel is visible
      requestAnimationFrame(() => {
        const el = document.getElementById(hash);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    setTab(DEFAULT_TAB, { updateHash: false });
  }

  tabButtons.forEach(b => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  });
  window.addEventListener("hashchange", applyHash);
  applyHash();

  // Sticky tab strip: when the in-banner #tab-nav scrolls out of view,
  // toggle .is-tabs-stuck on <body> to slide the duplicate strip down from
  // the top of the viewport. Uses the in-banner nav itself as the sentinel
  // no extra DOM element needed, and IntersectionObserver so the toggle
  // costs nothing on scroll (no scroll listener / no layout reads).
  const inBannerNav = document.getElementById("tab-nav");
  if (inBannerNav && "IntersectionObserver" in window) {
    const obs = new IntersectionObserver(([entry]) => {
      document.body.classList.toggle("is-tabs-stuck", !entry.isIntersecting);
    }, { threshold: 0 });
    obs.observe(inBannerNav);
  }
})();

loadConfig();
