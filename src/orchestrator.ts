import {
  FileSnapshot,
  AgentAction,
  ActionResult,
  FileEditAction,
  CommandAction,
  FileEditResult,
  CommandResult,
} from "./agentDomain";
import {
  LLMAdapter,
  FewShotConfig,
  FewShotExample,
} from "./llmAdapter";
import { runFewShot } from "./fewShot";
import { ActorInput, ActorOutput } from "./actorTypes";
import { HistorianInput, HistorianOutput } from "./historianTypes";

export type CommandRunner = (command: string, cwd?: string) => Promise<CommandResult>;

export function applyFileEdit(
  files: FileSnapshot[],
  action: FileEditAction
): { files: FileSnapshot[]; result: FileEditResult } {
  const { path, mode, newContent, range, rangeNewText } = action;
  const idx = files.findIndex((f) => f.path === path);
  if (idx === -1) {
    return {
      files,
      result: { kind: "file_edit_result", path, applied: false, error: "File not found" },
    };
  }

  const file = files[idx];

  if (mode === "replace_file") {
    if (typeof newContent !== "string") {
      return {
        files,
        result: {
          kind: "file_edit_result",
          path,
          applied: false,
          error: "newContent is required for replace_file",
        },
      };
    }
    const updated: FileSnapshot = { ...file, content: newContent };
    const newFiles = [...files];
    newFiles[idx] = updated;
    return {
      files: newFiles,
      result: { kind: "file_edit_result", path, applied: true },
    };
  }

  if (!range || typeof rangeNewText !== "string") {
    return {
      files,
      result: {
        kind: "file_edit_result",
        path,
        applied: false,
        error: "range and rangeNewText are required for replace_range",
      },
    };
  }

  const { startOffset, endOffset } = range;
  if (
    startOffset < 0 ||
    endOffset > file.content.length ||
    startOffset > endOffset
  ) {
    return {
      files,
      result: {
        kind: "file_edit_result",
        path,
        applied: false,
        error: "Invalid range",
      },
    };
  }

  const newText =
    file.content.slice(0, startOffset) +
    rangeNewText +
    file.content.slice(endOffset);

  const updated: FileSnapshot = { ...file, content: newText };
  const newFiles = [...files];
  newFiles[idx] = updated;

  return {
    files: newFiles,
    result: { kind: "file_edit_result", path, applied: true },
  };
}

export async function executeActionsInMemory(
  files: FileSnapshot[],
  actions: AgentAction[],
  runCommand?: CommandRunner
): Promise<{ files: FileSnapshot[]; results: ActionResult[] }> {
  let currentFiles = files;
  const results: ActionResult[] = [];

  for (const action of actions) {
    if (action.kind === "file_edit") {
      const { files: updatedFiles, result } = applyFileEdit(currentFiles, action);
      currentFiles = updatedFiles;
      results.push(result);
    } else if (action.kind === "command") {
      let commandResult: CommandResult;
      if (runCommand) {
        commandResult = await runCommand(action.command, action.cwd);
      } else {
        commandResult = {
          kind: "command_result",
          command: action.command,
          exitCode: null,
          stdout: "",
          stderr: "",
        };
      }
      results.push(commandResult);
    } else {
      // message_to_user has no ActionResult
      continue;
    }
  }

  return { files: currentFiles, results };
}

export async function runActorStep(
  basePrompt: string,
  llm: LLMAdapter,
  config: FewShotConfig<ActorInput, ActorOutput>,
  input: ActorInput,
  examples: FewShotExample<ActorInput, ActorOutput>[] = [],
  options?: { temperature?: number; maxTokens?: number }
): Promise<ActorOutput> {
  const { parsed } = await runFewShot<ActorInput, ActorOutput>(
    basePrompt,
    llm,
    examples,
    input,
    config,
    {
      temperature: options?.temperature ?? 0,
      maxTokens: options?.maxTokens ?? 512,
    }
  );
  return parsed;
}

export async function runHistorianUpdate(
  basePrompt: string,
  llm: LLMAdapter,
  config: FewShotConfig<HistorianInput, HistorianOutput>,
  input: HistorianInput,
  examples: FewShotExample<HistorianInput, HistorianOutput>[] = [],
  options?: { temperature?: number; maxTokens?: number }
): Promise<HistorianOutput> {
  const { parsed } = await runFewShot<HistorianInput, HistorianOutput>(
    basePrompt,
    llm,
    examples,
    input,
    config,
    {
      temperature: options?.temperature ?? 0,
      maxTokens: options?.maxTokens ?? 256,
    }
  );
  return parsed;
}