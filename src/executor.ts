import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import {
  AgentAction,
  ActionResult,
  CommandAction,
  CommandResult,
  FileAddedToScopeResult,
  FileEditAction,
  FileEditResult,
  FileSnapshot,
} from "./agentDomain";

const exec = promisify(execCb);

export interface ExecuteOptions {
  /**
   * If true, do not write to disk or run real commands.
   * Only update the in-memory FileSnapshot set and synthesize CommandResult.
   */
  dryRun?: boolean;
  /**
   * Optional base directory for resolving relative paths in file edits and commands.
   * Defaults to process.cwd().
   */
  projectRoot?: string;
}

/**
 * In-memory executor used for tests and demos.
 * It applies file edits against the provided FileSnapshot[] and uses the supplied
 * runCommand implementation for CommandAction.
 */
export async function executeActionsInMemory(
  filesInScope: FileSnapshot[],
  actions: AgentAction[],
  runCommand: (command: string, cwd?: string) => Promise<CommandResult>
): Promise<{ files: FileSnapshot[]; results: ActionResult[] }> {
  let files = [...filesInScope];
  const results: ActionResult[] = [];

  const getSnapshot = (p: string): FileSnapshot | undefined =>
    files.find((f) => f.path === p);

  const upsertSnapshot = (snap: FileSnapshot) => {
    const idx = files.findIndex((f) => f.path === snap.path);
    if (idx >= 0) {
      files[idx] = snap;
    } else {
      files.push(snap);
    }
  };

  for (const action of actions) {
    if (action.kind === "file_edit") {
      const res = applyFileEditInMemory(files, action);
      results.push(res.result);
      files = res.files;
    } else if (action.kind === "command") {
      const cmd = action as CommandAction;
      const cwd = cmd.cwd;
      const cmdResult = await runCommand(cmd.command, cwd);
      results.push(cmdResult);
    } else if (action.kind === "add_file_to_scope") {
      // In-memory version: we don't actually load from disk; just record that
      // the request was received. This keeps tests deterministic while letting
      // the Historian and Actor reason about the action.
      const addedResult: FileAddedToScopeResult = {
        kind: "file_added_to_scope_result",
        path: action.path,
        added: false,
        source: action.source,
        reason: "add_file_to_scope is not wired to a backing store in executeActionsInMemory",
      };
      results.push(addedResult);
      // No change to filesInScope in this variant.
    } else if (action.kind === "message_to_user") {
      // Messages to the user don't produce ActionResult in this minimal model.
      // If you want to track them, you can introduce a MessageResult variant.
      continue;
    }
  }

  return { files, results };
}

/**
 * Disk-backed executor that:
 * - applies file edits to the actual filesystem under projectRoot,
 * - runs shell commands via child_process.exec,
 * - and optionally resolves add_file_to_scope actions by reading files from disk.
 *
 * This is a "proper" executor for real projects; use with care.
 */
