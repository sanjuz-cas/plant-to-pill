// =========================================================================
// Init: config + load gene catalog (used by §1, §3)
// =========================================================================
// Memoize the *promise* (not the value) so concurrent callers share one fetch.
// The previous "if (GENES) return GENES" pattern was racy: two callers firing
// before the first response landed both triggered a network request.
let CONFIG_PROMISE = null;
function fetchConfig() {
  if (!CONFIG_PROMISE) {
    CONFIG_PROMISE = fetch("/config").then(r => r.json());
  }
  return CONFIG_PROMISE;
}
async function loadConfig() {
  try {
    const cfg = await fetchConfig();
    document.getElementById("meta").textContent = cfg.model;
  } catch {
    document.getElementById("meta").textContent = "config unavailable";
  }
}

// Keep the resolved value on the global `GENES` for downstream code that
// reaches into it synchronously inside loadGenes().then() callbacks.
let GENES = null;
let GENES_PROMISE = null;
function loadGenes() {
  if (!GENES_PROMISE) {
    GENES_PROMISE = fetch("/genes").then(r => r.json()).then(g => { GENES = g; return g; });
  }
  return GENES_PROMISE;
}

// Filter the gene catalog down to those declared as belonging to a given
// section ("completion" / "track" / "folding"). Genes that don't ship a
// `sections` field are visible everywhere (legacy behaviour); genes that
// do are scoped to the named sections only. Lets §5 swap in a "Carbon
// works well here" showcase set without polluting §1 / §3, and vice-versa.
function genesForSection(genes, name) {
  return genes.filter(g => !g.sections || g.sections.includes(name));
}
