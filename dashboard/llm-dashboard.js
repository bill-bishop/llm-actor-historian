(function () {
  const fileInput = document.getElementById("fileInput");
  const chatList = document.getElementById("chatList");
  const detailPanel = document.getElementById("detailPanel");
  const promptDetail = document.getElementById("promptDetail");
  const completionDetail = document.getElementById("completionDetail");

  const summaryCallsEl = document.getElementById("summary-calls");
  const summaryModelsEl = document.getElementById("summary-models");
  const summaryTokensEl = document.getElementById("summary-tokens");
  const summaryAvgTokensEl = document.getElementById("summary-avg-tokens");
  const summaryErrorsRow = document.getElementById("summary-errors-row");

  const headerLogCount = document.getElementById("header-log-count");
  const headerTokenCount = document.getElementById("header-token-count");

  const tokenPromptCount = document.getElementById("token-prompt-count");
  const tokenCompletionCount = document.getElementById("token-completion-count");
  const tokenTotalCount = document.getElementById("token-total-count");
  const tokenPromptBar = document.getElementById("token-prompt-bar");
  const tokenCompletionBar = document.getElementById("token-completion-bar");
  const tokenTotalBar = document.getElementById("token-total-bar");

  const filescopeList = document.getElementById("filescopeList");
  const filescopeInput = document.getElementById("filescopeInput");
  const filescopeAddBtn = document.getElementById("filescopeAddBtn");

  /** @type {any[]} */
  let records = [];
  let selectedIndex = -1;

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
    renderChatList(records);
    clearSelection();
  });

  function renderSummary(records) {
    const total = records.length;
    headerLogCount.textContent = String(total);
    summaryCallsEl.textContent = String(total);

    if (!total) {
      summaryModelsEl.textContent = "0";
      summaryTokensEl.textContent = "0";
      summaryAvgTokensEl.textContent = "0";
      headerTokenCount.textContent = "0";
      summaryErrorsRow.innerHTML = "";
      return;
    }

    const models = new Set();
    let totalTokens = 0;
    let withUsage = 0;
    let errorCount = 0;

    for (const r of records) {
      if (r.model) models.add(r.model);
      if (r.errorMessage) errorCount++;
      if (r.usage && typeof r.usage.totalTokens === "number") {
        totalTokens += r.usage.totalTokens;
        withUsage++;
      }
    }

    const avgTokens = withUsage ? Math.round(totalTokens / withUsage) : 0;

    summaryModelsEl.textContent = String(models.size);
    summaryTokensEl.textContent = String(totalTokens);
    summaryAvgTokensEl.textContent = String(avgTokens);
    headerTokenCount.textContent = String(totalTokens);

    summaryErrorsRow.innerHTML = "";
    if (errorCount > 0) {
      const badge = document.createElement("span");
      badge.className = "badge error";
      badge.textContent = errorCount + " error" + (errorCount !== 1 ? "s" : "");
      summaryErrorsRow.appendChild(badge);
    } else {
      const badge = document.createElement("span");
      badge.className = "badge ok";
      badge.textContent = "0 errors";
      summaryErrorsRow.appendChild(badge);
    }

    // Model badges
    if (models.size) {
      for (const m of models) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = String(m);
        summaryErrorsRow.appendChild(badge);
      }
    }
  }

  function renderChatList(records) {
    chatList.innerHTML = "";
    if (!records.length) {
      const p = document.createElement("p");
      p.className = "small muted";
      p.style.margin = "0.4rem 0 0";
      p.textContent = "No logs loaded yet. Select one or more llm-*.jsonl files.";
      chatList.appendChild(p);
      return;
    }

    const sorted = [...records].sort((a, b) => {
      const ta = Date.parse(a.timestamp || "") || 0;
      const tb = Date.parse(b.timestamp || "") || 0;
      return ta - tb;
    });

    sorted.forEach((r, idx) => {
      const tr = document.createElement("div");
      tr.className = "chat-item";
      tr.dataset.index = String(idx);

      const timeStr = r.timestamp
        ? new Date(r.timestamp).toLocaleTimeString()
        : "";

      const tokens =
        r.usage && typeof r.usage.totalTokens === "number"
          ? String(r.usage.totalTokens)
          : "–";

      const model = r.model || "";
      const adapterName = r.adapterName || "adapter";

      const promptPreview = (r.prompt || "")
        .slice(0, 90)
        .replace(/\s+/g, " ");
      const completionPreview = (r.completion || "")
        .slice(0, 90)
        .replace(/\s+/g, " ");

      tr.innerHTML = `
        <div class="chat-item-header">
          <div class="chat-item-meta">
            <span class="time">${escapeHtml(timeStr)}</span>
            <span>·</span>
            <span class="model mono">${escapeHtml(model)}</span>
            <span>·</span>
            <span class="mono">${escapeHtml(adapterName)}</span>
          </div>
          <div class="chat-item-tokens mono">
            tokens: ${escapeHtml(tokens)}
          </div>
        </div>
        <div class="chat-item-content">
          <div class="chat-bubble">
            <div class="chat-bubble-label">Prompt</div>
            <div>${escapeHtml(promptPreview)}</div>
          </div>
          <div class="chat-bubble">
            <div class="chat-bubble-label">Completion</div>
            <div>${escapeHtml(completionPreview)}</div>
          </div>
        </div>
        <div class="chat-footer">
          <span class="small muted">
            Click to inspect full text
          </span>
          ${
            r.errorMessage
              ? `<span class="badge error small">error</span>`
              : ""
          }
        </div>
      `;

      tr.addEventListener("click", () => {
        selectRecord(sorted, idx);
      });

      chatList.appendChild(tr);
    });
  }

  function clearSelection() {
    selectedIndex = -1;
    detailPanel.style.display = "none";
    updateTokenBars(null);
  }

  function selectRecord(sortedRecords, idx) {
    selectedIndex = idx;
    const r = sortedRecords[idx];

    // Highlight selection
    const items = chatList.querySelectorAll(".chat-item");
    items.forEach((el) => el.classList.remove("selected"));
    const selectedEl = chatList.querySelector(
      '.chat-item[data-index="' + idx + '"]'
    );
    if (selectedEl) {
      selectedEl.classList.add("selected");
    }

    promptDetail.value = r.prompt || "";
    completionDetail.value = r.completion || "";
    detailPanel.style.display = "grid";

    updateTokenBars(r);
  }

  function updateTokenBars(record) {
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    if (record && record.usage) {
      if (typeof record.usage.promptTokens === "number") {
        promptTokens = record.usage.promptTokens;
      }
      if (typeof record.usage.completionTokens === "number") {
        completionTokens = record.usage.completionTokens;
      }
      if (typeof record.usage.totalTokens === "number") {
        totalTokens = record.usage.totalTokens;
      } else {
        totalTokens = promptTokens + completionTokens;
      }
    }

    tokenPromptCount.textContent = String(promptTokens);
    tokenCompletionCount.textContent = String(completionTokens);
    tokenTotalCount.textContent = String(totalTokens);

    const max = Math.max(promptTokens, completionTokens, totalTokens, 1);
    tokenPromptBar.style.width = (promptTokens / max) * 100 + "%";
    tokenCompletionBar.style.width = (completionTokens / max) * 100 + "%";
    tokenTotalBar.style.width = (totalTokens / max) * 100 + "%";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Simple "files in scope" manual checklist
  const files = new Set();

  function renderFilescope() {
    filescopeList.innerHTML = "";
    if (!files.size) {
      const p = document.createElement("p");
      p.className = "small muted";
      p.style.margin = "0";
      p.textContent =
        "No files added yet. Use this checklist to mirror files-in-scope for your current session.";
      filescopeList.appendChild(p);
      return;
    }
    for (const path of files) {
      const item = document.createElement("div");
      item.className = "filescope-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      const span = document.createElement("span");
      span.className = "path mono";
      span.textContent = path;
      item.appendChild(checkbox);
      item.appendChild(span);
      filescopeList.appendChild(item);
    }
  }

  filescopeAddBtn.addEventListener("click", () => {
    const value = (filescopeInput.value || "").trim();
    if (!value) return;
    files.add(value);
    filescopeInput.value = "";
    renderFilescope();
  });

  filescopeInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      filescopeAddBtn.click();
    }
  });

  renderFilescope();
})();