// =========================================================================
// §10, Architecture table
// =========================================================================
(function initDemo10() {
  const tbl = document.getElementById("d10-arch");
  const ROWS = [
    ["Layers",                    "30",      "32"],
    ["Hidden size",               "3,072",   "4,096"],
    ["FFN hidden size",           "8,448",   "14,336"],
    ["Attention heads",           "32",      "32"],
    ["KV groups (GQA)",           "4",       "8"],
    ["Head dim",                  "96",      "128"],
    ["Activation",                "SwiGLU",  "SwiGLU"],
    ["Normalization",             "RMSNorm", "RMSNorm"],
    ["Position encoding",         "RoPE (θ=500k)", "RoPE (θ=500k)"],
    ["Tied I/O embeddings",       "✓",       "✓"],
    ["Context length",            "8,192 tokens (≈49 kbp)", "8,192 tokens (≈49 kbp)"],
  ];
  let html = `<thead>
    <tr>
      <th style="text-align:left;padding:10px 6px 8px;border-bottom:1px solid #ddd;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1.5px;font-weight:400"></th>
      <th style="text-align:left;padding:10px 12px 8px;border-bottom:1px solid #ddd;font-size:11px;color:#1f1f1d;letter-spacing:1px">Carbon · 3B</th>
      <th style="text-align:left;padding:10px 12px 8px;border-bottom:1px solid #ddd;font-size:11px;color:#1f1f1d;letter-spacing:1px">Carbon · 8B</th>
    </tr>
  </thead><tbody>`;
  ROWS.forEach((r, i) => {
    const bg = i % 2 === 0 ? "#f7f5ee" : "#fff";
    html += `<tr style="background:${bg}">
      <td style="padding:6px;color:#666;font-size:10px;text-transform:uppercase;letter-spacing:1px">${r[0]}</td>
      <td style="padding:6px 12px;color:#1f1f1d">${r[1]}</td>
      <td style="padding:6px 12px;color:#1f1f1d">${r[2]}</td>
    </tr>`;
  });
  html += `</tbody>`;
  tbl.innerHTML = html;
})();

