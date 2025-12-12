This bundle introduces an explicit "add file to scope" action to the shared
agent domain model, so the Actor can curate its working FileSnapshot set and
the Historian never needs to see large raw tool outputs.

Files:

- src/agentDomain.ts
    - New AgentAction variant:
        - AddFileToScopeAction:
            kind: "add_file_to_scope";
            path: string;
            source?: "fs" | "search" | "tool_output" | "other";
            description?: string;
    - New ActionResult variant:
        - FileAddedToScopeResult:
            kind: "file_added_to_scope_result";
            path: string;
            added: boolean;
            source?: ...;
            reason?: string;
    - ActionResult union extended to include FileAddedToScopeResult.

Conceptual flow:

- Actor (step N) can emit an add_file_to_scope action to promote some external
  resource into its working FileSnapshot set (filesInScope).
- Executor:
    - resolves the path/source to actual content,
    - updates the next step's filesInScope,
    - emits a FileAddedToScopeResult in toolResults for this step.
- Historian:
    - sees FileAddedToScopeResult and updates historySummary accordingly,
      without ever needing full file content.
- Actor (step N+1):
    - sees:
        - updated historySummary (narrative),
        - updated filesInScope (concrete content),
        - lastToolResults including the FileAddedToScopeResult if needed.

Integration:

1) Replace your existing src/agentDomain.ts with this version.
2) Update your executor / action runner to handle:
       kind === "add_file_to_scope"
   and emit a FileAddedToScopeResult + updated filesInScope for the next step.
3) Optionally update your Actor prompt to describe the new action type and
   how/when it should be used (e.g., to pull more files from the repo into
   scope, or to materialize search/tool outputs).