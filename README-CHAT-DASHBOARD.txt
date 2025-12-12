This bundle introduces a *real* interactive chat dashboard and a small Node
server that wires the Actor–Historian–Executor loop into a web UI.

Files:

- src/chatServer.ts
    - Express-based HTTP server that:
        - Serves static assets from ./dashboard
        - Exposes:
            - POST /api/session
                - body: { goal: string, initialFiles?: string[] }
                - loads initial files from disk into filesInScope
                - creates an in-memory ChatSession with:
                    - goal
                    - historySummary
                    - filesInScope
                    - turns[]
            - GET /api/session/:id
                - returns the full ChatSession JSON
            - POST /api/session/:id/user-turn
                - body: { message: string }
                - runs one complete loop:
                    - builds ActorInput
                    - calls runActorStep (Actor LLM)
                    - validates ActorOutput
                    - if valid:
                        - executeActionsInMemory (Executor)
                    - builds HistorianInput
                    - calls runHistorianUpdate (Historian LLM)
                    - updates:
                        - historySummary
                        - lastToolResults
                        - filesInScope
                        - turns[]
                - returns the updated ChatSession

    - To start the server:
        - Ensure you have OPENAI_API_KEY set.
        - Add a script such as:
            "scripts": {
              "chat-server": "ts-node src/chatServer.ts"
            }
          or compile with tsc and run node dist/chatServer.js.
        - The server listens on PORT (env) or 4000 by default.
        - Dashboard is served at:
            http://localhost:4000/

- dashboard/chat-dashboard.html
- dashboard/chat-dashboard.js
    - A modern, aesthetic, **functional** chat UI for the loop.

    Features:

    1) New Session panel (left sidebar)
       - Textarea for the session goal.
       - Textarea for "files in scope" (one path per line), e.g.:
            samples/Login.tsx
            samples/login.test.ts
       - Creates a session via POST /api/session.

    2) Session State panel (left sidebar)
       - Shows:
            - Session ID
            - Turn count
            - Current historySummary (Historian's mission log)
            - Latest filesInScope (from the Executor), rendered as a list.

    3) Main Chat view (right side)
       - For each turn:
            - User bubble with the text you entered.
            - Actor card:
                - stepSummary
                - actions list:
                    - file_edit
                    - command
                    - message_to_user
                    - add_file_to_scope
                  rendered as labeled rows.
            - Executor card:
                - All ActionResult entries:
                    - validation_result
                    - file_edit_result
                    - command_result
                    - file_added_to_scope_result
                  rendered as labeled rows.
                - Collapsible sections for:
                    - Long command stdout/stderr
                    - Validation errors on failed validation_result
            - Historian card:
                - Step-level historySummary for that turn.

    4) Files-in-scope panel (bottom of main view)
       - Shows the **latest** FileSnapshot set returned by the Executor.
       - Each file has a "View" button that opens a modal:
            - fullscreen overlay with:
                - path
                - full current content (monospace, scrollable).

    5) Chat input bar
       - Textarea for user messages (Enter to send, Shift+Enter for newline).
       - "Send" button.
       - Disabled until a session is created.

Usage:

1) Drop src/chatServer.ts into your src/ directory.
2) Drop dashboard/chat-dashboard.html and dashboard/chat-dashboard.js
   into a dashboard/ directory at the project root.
3) Ensure your project already has:
    - agentDomain.ts
    - actorTypes.ts
    - historianTypes.ts
    - llmAdapter.ts
    - orchestrator.ts
    - executor.ts
    - openAIAdapter.ts
    - validation.ts
   as per the previous bundles.
4) Install express if you don't have it:
    npm install express
    npm install --save-dev @types/express
5) Start the server:
    - Set OPENAI_API_KEY.
    - Run your chosen script (e.g. npm run chat-server).
6) Open:
    http://localhost:4000/
   in your browser.

You now have a **live chat loop** where you:
- Define a goal and initial files-in-scope.
- Send arbitrary user turns.
- See, per turn:
    - ActorInput / ActorOutput (visually summarized),
    - validation + tool results from the Executor,
    - Historian's updated story,
    - and the latest file contents via the "Files in scope" panel.