export type NextExpected = "user" | "tool_results" | "done";

export interface FileSnapshot {
  path: string;
  content: string;
  language?: string;
  isPrimary?: boolean;
}

export interface TextRange {
  startOffset: number;
  endOffset: number;
}

export type AgentAction =
  | MessageToUserAction
  | FileEditAction
  | CommandAction;

export interface MessageToUserAction {
  kind: "message_to_user";
  message: string;
  messageType?: "info" | "question" | "warning" | "error";
}

export interface FileEditAction {
  kind: "file_edit";
  path: string;
  mode: "replace_file" | "replace_range";
  newContent?: string;
  range?: TextRange;
  rangeNewText?: string;
  explanation?: string;
}

export interface CommandAction {
  kind: "command";
  command: string;
  cwd?: string;
  purpose?: "run_tests" | "run_build" | "diagnostic" | "other";
}

export type ActionResult =
  | FileEditResult
  | CommandResult
  | ValidationResult;

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
  rawOutputSnippet?: string;
}