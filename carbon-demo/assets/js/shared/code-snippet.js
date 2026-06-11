// code-snippet.js, wires up every .code-snippet on the page.
//
// Each snippet has tabs (Endpoint / Local) and a copy button. We listen on
// click for tab switching and copy-to-clipboard.
//
// Markup contract:
//   <details class="code-snippet">
//     <summary>Run this from code</summary>
//     <div class="code-snippet__body">
//       <div class="code-snippet__tabs">
//         <button class="code-snippet__tab active" data-tab="endpoint">…</button>
//         <button class="code-snippet__tab"        data-tab="local">…</button>
//       </div>
//       <button class="code-snippet__copy" type="button">Copy</button>
//       <div class="code-snippet__panel active" data-tab="endpoint"><pre><code>…</code></pre></div>
//       <div class="code-snippet__panel"        data-tab="local"><pre><code>…</code></pre></div>
//     </div>
//   </details>
(function () {
  function activate(snippet, name) {
    snippet.querySelectorAll(".code-snippet__tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    snippet.querySelectorAll(".code-snippet__panel").forEach(p => {
      p.classList.toggle("active", p.dataset.tab === name);
    });
  }

  // Run every <code> block through highlight.js. Every snippet in the demo
  // is Python, so we hard-tag the language rather than rely on autodetect
  // (which can mis-call short snippets). hljs is loaded via CDN with the
  // same `defer` attribute as this script, but in case CSP / network
  // blocks it we no-op gracefully and the snippets stay plain text.
  function highlight(snippet) {
    if (!window.hljs) return;
    snippet.querySelectorAll(".code-snippet__panel code").forEach(code => {
      if (code.dataset.highlighted) return;
      code.classList.add("language-python");
      try { window.hljs.highlightElement(code); } catch (e) { /* ignore */ }
      code.dataset.highlighted = "1";
    });
  }

  function wire(snippet) {
    snippet.querySelectorAll(".code-snippet__tab").forEach(tab => {
      tab.addEventListener("click", () => activate(snippet, tab.dataset.tab));
    });
    // Lift the copy button into the tabs strip if the markup still has it
    // as a sibling. Lets the strip's flex layout vertically centre it
    // against the tab pills instead of fighting absolute `top` pixels.
    const tabsRow = snippet.querySelector(".code-snippet__tabs");
    const copyBtn = snippet.querySelector(".code-snippet__copy");
    if (tabsRow && copyBtn && copyBtn.parentNode !== tabsRow) {
      tabsRow.appendChild(copyBtn);
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const panel = snippet.querySelector(".code-snippet__panel.active");
        if (!panel) return;
        const code = panel.querySelector("pre").textContent;
        try {
          await navigator.clipboard.writeText(code);
          copyBtn.textContent = "Copied";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.classList.remove("copied");
          }, 1500);
        } catch (e) { /* clipboard blocked; fail quietly */ }
      });
    }
    highlight(snippet);
  }

  function init() {
    document.querySelectorAll(".code-snippet").forEach(wire);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
