export type NextExpected = "user" | "tool_results" | "done";

/**
 * A file or logical document the Actor currently has in its working set.
 * This is the Actor's curated "working memory" of concrete artifacts.
 */
export interface FileSnapshot {
  path: string;
  content: string;
  language?: string;
  /**
   * Optional hint for UIs or the Actor about which file is the primary focus.
   */
  isPrimary?: boolean;
}

export interface TextRange {
  startOffset: number;
  endOffset: number;
}

/**
 * All actions an Actor can take in a single step.
 *
 * - message_to_user: talk to the human.
 * - file_edit: modify one of the files in scope.
 * - command: run a shell/build/test command.
 * - add_file_to_scope: promote an external resource (e.g. repo file, search result,
 *   or prior tool output) into the Actor's FileSnapshot working set for future steps.
 */
export type AgentAction =
  | MessageToUserAction
  | FileEditAction
  | CommandAction
  | AddFileToScopeAction;

export interface MessageToUserAction {
  kind: "message_to_user";
  message: string;
  /**
   * Optional semantic hint for the UI / orchestrator.
   */
  messageType?: "info" | "question" | "warning" | "error";
}

export interface FileEditAction {
  kind: "file_edit";
  path: string;
  /**
   * replace_file: replace the entire file content with newContent.
   * replace_range: replace a byte/char range with rangeNewText.
   */
  mode: "replace_file" | "replace_range";
  /**
   * For replace_file mode, the full new file content.
   */
  newContent?: string;
  /**
   * For replace_range mode, the range to replace.
   */
  range?: TextRange;
  /**
   * For replace_range mode, the text to insert in the specified range.
   */
  rangeNewText?: string;
  /**
   * Optional explanation of why this edit is being made (for the human / Historian).
   */
  explanation?: string;
}

export interface CommandAction {
  kind: "command";
  command: string;
  cwd?: string;
  /**
   * Optional semantic purpose for this command; can be used by the Historian
   * and for analytics / dashboards.
   */
  purpose?: "run_tests" | "run_build" | "diagnostic" | "other";
}

/**
 * Ask the executor to add a new file/resource into the Actor's working set.
 *
 * This is how the Actor can promote larger tool outputs or external files
 * into its concrete FileSnapshot scope without the Historian needing to
 * see the full content.
 */
export interface AddFileToScopeAction {
  kind: "add_file_to_scope";
  /**
   * Logical path or identifier for the file/resource to pull into scope.
   * The executor is responsible for resolving this to actual content.
   */
  path: string;
  /**
   * Optional provenance hint: where this file is coming from.
   */
  source?: "fs" | "search" | "tool_output" | "other";
  /**
   * Optional human-readable description for the Historian / UI, e.g.
   * "Pulled LoginForm.tsx from the repo" or "Materialized search result #2".
   */
  description?: string;
}

/**
 * Results produced by executing Actor actions.
 *
 * These are:
 * - emitted as toolResults to the Historian for the current step, and
 * - exposed as lastToolResults to the Actor on the *next* step so it can
 *   react to recent outcomes (validation failures, test failures, etc.)
 */
export type ActionResult =
  | FileEditResult
  | CommandResult
  | ValidationResult
  | FileAddedToScopeResult;

export interface FileEditResult {
  kind: "file_edit_result";
  path: string;
  applied: boolean;
  error?: string;
}

export interface CommandResult {
  kind: "command_result";
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Result of validating an LLM output against the expected schema.
 * This is treated like any other "tool result" and handed to the Historian.
 */
export interface ValidationResult {
  kind: "validation_result";
  target: "actor" | "historian";
  success: boolean;
  errors?: string[];
  /**
   * Optional snippet of the raw, invalid output for debugging;
   * should be truncated to keep tokens under control.
   */
  rawOutputSnippet?: string;
}

/**
 * Result of processing an add_file_to_scope action.
 *
 * The executor should:
 * - resolve the requested path/source to actual content,
 * - update the next step's filesInScope (FileSnapshot[]),
 * - and emit a FileAddedToScopeResult for the Historian + Actor.
 *
 * Note: For in-memory demos, this can be a no-op that simply records
 * that the request was received, without actually changing filesInScope.
 */
export interface FileAddedToScopeResult {
  kind: "file_added_to_scope_result";
  path: string;
  /**
   * Whether the resource was successfully resolved and added to scope.
   */
  added: boolean;
  /**
   * Optional provenance hint (mirrors AddFileToScopeAction.source).
   */
  source?: "fs" | "search" | "tool_output" | "other";
  /**
   * Optional reason in case added === false, or a short description of
   * what was added when added === true.
   */
  reason?: string;
}