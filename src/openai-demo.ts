
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
  FewShotExample,
} from "./llmAdapter";
import {
  runActorStep,
  executeActionsInMemory,
  runHistorianUpdate,
} from "./orchestrator";
import { OpenAIAdapter } from "./openAIAdapter";

// JSON helpers
const jsonSerializer = <T>(v: T) => JSON.stringify(v, null, 2);
const jsonParser = <T>(raw: string): T => {
  const trimmed = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(trimmed) as T;
};

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

// Simple few-shot examples (kept small)
const actorExamples: FewShotExample<ActorInput, ActorOutput>[] = [
  {
    input: {
      goal: "Improve a log message.",
      userRequest: "Update the log and run tests.",
      historySummary: "User wants a better log message; tests should still pass.",
      filesInScope: [
        { path: "app.ts", content: "console.log('Old');" },
      ],
      lastToolResults: [],
    },
    output: {
      stepSummary: "Change the log message and run tests.",
      actions: [
        {
          kind: "file_edit",
          path: "app.ts",
          mode: "replace_file",
          newContent: "console.log('Improved');",
        },
        {
          kind: "command",
          command: "npm test",
          purpose: "run_tests",
        },
      ],
      nextExpected: "tool_results",
    },
  },
];

const historianExamples: FewShotExample<HistorianInput, HistorianOutput>[] = [
  {
    input: {
      goal: "Improve a log message.",
      previousHistorySummary: "Initial request: improve logging.",
      userTurn: { message: "Update the log and run tests." },
      actorTurn: {
        stepSummary: "We will change the log and run tests.",
        actions: [
          {
            kind: "file_edit",
            path: "app.ts",
            mode: "replace_file",
            newContent: "console.log('Improved');",
          },
          {
            kind: "command",
            command: "npm test",
            purpose: "run_tests",
          },
        ],
        nextExpected: "tool_results",
      },
      toolResults: {
        results: [
          {
            kind: "file_edit_result",
            path: "app.ts",
            applied: true,
          },
          {
            kind: "command_result",
            command: "npm test",
            exitCode: 0,
            stdout: "All tests passed",
            stderr: "",
          },
        ],
      },
    },
    output: {
      historySummary:
        "We updated the log message and successfully ran tests.",
    },
  },
];