export async function executeActionsOnDisk(
  filesInScope: FileSnapshot[],
  actions: AgentAction[],
  options: ExecuteOptions = {}
): Promise<{ files: FileSnapshot[]; results: ActionResult[] }> {
  const { dryRun = false, projectRoot = process.cwd() } = options;

  let files = [...filesInScope];
  const results: ActionResult[] = [];

  const resolvePath = (p: string): string =>
    path.isAbsolute(p) ? p : path.join(projectRoot, p);

  const getSnapshot = (p: string): FileSnapshot | undefined =>
    files.find((f) => f.path === p);

  const upsertSnapshot = (snap: FileSnapshot) => {
    const idx = files.findIndex((f) => f.path === snap.path);
    if (idx >= 0) {
      files[idx] = snap;
    } else {
      files.push(snap);
    }
  };

  for (const action of actions) {
    if (action.kind === "file_edit") {
      const edit = action as FileEditAction;
      const absPath = resolvePath(edit.path);

      // Determine base content: prefer an existing snapshot, else read from disk.
      let baseContent: string | undefined =
        getSnapshot(edit.path)?.content ?? undefined;
      if (baseContent === undefined && fs.existsSync(absPath)) {
        baseContent = fs.readFileSync(absPath, "utf8");
      }
      if (baseContent === undefined) {
        baseContent = "";
      }

      const { newContent, result } = applyFileEditToContent(baseContent, edit);

      if (!dryRun) {
        await fsp.mkdir(path.dirname(absPath), { recursive: true });
        await fsp.writeFile(absPath, newContent, "utf8");
      }

      upsertSnapshot({
        path: edit.path,
        content: newContent,
      });

      results.push(result);
    } else if (action.kind === "command") {
      const cmd = action as CommandAction;
      const cwd = cmd.cwd ? resolvePath(cmd.cwd) : projectRoot;

      let cmdResult: CommandResult;
      if (dryRun) {
        cmdResult = {
          kind: "command_result",
          command: cmd.command,
          exitCode: 0,
          stdout: "[dry-run] command not executed",
          stderr: "",
        };
      } else {
        try {
          const { stdout, stderr } = await exec(cmd.command, { cwd });
          cmdResult = {
            kind: "command_result",
            command: cmd.command,
            exitCode: 0,
            stdout,
            stderr,
          };
        } catch (err: any) {
          cmdResult = {
            kind: "command_result",
            command: cmd.command,
            exitCode: typeof err?.code === "number" ? err.code : null,
            stdout: err?.stdout ?? "",
            stderr: err?.stderr ?? String(err),
          };
        }
      }
      results.push(cmdResult);
    } else if (action.kind === "add_file_to_scope") {
      const absPath = resolvePath(action.path);
      let added = false;
      let reason: string | undefined;
      let content: string | undefined;

      if (!dryRun && fs.existsSync(absPath)) {
        content = fs.readFileSync(absPath, "utf8");
        added = true;
      } else if (!dryRun) {
        reason = "File does not exist on disk";
      } else {
        reason = "dryRun: file not actually loaded from disk";
      }

      if (added && content !== undefined) {
        upsertSnapshot({
          path: action.path,
          content,
        });
      }

      const addedResult: FileAddedToScopeResult = {
        kind: "file_added_to_scope_result",
        path: action.path,
        added,
        source: action.source,
        reason,
      };
      results.push(addedResult);
    } else if (action.kind === "message_to_user") {
      // As in in-memory executor, messages don't produce ActionResult by default.
      continue;
    }
  }

  return { files, results };
}

/**
 * Apply a FileEditAction against the in-memory FileSnapshot set.
 */
function applyFileEditInMemory(
  files: FileSnapshot[],
  edit: FileEditAction
): { files: FileSnapshot[]; result: FileEditResult } {
  const existing = files.find((f) => f.path === edit.path);
  const baseContent = existing?.content ?? "";
  const { newContent, result } = applyFileEditToContent(baseContent, edit);

  const updated: FileSnapshot = {
    ...(existing ?? { path: edit.path }),
    content: newContent,
  };

  const newFiles = files.filter((f) => f.path !== edit.path);
  newFiles.push(updated);

  return { files: newFiles, result };
}

/**
 * Pure helper that applies a FileEditAction to a string of content.
 */
function applyFileEditToContent(
  baseContent: string,
  edit: FileEditAction
): { newContent: string; result: FileEditResult } {
  if (edit.mode === "replace_file") {
    const newContent =
      edit.newContent !== undefined ? edit.newContent : baseContent;
    const result: FileEditResult = {
      kind: "file_edit_result",
      path: edit.path,
      applied: true,
    };
    return { newContent, result };
  }

  // replace_range mode
  const range = edit.range;
  const rangeText = edit.rangeNewText ?? "";
  if (!range) {
    const result: FileEditResult = {
      kind: "file_edit_result",
      path: edit.path,
      applied: false,
      error: "replace_range mode requires a 'range' field",
    };
    return { newContent: baseContent, result };
  }

  const start = Math.max(0, Math.min(baseContent.length, range.startOffset));
  const end = Math.max(start, Math.min(baseContent.length, range.endOffset));

  const newContent =
    baseContent.slice(0, start) + rangeText + baseContent.slice(end);

  const result: FileEditResult = {
    kind: "file_edit_result",
    path: edit.path,
    applied: true,
  };
  return { newContent, result };
}