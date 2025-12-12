Updates: real execution & dynamic add_file_to_scope
===================================================

This bundle extends the previous chat dashboard with:

1) Real file edits + command execution (disk-backed executor).
2) Dynamic add_file_to_scope support wired through the Actor, Executor,
   Historian, and UI.
3) A "Dry-run only" mode toggle in the UI and server, so you can choose
   between safe simulation and live mutations.

Files in this bundle:

- src/chatServer.ts
    - Now uses `executeActionsOnDisk` instead of the in-memory executor.
    - Accepts `dryRun` in POST /api/session to control whether:
        - file_edit writes to disk, and
        - command actions actually run on your shell.
    - The Actor has an extra few-shot example that demonstrates
      `add_file_to_scope`.
    - Historian prompt explicitly mentions `file_added_to_scope_result`.
    - ChatSession now includes:
        interface ChatSession {
          ...
          dryRun: boolean;
        }

- src/executor.ts
    - Provides two executors:

      1) executeActionsInMemory(filesInScope, actions, runCommand)
         - Purely in-memory:
            - file_edit mutates `FileSnapshot[]` only.
            - command uses injected `runCommand` and returns command_result.
            - add_file_to_scope emits a file_added_to_scope_result with
              added=false and a reason (no disk access).

      2) executeActionsOnDisk(filesInScope, actions, options)
         - Disk-backed execution:
            - file_edit:
                - Reads the current contents from:
                    - filesInScope, or
                    - disk (if not in scope).
                - Applies:
                    - replace_file, or
                    - replace_range (line-based).
                - Writes back to disk when dryRun === false.
                - Updates FileSnapshot[] and returns file_edit_result
                  with previousContent, newContent, and wroteToDisk.
            - command:
                - When dryRun === true:
                    - Emits a simulated command_result.
                - When dryRun === false:
                    - Executes the command with child_process.exec,
                      capturing stdout/stderr and exitCode.
            - add_file_to_scope:
                - If the file is already present in filesInScope:
                    - Returns file_added_to_scope_result (added=true, reason).
                - If the file exists on disk:
                    - Reads it, pushes to FileSnapshot[], and reports added=true.
                - If the file does not exist:
                    - Emits added=false with a reason.

- dashboard/chat-dashboard.html
    - New controls:
        - "Dry-run only (no real writes or commands)" checkbox in the
          "New session" panel.
        - A "Mode" row in the Session state panel.
        - A "Mode" pill in the header.

- dashboard/chat-dashboard.js
    - When creating a session, POST /api/session now sends:
        { goal, initialFiles, dryRun }
    - renderSession() displays the mode as:
        - "Dry run (safe)"  or
        - "Live (writes + commands)"
      in both sidebar and header.
    - The Executor card now:
        - For file_edit_result:
            - Shows "applied" + "(disk)" when wroteToDisk === true.
            - Shows "(no disk write)" when wroteToDisk === false.
        - For file_added_to_scope_result:
            - Shows added / reason inline.
    - Sidebar explains that files can come from initialFiles OR from
      Actor-driven add_file_to_scope steps.

Usage
-----

1) Drop these files over the existing ones in your repo:
    - src/chatServer.ts
    - src/executor.ts
    - dashboard/chat-dashboard.html
    - dashboard/chat-dashboard.js

2) Ensure dependencies:
    - express, @types/express
    - child_process is built-in

3) Start the server (with OPENAI_API_KEY set), e.g.:
    "scripts": {
      "chat-server": "ts-node src/chatServer.ts"
    }

4) Open:
    http://localhost:4000/

5) In the "New session" panel:
    - Enter a goal.
    - Specify initial files (optional).
    - Choose:
        - Dry-run only (safe): no disk writes, commands simulated.
        - Uncheck to go Live: real writes + shell commands.
    - Click "Start session".

6) Type user messages and watch:
    - Actor propose file_edit, command, add_file_to_scope.
    - Executor apply those:
        - Show file_edit_result / command_result / file_added_to_scope_result.
    - Historian integrate the step into historySummary.
    - Files-in-scope update dynamically as files are added from disk.

This gives you a real, stepwise, **operational** loop with:
- Live editing of your TypeScript/React/etc. files,
- Optional real command execution (e.g., `npm test`),
- Actor-driven dynamic scoping of files,
- And a UI that surfaces all of it clearly with collapsible long outputs.