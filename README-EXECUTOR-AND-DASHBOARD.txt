This bundle adds:

1) A proper executor with both in-memory and disk-backed variants.
2) Updated demos to use the shared executor.
3) A more aesthetic, chat-style logging dashboard with token bars and a
   manual files-in-scope checklist.

Files:

- src/executor.ts
    - executeActionsInMemory(filesInScope, actions, runCommand):
        - Reimplements the in-memory executor used by demos/tests.
        - Supports:
            - file_edit
            - command
            - add_file_to_scope (no-op backing store, emits FileAddedToScopeResult)
            - message_to_user (no ActionResult by default).
    - executeActionsOnDisk(filesInScope, actions, options):
        - Applies file edits to the real filesystem under options.projectRoot.
        - Runs commands using child_process.exec (unless dryRun is true).
        - Resolves add_file_to_scope by reading files from disk and adding
          them to the FileSnapshot[].
        - Returns { files: FileSnapshot[], results: ActionResult[] }.

- src/openai-demo.ts
    - Updated to import executeActionsInMemory from "./executor" instead of
      implementing its own executor.
    - Still demonstrates a one-step Actor/Historian loop over samples/Login.tsx.

- src/validation-demo.ts
    - Updated "realistic loop" validation demo:
        - Uses executeActionsInMemory from "./executor".
        - Otherwise retains the stable Actor/Historian prompts and
          historySummary + lastToolResults retry behavior.

- dashboard/llm-dashboard.html
- dashboard/llm-dashboard.js
    - New, more aesthetic "LLM Session Inspector" UX:
        - Left sidebar:
            - Log file loader.
            - Session summary (calls, models, total tokens, average tokens/call).
            - Error and model badges.
        - Center:
            - Chat-like list of LLM calls (prompt on left, completion on right).
            - Click a card to view full prompt/completion in the lower panel.
        - Right side panel:
            - Token bars for the currently selected call (prompt/completion/total).
            - A manual "Files in scope" checklist where you can add paths to
              mirror the Actor's working set for the session you're inspecting.

Usage:

1) Executor:
    - For demos/tests:
        import { executeActionsInMemory } from "./executor";
    - For real projects:
        import { executeActionsOnDisk } from "./executor";
      and pass an ExecuteOptions with projectRoot and/or dryRun.

2) Dashboard:
    - Open dashboard/llm-dashboard.html in a browser.
    - Use the file picker to select one or more logs/llm-*.jsonl files.
    - Click on a call card to see full prompt and completion, with token bars
      updating in the right panel.
    - Use the "Files in scope" section to track which files you believe are
      currently in scope for your Actor loop (manual, local-only).

You can safely drop these files into your existing repo; they are intended
to replace your previous openai-demo.ts / validation-demo.ts and dashboard
HTML/JS, and to introduce executor.ts as a shared execution surface.