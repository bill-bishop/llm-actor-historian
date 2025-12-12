import fs from "fs";
import path from "path";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import {
  FileSnapshot,
  AgentAction,
  ActionResult,
} from "./agentDomain";

const execAsync = promisify(execCb);

export interface CommandExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecuteOptions {
  dryRun?: boolean;
  projectRoot?: string;
}

/**
 * In-memory executor:
 * - Applies file_edit actions to the FileSnapshot[] array only.
 * - Uses an injected runCommand handler for command actions.
 * - add_file_to_scope is reported but does not actually load files.
 */
export async function executeActionsInMemory(
  filesInScope: FileSnapshot[],
  actions: AgentAction[],
  runCommand: (command: string, cwd?: string) => Promise<CommandExecResult>
): Promise<{ files: FileSnapshot[]; results: ActionResult[] }> {
  let files = [...filesInScope];
  const results: ActionResult[] = [];

  for (const action of actions || []) {
    if (action.kind === "file_edit") {
      const { updatedFiles, result } = applyFileEditInMemory(files, action);
      files = updatedFiles;
      results.push(result as any);
    } else if (action.kind === "command") {
      const cmd = action.command || "";
      const cmdRes = await runCommand(cmd);
      results.push({
        kind: "command_result",
        command: cmd,
        exitCode: cmdRes.exitCode,
        stdout: cmdRes.stdout,
        stderr: cmdRes.stderr,
      } as any);
    } else if (action.kind === "add_file_to_scope") {
      // In-memory executor cannot actually pull from disk, just report.
      results.push({
        kind: "file_added_to_scope_result",
        path: action.path,
        added: false,
        reason:
          "In-memory executor does not load new files; use executeActionsOnDisk for real file additions.",
      } as any);
    } else if (action.kind === "message_to_user") {
      // No tool result; message is surfaced via ActorOutput only.
      continue;
    }
  }

  return { files, results };
}

/**
 * Disk-backed executor:
 * - Applies file_edit actions to real files on disk (projectRoot).
 * - Runs shell commands for command actions.
 * - Supports add_file_to_scope by reading from disk and updating FileSnapshot[].
 * - Respects dryRun to simulate changes without writing or executing commands.
 */
export async function executeActionsOnDisk(
  filesInScope: FileSnapshot[],
  actions: AgentAction[],
  options: ExecuteOptions = {}
): Promise<{ files: FileSnapshot[]; results: ActionResult[] }> {
  const { dryRun = true } = options;
  const projectRoot = options.projectRoot || process.cwd();

  let files = [...filesInScope];
  const results: ActionResult[] = [];

  for (const action of actions || []) {
    if (action.kind === "file_edit") {
      const { updatedFiles, result } = applyFileEditOnDisk(
        files,
        action,
        projectRoot,
        dryRun
      );
      files = updatedFiles;
      results.push(result as any);
    } else if (action.kind === "command") {
      const cmd = action.command || "";
      if (dryRun) {
        results.push({
          kind: "command_result",
          command: cmd,
          exitCode: 0,
          stdout:
            "[dry run] Command not executed. This is a simulated result.",
          stderr: "",
        } as any);
      } else {
        try {
          const { stdout, stderr } = await execAsync(cmd, {
            cwd: projectRoot,
          });
          results.push({
            kind: "command_result",
            command: cmd,
            exitCode: 0,
            stdout,
            stderr,
          } as any);
        } catch (err: any) {
          results.push({
            kind: "command_result",
            command: cmd,
            exitCode: typeof err.code === "number" ? err.code : null,
            stdout: err.stdout ?? "",
            stderr: err.stderr ?? String(err),
          } as any);
        }
      }
    } else if (action.kind === "add_file_to_scope") {
      const res = handleAddFileToScope(files, action, projectRoot);
      files = res.updatedFiles;
      results.push(res.result as any);
    } else if (action.kind === "message_to_user") {
      // No tool result emitted; message is part of ActorOutput.
      continue;
    }
  }

  return { files, results };
}

// ---------- helpers ----------

