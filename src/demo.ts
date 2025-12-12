import * as fs from "fs";
import * as path from "path";

import {
  FileSnapshot,
  AgentAction,
  ActionResult,
  CommandResult,
} from "./agentDomain";
import { ActorInput, ActorOutput } from "./actorTypes";
import { HistorianInput, HistorianOutput } from "./historianTypes";
import {
  LLMAdapter,
  CompletionOptions,
  FewShotConfig,
} from "./llmAdapter";
import {
  runActorStep,
  executeActionsInMemory,
  runHistorianUpdate,
} from "./orchestrator";

// Simple JSON helpers for the few-shot wrapper
const jsonSerializer = <T>(v: T) => JSON.stringify(v, null, 2);
const jsonParser = <T>(raw: string): T => JSON.parse(raw) as T;

const actorConfig: FewShotConfig<ActorInput, ActorOutput> = {
  serializeInput: jsonSerializer,
  serializeOutput: jsonSerializer,
  parseOutput: jsonParser,
  inputLabel: "Input",
  outputLabel: "Output",
};

const historianConfig: FewShotConfig<HistorianInput, HistorianOutput> = {
  serializeInput: jsonSerializer,
  serializeOutput: jsonSerializer,
  parseOutput: jsonParser,
  inputLabel: "Input",
  outputLabel: "Output",
};

// Mock LLM for Actor: returns a fixed plan
class MockActorAdapter implements LLMAdapter {
  constructor(private readonly output: ActorOutput) {}
  async complete(_prompt: string, _options?: CompletionOptions): Promise<string> {
    return JSON.stringify(this.output, null, 2);
  }
}

// Mock LLM for Historian: returns a fixed updated summary
class MockHistorianAdapter implements LLMAdapter {
  constructor(private readonly output: HistorianOutput) {}
  async complete(_prompt: string, _options?: CompletionOptions): Promise<string> {
    return JSON.stringify(this.output, null, 2);
  }
}

// Fake command runner: simulates successful tests
async function fakeRunCommand(command: string, _cwd?: string): Promise<CommandResult> {
  return {
    kind: "command_result",
    command,
    exitCode: 0,
    stdout: "All tests passed (simulated)",
    stderr: "",
  };
}

async function main() {
  const projectRoot = path.join(__dirname, "..");
  const samplesDir = path.join(projectRoot, "samples");

  const loginPath = path.join(samplesDir, "Login.tsx");
  const loginTestPath = path.join(samplesDir, "login.test.ts");

  const loginContent = fs.readFileSync(loginPath, "utf8");
  const loginTestContent = fs.readFileSync(loginTestPath, "utf8");

  // Files in scope for the demo
  let filesInScope: FileSnapshot[] = [
    {
      path: "samples/Login.tsx",
      content: loginContent,
      language: "tsx",
      isPrimary: true,
    },
    {
      path: "samples/login.test.ts",
      content: loginTestContent,
      language: "ts",
      isPrimary: false,
    },
  ];

  const goal = "Improve login logging message and simulate tests.";
  const userRequest = "Update the console log message in Login.tsx and run tests.";
  const initialHistorySummary =
    "Initial request: improve the login logging message and ensure tests are run.";

  console.log("=== Demo: agent-loop-llm-v2 ===");
  console.log("\n--- Initial Login.tsx ---\n");
  console.log(loginContent);

  // Prepare ActorOutput we want the mock to return
  const newLoginContent = loginContent.replace(
    "Login submitted",
    "Improved login submitted"
  );

  const actorPlannedOutput: ActorOutput = {
    stepSummary: "Update the console log message and run tests.",
    actions: [
      {
        kind: "file_edit",
        path: "samples/Login.tsx",
        mode: "replace_file",
        newContent: newLoginContent,
      },
      {
        kind: "command",
        command: "npm test",
        purpose: "run_tests",
      },
    ],
    nextExpected: "tool_results",
  };

  const actorInput: ActorInput = {
    goal,
    userRequest,
    historySummary: initialHistorySummary,
    filesInScope,
  };

  const actorAdapter = new MockActorAdapter(actorPlannedOutput);
  const actorBasePrompt = `
You are the Actor in a coding loop.
You see goal, userRequest, historySummary, filesInScope, and lastToolResults.
Decide what actions to take next and who should act after you.
Always respond with a JSON object matching ActorOutput.
  `.trim();

  // Run one Actor step
  const actorOutput = await runActorStep(
    actorBasePrompt,
    actorAdapter,
    actorConfig,
    actorInput,
  );

  console.log("\n--- Actor actions ---\n");
  actorOutput.actions.forEach((a: AgentAction, idx: number) => {
    console.log(`Action ${idx + 1}:`, JSON.stringify(a, null, 2));
  });

  // Execute actions in memory (apply edits + simulate command)
  const { files: updatedFiles, results: actionResults } =
    await executeActionsInMemory(filesInScope, actorOutput.actions, fakeRunCommand);

  filesInScope = updatedFiles;

  console.log("\n--- Updated Login.tsx ---\n");
  const updatedLogin = filesInScope.find((f) => f.path === "samples/Login.tsx");
  console.log(updatedLogin?.content ?? "(not found)");

  console.log("\n--- Simulated action results ---\n");
  actionResults.forEach((r: ActionResult, idx: number) => {
    console.log(`Result ${idx + 1}:`, JSON.stringify(r, null, 2));
  });

  // Build Historian input for this round
  const historianInput: HistorianInput = {
    goal,
    previousHistorySummary: initialHistorySummary,
    userTurn: { message: userRequest },
    actorTurn: {
      stepSummary: actorOutput.stepSummary,
      actions: actorOutput.actions,
      nextExpected: actorOutput.nextExpected,
    },
    toolResults: { results: actionResults },
  };

  const historianPlannedOutput: HistorianOutput = {
    historySummary:
      "We updated the login logging message in Login.tsx and simulated running tests successfully.",
  };

  const historianAdapter = new MockHistorianAdapter(historianPlannedOutput);
  const historianBasePrompt = `
You are the Historian in a coding loop.
You maintain historySummary as the single mission log under a fixed word limit.
Given previousHistorySummary and the latest userTurn, actorTurn, and toolResults,
rewrite historySummary from scratch including important attempts, successes, and failures.
Always respond with a JSON object matching HistorianOutput.
  `.trim();

  const historianOutput = await runHistorianUpdate(
    historianBasePrompt,
    historianAdapter,
    historianConfig,
    historianInput,
  );

  console.log("\n--- New history summary ---\n");
  console.log(historianOutput.historySummary);

  console.log("\n=== Demo complete ===");
}

// Allow running via `node dist/demo.js`
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}