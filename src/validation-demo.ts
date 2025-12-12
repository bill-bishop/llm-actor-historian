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
import {
  validateActorOutput,
  makeValidationResult,
} from "./validation";

// JSON helpers re-used from other demos
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

// Lightweight few-shot examples (same spirit as openai-demo)
const actorExamples: FewShotExample<ActorInput, ActorOutput>[] = [
  {
    input: {
      goal: "Improve a log message.",
      userRequest: "Update the log and run tests.",
      historySummary:
        "User wants a better log message; tests should still pass.",
      filesInScope: [{ path: "app.ts", content: "console.log('Old');" }],
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

const historianExamples: FewShotExample<
  HistorianInput,
  HistorianOutput
>[] = [
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
async function fakeRunCommand(
  command: string,
  _cwd?: string
): Promise<CommandResult> {
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
    console.error(
      "OPENAI_API_KEY is not set. Please export it before running this demo."
    );
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

  const goal =
    "Improve the login logging message and ensure tests still pass.";
  const userRequest =
    "Update the console.log message in samples/Login.tsx to be more descriptive and run tests.";
  const initialHistorySummary =
    "Initial request: improve the login logging message in Login.tsx and ensure tests run.";

  console.log("=== validation-demo (OpenAI): failed attempt -> corrected attempt ===");
  console.log("\n--- Initial Login.tsx ---\n");
  console.log(loginContent);

  //
  // 1) FIRST ACTOR ATTEMPT: deliberately invalid schema (missing nextExpected)
  //
  const actorPromptInvalid = `
You are the **Actor** in a coding loop.

This is the FIRST attempt. For this first attempt ONLY, you MUST intentionally produce an INVALID ActorOutput JSON:
- Use the field "nextStep" instead of "nextExpected" at the top level.
- Otherwise follow the same structure as the example ActorOutput values.

Do NOT explain or apologize. Output JSON only.
  `.trim();

  const actorInput1: ActorInput = {
    goal,
    userRequest,
    historySummary: initialHistorySummary,
    filesInScope,
  };

  const actorOutput1 = await runActorStep(
    actorPromptInvalid,
    actorLLM,
    actorConfig,
    actorInput1,
    actorExamples,
    { temperature: 0, maxTokens: 512 }
  );

  console.log("\n--- ActorOutput (first attempt, expected invalid) ---\n");
  console.log(JSON.stringify(actorOutput1, null, 2));

  const outcome1 = validateActorOutput(actorOutput1 as any);
  const validationResult1 = makeValidationResult(
    "actor",
    outcome1,
    JSON.stringify(actorOutput1).slice(0, 400)
  );

  console.log("\n--- ValidationOutcome (first attempt) ---\n");
  console.log(outcome1);

  console.log("\n--- ValidationResult (first attempt) ---\n");
  console.log(JSON.stringify(validationResult1, null, 2));

  //
  // 2) SECOND ACTOR ATTEMPT: correct the schema based on validation failure
  //
  const correctionHint =
    outcome1.ok
      ? "Note: The previous attempt unexpectedly passed validation. Still, ensure your output remains valid."
      : "The previous attempt FAILED validation because 'nextExpected' was missing or incorrect. You must fix this.";

  const actorPromptCorrected = `
You are the **Actor** in a coding loop.

This is the SECOND attempt, after a failed schema validation of your previous ActorOutput.
You are given:
- goal, userRequest
- an updated historySummary
- lastToolResults that include a validation_result describing why the previous output was invalid.

Your job now:
- Produce a CORRECT ActorOutput JSON.
- It MUST include a valid "nextExpected" field ("user" | "tool_results" | "done").
- Its structure must match the example ActorOutput objects used in few-shot examples
  (same top-level keys, same field names, compatible data types).
- Choose actions that edit "samples/Login.tsx" and optionally run tests via a "command" action.

${correctionHint}

Rules:
- Output ONLY valid JSON for ActorOutput.
- Do not include explanations, comments, or extra fields.
  `.trim();

  const historyAfterFailure =
    "The previous Actor attempt produced an invalid ActorOutput (schema validation failed). " +
    "Now the Actor must fix the schema and move the goal forward.";

  const actorInput2: ActorInput = {
    goal,
    userRequest,
    historySummary: historyAfterFailure,
    filesInScope,
    lastToolResults: [validationResult1],
  };

  const actorOutput2 = await runActorStep(
    actorPromptCorrected,
    actorLLM,
    actorConfig,
    actorInput2,
    actorExamples,
    { temperature: 0, maxTokens: 512 }
  );

  console.log("\n--- ActorOutput (second attempt, expected corrected) ---\n");
  console.log(JSON.stringify(actorOutput2, null, 2));

  const outcome2 = validateActorOutput(actorOutput2 as any);
  const validationResult2 = makeValidationResult(
    "actor",
    outcome2,
    JSON.stringify(actorOutput2).slice(0, 400)
  );

  console.log("\n--- ValidationOutcome (second attempt) ---\n");
  console.log(outcome2);

  console.log("\n--- ValidationResult (second attempt) ---\n");
  console.log(JSON.stringify(validationResult2, null, 2));

  if (!outcome2.ok) {
    console.log(
      "\nSecond Actor attempt is still invalid. For this demo, we will not execute actions, " +
        "but we will still let the Historian summarize both validation attempts."
    );
  }

  //
  // 3) Execute actions from the corrected attempt (if valid) and gather tool results
  //
  let actionResults: ActionResult[] = [validationResult1, validationResult2];

  if (outcome2.ok) {
    const { files: updatedFiles, results } = await executeActionsInMemory(
      filesInScope,
      actorOutput2.actions as AgentAction[],
      fakeRunCommand
    );
    filesInScope = updatedFiles;
    actionResults = [...actionResults, ...results];

    console.log("\n--- Updated Login.tsx after corrected attempt ---\n");
    const updatedLogin = filesInScope.find(
      (f) => f.path === "samples/Login.tsx"
    );
    console.log(updatedLogin?.content ?? "(not found)");

    console.log("\n--- ActionResults (second attempt) ---\n");
    results.forEach((r: ActionResult, idx: number) => {
      console.log(`Result ${idx + 1}:`, JSON.stringify(r, null, 2));
    });
  }

  //
  // 4) HISTORIAN: summarize the whole story (failed attempt + corrected attempt)
  //
  const historianPrompt = `
You are the **Historian** in a coding loop.

You receive:
- goal
- previousHistorySummary that mentions there was a failed Actor schema validation
- userTurn (what the user asked for)
- actorTurn (the corrected ActorOutput from the second attempt)
- toolResults: includes one or more validation_result entries and possibly file/command results

Your job:
- Rewrite historySummary as a short mission log (~200 words or less).
- Explicitly mention that the first Actor attempt failed schema validation.
- Explicitly mention that the second Actor attempt produced a valid schema and what it changed.
- Summarize any file edits and test runs that occurred.
- Do NOT include raw JSON, stack traces, or long code snippets.

You MUST respond with a JSON object:

{
  "historySummary": string
}

Output only JSON, nothing else.
  `.trim();

  const historianInput: HistorianInput = {
    goal,
    previousHistorySummary: historyAfterFailure,
    userTurn: { message: userRequest },
    actorTurn: {
      stepSummary: actorOutput2.stepSummary,
      actions: actorOutput2.actions as AgentAction[],
      nextExpected: actorOutput2.nextExpected,
    },
    toolResults: { results: actionResults },
  };

  const historianOutput = await runHistorianUpdate(
    historianPrompt,
    historianLLM,
    historianConfig,
    historianInput,
    historianExamples,
    { temperature: 0, maxTokens: 256 }
  );

  console.log("\n--- Final historySummary (after failure + correction) ---\n");
  console.log(historianOutput.historySummary);

  console.log("\n=== validation-demo (OpenAI) complete ===");
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}