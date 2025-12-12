(function () {
  const fileInput = document.getElementById("fileInput");
  const summaryEl = document.getElementById("summary");
  const tableBody = document.querySelector("#logsTable tbody");
  const detailEl = document.getElementById("detail");
  const promptDetail = document.getElementById("promptDetail");
  const completionDetail = document.getElementById("completionDetail");

  let records = [];

  fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    records = [];
    for (const file of files) {
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          records.push(obj);
        } catch (e) {
          console.warn("Failed to parse log line", e, line);
        }
      }
    }

    renderSummary(records);
    renderTable(records);
  });

  function renderSummary(records) {
    if (!records.length) {
      summaryEl.style.display = "none";
      return;
    }
    const total = records.length;
    const models = new Set();
    let totalTokens = 0;
    let withUsage = 0;

    for (const r of records) {
      if (r.model) models.add(r.model);
      if (r.usage && typeof r.usage.totalTokens === "number") {
        totalTokens += r.usage.totalTokens;
        withUsage++;
      }
    }

    const avgTokens = withUsage ? Math.round(totalTokens / withUsage) : 0;

    summaryEl.innerHTML = `
      <div><strong>${total}</strong> calls loaded · <strong>${models.size}</strong> models</div>
      <div class="muted small">
        Tokens (where reported): total <strong>${totalTokens}</strong>,
        avg <strong>${avgTokens}</strong> per call
      </div>
    `;
    summaryEl.style.display = "block";
  }

  function renderTable(records) {
    tableBody.innerHTML = "";
    if (!records.length) return;

    const sorted = [...records].sort((a, b) => {
      const ta = Date.parse(a.timestamp || "") || 0;
      const tb = Date.parse(b.timestamp || "") || 0;
      return ta - tb;
    });

    sorted.forEach((r) => {
      const tr = document.createElement("tr");

      const timeStr = r.timestamp
        ? new Date(r.timestamp).toLocaleTimeString()
        : "";

      const tokens =
        r.usage && typeof r.usage.totalTokens === "number"
          ? String(r.usage.totalTokens)
          : "–";

      const promptPreview = (r.prompt || "").slice(0, 80).replace(/\s+/g, " ");
      const completionPreview = (r.completion || "")
        .slice(0, 80)
        .replace(/\s+/g, " ");

      tr.innerHTML = `
        <td class="nowrap small">${timeStr}</td>
        <td class="small">
          <span class="badge ${
            r.errorMessage ? "error" : "ok"
          }">${escapeHtml(r.adapterName || "adapter")}</span>
        </td>
        <td class="small ellipsis">${escapeHtml(r.model || "")}</td>
        <td class="small nowrap">${tokens}</td>
        <td class="small ellipsis" title="${escapeHtml(
          r.prompt || ""
        )}">${escapeHtml(promptPreview)}</td>
        <td class="small ellipsis" title="${escapeHtml(
          r.completion || ""
        )}">${escapeHtml(completionPreview)}</td>
      `;

      tr.addEventListener("click", () => {
        promptDetail.value = r.prompt || "";
        completionDetail.value = r.completion || "";
        detailEl.style.display = "grid";
      });

      tableBody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();