// Fake command runner (we don't actually run shell commands in this demo)
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set. Please export it before running this demo.");
    process.exit(1);
  }

  const actorLLM: LLMAdapter = new OpenAIAdapter({
    apiKey,
    model: "gpt-4.1-mini",
  });

  const historianLLM: LLMAdapter = new OpenAIAdapter({
    apiKey,
    model: "gpt-4.1-mini",
  });

  const projectRoot = path.join(__dirname, "..");
  const samplesDir = path.join(projectRoot, "samples");

  const loginPath = path.join(samplesDir, "Login.tsx");
  const loginTestPath = path.join(samplesDir, "login.test.ts");

  const loginContent = fs.readFileSync(loginPath, "utf8");
  const loginTestContent = fs.readFileSync(loginTestPath, "utf8");

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

  const goal = "Improve the login logging message and ensure tests still pass.";
  const userRequest =
    "Update the console.log message in samples/Login.tsx to be more descriptive and run tests.";
  const initialHistorySummary =
    "Initial request: improve the login logging message in Login.tsx and ensure tests run.";

  console.log("=== OpenAI Demo: agent-loop-llm-v2 ===");
  console.log("\n--- Initial Login.tsx ---\n");
  console.log(loginContent);

  const actorBasePrompt = `
You are the **Actor** in a coding loop.

You receive JSON called ActorInput with fields:
- goal: string
- userRequest: string
- historySummary: string (a compressed mission log)
- filesInScope: FileSnapshot[]
- lastToolResults: ActionResult[] | undefined

Each FileSnapshot is:
- path: string
- content: string
- language?: string
- isPrimary?: boolean

Each ActionResult is either:
- { "kind": "file_edit_result", "path": string, "applied": boolean, "error"?: string }
or
- { "kind": "command_result", "command": string, "exitCode": number | null, "stdout": string, "stderr": string }

Your job:
1. Read goal, userRequest, historySummary, and the filesInScope (especially "samples/Login.tsx").
2. Decide a sequence of actions to move the goal forward:
   - file edits to "samples/Login.tsx"
   - optionally a command to run tests, like "npm test"
3. Set nextExpected:
   - "tool_results" if you want to see what happens when your actions are executed next.
   - "done" ONLY if the goal is already fully satisfied.
   - For this demo, you SHOULD normally choose "tool_results".

You MUST respond with a JSON object matching ActorOutput:

{
  "stepSummary": string (short description of what you are trying this step),
  "actions": AgentAction[],
  "nextExpected": "user" | "tool_results" | "done"
}

Each AgentAction must be one of:

1) Message to user:
{
  "kind": "message_to_user",
  "message": string,
  "messageType"?: "info" | "question" | "warning" | "error"
}

2) File edit:
{
  "kind": "file_edit",
  "path": string,
  "mode": "replace_file" | "replace_range",
  "newContent"?: string,
  "range"?: { "startOffset": number, "endOffset": number },
  "rangeNewText"?: string,
  "explanation"?: string
}

3) Command:
{
  "kind": "command",
  "command": string,
  "cwd"?: string,
  "purpose"?: "run_tests" | "run_build" | "diagnostic" | "other"
}

For this demo:
- Edit ONLY "samples/Login.tsx".
- Prefer a single "file_edit" with mode "replace_file" to update the console.log message.
- Optionally add one "command" action with command "npm test" and purpose "run_tests".
- Set nextExpected to "tool_results" so you can see the results.
- Do NOT include any extra fields outside the schema.
- Output MUST be valid JSON, without comments or explanations.
  `.trim();

  const actorInput: ActorInput = {
    goal,
    userRequest,
    historySummary: initialHistorySummary,
    filesInScope,
  };

  const actorOutput = await runActorStep(
    actorBasePrompt,
    actorLLM,
    actorConfig,
    actorInput,
    actorExamples,
    { temperature: 0, maxTokens: 512 },
  );

  console.log("\n--- ActorOutput ---\n");
  console.log(JSON.stringify(actorOutput, null, 2));

  const { files: updatedFiles, results: actionResults } =
    await executeActionsInMemory(filesInScope, actorOutput.actions, fakeRunCommand);

  filesInScope = updatedFiles;

  console.log("\n--- Updated Login.tsx ---\n");
  const updatedLogin = filesInScope.find((f) => f.path === "samples/Login.tsx");
  console.log(updatedLogin?.content ?? "(not found)");

  console.log("\n--- ActionResults ---\n");
  actionResults.forEach((r: ActionResult, idx: number) => {
    console.log(`Result ${idx + 1}:`, JSON.stringify(r, null, 2));
  });

  const historianBasePrompt = `
You are the **Historian** in a coding loop.

You receive JSON called HistorianInput with fields:
- goal: string
- previousHistorySummary: string
- userTurn?: { "message": string }
- actorTurn?: {
    "stepSummary"?: string,
    "actions": AgentAction[],
    "nextExpected": "user" | "tool_results" | "done"
  }
- toolResults?: { "results": ActionResult[] }

Your job:
- Rewrite historySummary from scratch as a short mission log (max ~200 words).
- Include:
  - the goal,
  - what the user most recently requested,
  - what the Actor tried this step (from actions and stepSummary),
  - what worked and what failed (from toolResults),
  - current state or next direction if relevant.
- Drop low-level noise (full file contents, long stack traces).

You MUST respond with a JSON object:

{
  "historySummary": string
}

Do NOT include any additional fields. Output only valid JSON.
  `.trim();

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

  const historianOutput = await runHistorianUpdate(
    historianBasePrompt,
    historianLLM,
    historianConfig,
    historianInput,
    historianExamples,
    { temperature: 0, maxTokens: 256 },
  );

  console.log("\n--- New historySummary ---\n");
  console.log(historianOutput.historySummary);

  console.log("\n=== OpenAI Demo complete ===");
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
