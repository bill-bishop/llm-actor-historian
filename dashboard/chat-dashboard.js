(function () {
  const goalInput = document.getElementById("goalInput");
  const filesInput = document.getElementById("filesInput");
  const startSessionBtn = document.getElementById("startSessionBtn");

  const sessionIdValue = document.getElementById("sessionIdValue");
  const turnCountValue = document.getElementById("turnCountValue");
  const historySummaryEl = document.getElementById("historySummary");
  const filescopeList = document.getElementById("filescopeList");

  const chatLog = document.getElementById("chatLog");
  const userInput = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");

  const filesPanel = document.getElementById("filesPanel");
  const filesPanelList = document.getElementById("filesPanelList");

  let currentSession = null;
  let isSending = false;

  startSessionBtn.addEventListener("click", async () => {
    const goal = (goalInput.value || "").trim();
    const files = (filesInput.value || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!goal) {
      alert("Please enter a goal for the session.");
      return;
    }

    startSessionBtn.disabled = true;
    startSessionBtn.textContent = "Starting...";

    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, initialFiles: files }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to create session");
      }
      const session = await res.json();
      currentSession = session;
      renderSession(session);

      userInput.disabled = false;
      sendBtn.disabled = false;
      userInput.focus();
    } catch (err) {
      console.error(err);
      alert("Error creating session: " + err);
    } finally {
      startSessionBtn.disabled = false;
      startSessionBtn.textContent = "Start session";
    }
  });

  sendBtn.addEventListener("click", () => {
    sendUserMessage();
  });

  userInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendUserMessage();
    }
  });

  async function sendUserMessage() {
    if (!currentSession || isSending) return;
    const msg = (userInput.value || "").trim();
    if (!msg) return;

    isSending = true;
    sendBtn.disabled = true;
    userInput.disabled = true;

    try {
      const res = await fetch(`/api/session/${encodeURIComponent(
        currentSession.id
      )}/user-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to send user message");
      }
      const session = await res.json();
      currentSession = session;
      userInput.value = "";
      renderSession(session, true);
    } catch (err) {
      console.error(err);
      alert("Error sending message: " + err);
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
    }
  }

  function renderSession(session, scrollToBottom) {
    sessionIdValue.textContent = session.id || "–";
    turnCountValue.textContent = String(session.turns ? session.turns.length : 0);

    historySummaryEl.textContent = session.historySummary || "";
    if (!session.historySummary) {
      historySummaryEl.textContent =
        "Historian has not summarized anything yet.";
    }

    // Files-in-scope in sidebar
    filescopeList.innerHTML = "";
    if (session.filesInScope && session.filesInScope.length) {
      for (const file of session.filesInScope) {
        const item = document.createElement("div");
        item.className = "filescope-item";
        const dot = document.createElement("span");
        dot.textContent = "●";
        dot.style.color = "#22c55e";
        dot.style.fontSize = "0.7rem";
        const pathSpan = document.createElement("span");
        pathSpan.className = "path";
        pathSpan.textContent = file.path;
        item.appendChild(dot);
        item.appendChild(pathSpan);
        filescopeList.appendChild(item);
      }
    } else {
      const p = document.createElement("p");
      p.className = "small muted";
      p.style.margin = "0";
      p.textContent =
        "No files in scope yet. You can include paths when creating the session.";
      filescopeList.appendChild(p);
    }

    renderChatLog(session.turns || []);
    renderFilesPanel(session.filesInScope || []);

    if (scrollToBottom) {
      chatLog.scrollTop = chatLog.scrollHeight;
    } else {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }

  function renderChatLog(turns) {
    chatLog.innerHTML = "";
    if (!turns.length) {
      const p = document.createElement("p");
      p.className = "small muted";
      p.style.margin = "0";
      p.textContent =
        "No turns yet. Send a user message to start the loop.";
      chatLog.appendChild(p);
      return;
    }

    for (const turn of turns) {
      const turnEl = document.createElement("div");
      turnEl.className = "chat-turn";

      const header = document.createElement("div");
      header.className = "chat-turn-header";
      const left = document.createElement("div");
      const right = document.createElement("div");
      left.innerHTML = `<strong>Turn ${turn.id + 1}</strong>`;
      const nextExpected = turn.actorOutput.nextExpected || "tool_results";
      right.innerHTML = `<span class="tag-pill small">next: ${escapeHtml(
        String(nextExpected)
      )}</span>`;
      header.appendChild(left);
      header.appendChild(right);

      const userBubble = document.createElement("div");
      userBubble.className = "user-bubble";
      userBubble.textContent = turn.userMessage || "";

      const agentRow = document.createElement("div");
      agentRow.className = "agent-row";

      // Actor card
      const actorCard = document.createElement("div");
      actorCard.className = "agent-card";
      actorCard.innerHTML = `
        <h3>Actor <span class="tag">step</span></h3>
        <p>${escapeHtml(turn.actorOutput.stepSummary || "")}</p>
      `;
      const actionsList = document.createElement("ul");
      actionsList.className = "actions-list";

      const actions = turn.actorOutput.actions || [];
      for (const action of actions) {
        const li = document.createElement("li");
        const labelSpan = document.createElement("span");
        labelSpan.className = "label";
        const metaSpan = document.createElement("span");
        metaSpan.className = "meta";

        if (action.kind === "file_edit") {
          labelSpan.textContent = "file_edit → " + (action.path || "");
          metaSpan.textContent =
            action.mode === "replace_file" ? "replace_file" : "replace_range";
        } else if (action.kind === "command") {
          labelSpan.textContent = "command";
          metaSpan.textContent = action.command || "";
        } else if (action.kind === "message_to_user") {
          labelSpan.textContent = "message_to_user";
          metaSpan.textContent = (action.message || "").slice(0, 60);
        } else if (action.kind === "add_file_to_scope") {
          labelSpan.textContent = "add_file_to_scope";
          metaSpan.textContent = action.path || "";
        } else {
          labelSpan.textContent = String(action.kind || "action");
          metaSpan.textContent = "";
        }

        li.appendChild(labelSpan);
        li.appendChild(metaSpan);
        actionsList.appendChild(li);
      }

      if (!actions.length) {
        const li = document.createElement("li");
        li.innerHTML =
          '<span class="label muted">No actions for this step.</span>';
        actionsList.appendChild(li);
      }

      actorCard.appendChild(actionsList);

      // Validation + Tool results card (Historian gets separate card)
      const resultsCard = document.createElement("div");
      resultsCard.className = "agent-card";
      resultsCard.innerHTML = `
        <h3>Executor <span class="tag">tools</span></h3>
      `;
      const resultsList = document.createElement("ul");
      resultsList.className = "results-list";

      for (const r of turn.toolResults || []) {
        const li = document.createElement("li");
        const labelSpan = document.createElement("span");
        labelSpan.className = "label";
        const metaSpan = document.createElement("span");
        metaSpan.className = "meta";

        if (r.kind === "validation_result") {
          labelSpan.textContent = "validation_result (" + r.target + ")";
          metaSpan.textContent = r.success ? "ok" : "failed";
        } else if (r.kind === "file_edit_result") {
          labelSpan.textContent = "file_edit_result → " + (r.path || "");
          metaSpan.textContent = r.applied ? "applied" : "not applied";
        } else if (r.kind === "command_result") {
          labelSpan.textContent = "command_result";
          metaSpan.textContent =
            "exit " + (r.exitCode == null ? "?" : String(r.exitCode));
        } else if (r.kind === "file_added_to_scope_result") {
          labelSpan.textContent =
            "file_added_to_scope_result → " + (r.path || "");
          metaSpan.textContent = r.added ? "added" : (r.reason || "not added");
        } else {
          labelSpan.textContent = String(r.kind || "result");
          metaSpan.textContent = "";
        }

        li.appendChild(labelSpan);
        li.appendChild(metaSpan);
        resultsList.appendChild(li);
      }

      if (!turn.toolResults || !turn.toolResults.length) {
        const li = document.createElement("li");
        li.innerHTML =
          '<span class="label muted">No tool results for this step.</span>';
        resultsList.appendChild(li);
      }

      resultsCard.appendChild(resultsList);

      // Collapsible long outputs: for each command_result and validation_result snippet
      const longOutputDetails = document.createElement("div");
      for (const r of turn.toolResults || []) {
        if (r.kind === "command_result") {
          const details = document.createElement("details");
          details.className = "collapse";
          const summary = document.createElement("summary");
          summary.innerHTML = `
            <span class="label">
              <span>Command output</span>
            </span>
            <span class="chevron">▶</span>
          `;
          const content = document.createElement("div");
          content.className = "collapse-content";
          const stdout = r.stdout || "";
          const stderr = r.stderr || "";
          content.textContent =
            (stdout ? stdout : "") +
            (stdout && stderr ? "\n--- stderr ---\n" : "") +
            (stderr ? stderr : "");
          details.appendChild(summary);
          details.appendChild(content);
          longOutputDetails.appendChild(details);
        } else if (r.kind === "validation_result" && !r.success) {
          const details = document.createElement("details");
          details.className = "collapse";
          const summary = document.createElement("summary");
          summary.innerHTML = `
            <span class="label">
              <span>Validation errors</span>
            </span>
            <span class="chevron">▶</span>
          `;
          const content = document.createElement("div");
          content.className = "collapse-content";
          content.textContent =
            (r.errors && r.errors.join("\n")) ||
            "Validation failed, but no detailed errors were recorded.";
          details.appendChild(summary);
          details.appendChild(content);
          longOutputDetails.appendChild(details);
        }
      }
      if (longOutputDetails.childElementCount > 0) {
        resultsCard.appendChild(longOutputDetails);
      }

      agentRow.appendChild(actorCard);
      agentRow.appendChild(resultsCard);

      // Historian card below
      const historianCard = document.createElement("div");
      historianCard.className = "agent-card";
      historianCard.style.marginTop = "0.4rem";
      historianCard.innerHTML = `
        <h3>Historian <span class="tag">summary</span></h3>
        <p class="small muted">Step-level summary:</p>
        <p>${escapeHtml(turn.historianOutput.historySummary || "")}</p>
      `;

      turnEl.appendChild(header);
      turnEl.appendChild(userBubble);
      turnEl.appendChild(agentRow);
      turnEl.appendChild(historianCard);

      chatLog.appendChild(turnEl);
    }
  }

  function renderFilesPanel(filesInScope) {
    if (!filesInScope || !filesInScope.length) {
      filesPanel.style.display = "none";
      filesPanelList.innerHTML = "";
      return;
    }
    filesPanel.style.display = "block";
    filesPanelList.innerHTML = "";

    for (const file of filesInScope) {
      const item = document.createElement("div");
      item.className = "files-panel-item";

      const header = document.createElement("div");
      header.className = "files-panel-item-header";

      const pathSpan = document.createElement("span");
      pathSpan.className = "path";
      pathSpan.textContent = file.path;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "View";
      btn.addEventListener("click", () => {
        showFileModal(file);
      });

      header.appendChild(pathSpan);
      header.appendChild(btn);

      item.appendChild(header);
      filesPanelList.appendChild(item);
    }
  }

  function showFileModal(file) {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(15,23,42,0.85)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "40";

    const modal = document.createElement("div");
    modal.style.width = "min(900px, 96vw)";
    modal.style.maxHeight = "80vh";
    modal.style.borderRadius = "1rem";
    modal.style.border = "1px solid rgba(75,85,99,0.9)";
    modal.style.background = "#020617";
    modal.style.boxShadow = "0 24px 80px rgba(0,0,0,0.85)";
    modal.style.display = "flex";
    modal.style.flexDirection = "column";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.padding = "0.6rem 0.8rem";
    header.style.borderBottom = "1px solid rgba(31,41,55,0.9)";
    header.innerHTML = `
      <div>
        <div style="font-size:0.8rem; color:#9ca3af; text-transform:uppercase; letter-spacing:0.14em;">File snapshot</div>
        <div style="font-size:0.8rem; margin-top:0.1rem; color:#e5e7eb;" class="mono">${escapeHtml(
          file.path
        )}</div>
      </div>
    `;
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.borderRadius = "999px";
    closeBtn.style.border = "1px solid rgba(148,163,184,0.7)";
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "#e5e7eb";
    closeBtn.style.fontSize = "0.78rem";
    closeBtn.style.padding = "0.25rem 0.7rem";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
    });
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.style.padding = "0.6rem 0.8rem 0.8rem";
    const pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.maxHeight = "55vh";
    pre.style.overflow = "auto";
    pre.style.fontFamily =
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    pre.style.fontSize = "0.78rem";
    pre.style.background = "#020617";
    pre.style.color = "#e5e7eb";
    pre.textContent = file.content || "";
    body.appendChild(pre);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        document.body.removeChild(overlay);
      }
    });

    document.body.appendChild(overlay);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();