function applyFileEditInMemory(
  filesInScope: FileSnapshot[],
  action: any
): { updatedFiles: FileSnapshot[]; result: ActionResult } {
  const pathStr: string = action.path;
  const mode: string = action.mode;
  const newContent: string = action.newContent ?? "";
  const fromLine: number | undefined = action.fromLine;
  const toLine: number | undefined = action.toLine;

  const idx = filesInScope.findIndex((f) => f.path === pathStr);
  const existing = idx >= 0 ? filesInScope[idx] : { path: pathStr, content: "" };
  let updatedContent = existing.content;

  if (mode === "replace_file") {
    updatedContent = newContent;
  } else if (mode === "replace_range") {
    const lines = existing.content.split(/\r?\n/);
    const start = typeof fromLine === "number" ? fromLine - 1 : 0;
    const end = typeof toLine === "number" ? toLine - 1 : lines.length - 1;
    const before = lines.slice(0, start);
    const after = lines.slice(end + 1);
    const replacementLines = newContent.split(/\r?\n/);
    updatedContent = [...before, ...replacementLines, ...after].join("\n");
  }

  const updatedSnapshot: FileSnapshot = {
    path: existing.path,
    content: updatedContent,
  };

  const updatedFiles = [...filesInScope];
  if (idx >= 0) {
    updatedFiles[idx] = updatedSnapshot;
  } else {
    updatedFiles.push(updatedSnapshot);
  }

  const result: ActionResult = {
    kind: "file_edit_result",
    path: pathStr,
    applied: true,
    previousContent: existing.content,
    newContent: updatedContent,
  } as any;

  return { updatedFiles, result };
}

function applyFileEditOnDisk(
  filesInScope: FileSnapshot[],
  action: any,
  projectRoot: string,
  dryRun: boolean
): { updatedFiles: FileSnapshot[]; result: ActionResult } {
  const pathStr: string = action.path;
  const mode: string = action.mode;
  const newContent: string = action.newContent ?? "";
  const fromLine: number | undefined = action.fromLine;
  const toLine: number | undefined = action.toLine;

  const absPath = path.isAbsolute(pathStr)
    ? pathStr
    : path.join(projectRoot, pathStr);

  const idx = filesInScope.findIndex((f) => f.path === pathStr);
  let previousContent: string;
  if (idx >= 0) {
    previousContent = filesInScope[idx].content;
  } else if (fs.existsSync(absPath)) {
    previousContent = fs.readFileSync(absPath, "utf8");
  } else {
    previousContent = "";
  }

  let updatedContent = previousContent;
  if (mode === "replace_file") {
    updatedContent = newContent;
  } else if (mode === "replace_range") {
    const lines = previousContent.split(/\r?\n/);
    const start = typeof fromLine === "number" ? fromLine - 1 : 0;
    const end = typeof toLine === "number" ? toLine - 1 : lines.length - 1;
    const before = lines.slice(0, start);
    const after = lines.slice(end + 1);
    const replacementLines = newContent.split(/\r?\n/);
    updatedContent = [...before, ...replacementLines, ...after].join("\n");
  }

  if (!dryRun) {
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, updatedContent, "utf8");
  }

  const updatedSnapshot: FileSnapshot = {
    path: pathStr,
    content: updatedContent,
  };

  const updatedFiles = [...filesInScope];
  if (idx >= 0) {
    updatedFiles[idx] = updatedSnapshot;
  } else {
    updatedFiles.push(updatedSnapshot);
  }

  const result: ActionResult = {
    kind: "file_edit_result",
    path: pathStr,
    applied: true,
    previousContent,
    newContent: updatedContent,
    wroteToDisk: !dryRun,
  } as any;

  return { updatedFiles, result };
}

function handleAddFileToScope(
  filesInScope: FileSnapshot[],
  action: any,
  projectRoot: string
): { updatedFiles: FileSnapshot[]; result: ActionResult } {
  const pathStr: string = action.path;
  const absPath = path.isAbsolute(pathStr)
    ? pathStr
    : path.join(projectRoot, pathStr);

  let updatedFiles = [...filesInScope];

  const existingIdx = filesInScope.findIndex((f) => f.path === pathStr);
  if (existingIdx >= 0) {
    // Already in scope; report added = true but indicate it's already there.
    const result: ActionResult = {
      kind: "file_added_to_scope_result",
      path: pathStr,
      added: true,
      reason: "File was already in scope; using existing snapshot.",
    } as any;
    return { updatedFiles, result };
  }

  if (!fs.existsSync(absPath)) {
    const result: ActionResult = {
      kind: "file_added_to_scope_result",
      path: pathStr,
      added: false,
      reason: "File not found on disk.",
    } as any;
    return { updatedFiles, result };
  }

  const content = fs.readFileSync(absPath, "utf8");
  updatedFiles.push({
    path: pathStr,
    content,
  });

  const result: ActionResult = {
    kind: "file_added_to_scope_result",
    path: pathStr,
    added: true,
    reason: "Loaded from disk and added to filesInScope.",
  } as any;
  return { updatedFiles, result };
}