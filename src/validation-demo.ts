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

// ---------- JSON helpers ----------

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

// ---------- Few-shot examples (same spirit as openai-demo) ----------

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

// ---------- Helpers ----------

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

/**
 * For this demo, we intentionally corrupt the first ActorOutput before
 * validation to simulate a schema failure. In a real system the LLM might
 * produce this kind of mistake naturally.
 */
function corruptActorOutputForDemo(output: ActorOutput): any {
  const copy: any = JSON.parse(JSON.stringify(output));
  // Remove nextExpected to trigger a validation error.
  delete copy.nextExpected;
  return copy;
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
  let historySummary =
    "Initial request: improve the login logging message in Login.tsx and ensure tests run.";
  let lastToolResults: ActionResult[] | undefined;

  console.log("=== validation-demo (realistic loop) ===");
  console.log("\n--- Initial Login.tsx ---\n");
  console.log(loginContent);

  // Single, stable base prompt for the Actor across all attempts.
  const actorBasePrompt = `
You are the **Actor** in a coding loop for editing code and running tests.

You receive an ActorInput JSON and must respond with an ActorOutput JSON.

ActorInput fields:
- goal: overall objective for this session.
- userRequest: most recent high-level request from the user.
- historySummary: short narrative of what has happened so far.
- filesInScope: current working set of files you are allowed to edit.
- lastToolResults: (optional) ActionResult[] from the previous step
  (e.g. validation failures, file edit results, command results).

ActorOutput fields (as seen in the examples):
- stepSummary: short description of what you will do this step.
- actions: an array of actions to take in this step:
  - file_edit
  - command
  - message_to_user
  - add_file_to_scope (if available in the domain)
- nextExpected: "user" | "tool_results" | "done"

There is a schema validator sitting between you and the tools.
If you produce an invalid ActorOutput (wrong field names, wrong types,
missing required keys like nextExpected), the validator will emit a
validation_result in the next step's lastToolResults, and your actions
will NOT be executed.

Your job on each step:
1. Read goal, userRequest, historySummary, filesInScope, and lastToolResults.
   - If lastToolResults contains a validation_result, carefully fix your
     output structure so that validation will pass next time.
2. Propose a small, coherent set of actions to move the goal forward.
3. Set nextExpected:
   - "tool_results" if you want to see the outcome of your actions.
   - "done" only if the goal is fully satisfied.

IMPORTANT:
- Output ONLY JSON for ActorOutput, no extra commentary.
- Match the structure of the ActorOutput examples exactly
  (same top-level keys, same field names, compatible types).
  `.trim();

  // Single, stable base prompt for the Historian across all attempts.
  const historianBasePrompt = `
You are the **Historian** in a coding loop.

You receive a HistorianInput JSON and must respond with a HistorianOutput JSON.

HistorianInput fields:
- goal
- previousHistorySummary
- userTurn
- actorTurn
- toolResults: ActionResult[] for the current step, which may include:
  - file_edit_result
  - command_result
  - validation_result
  - file_added_to_scope_result (if used in the domain)

Your job:
- Rewrite historySummary from scratch as a short mission log (<= ~200 words),
  including:
  - the goal,
  - the latest user request,
  - what the Actor attempted this step (stepSummary + actions),
  - what worked and what failed (from toolResults).
- When you see a validation_result:
  - Explicitly note that the Actor's previous output failed or passed validation,
    and why that matters for the session.

You MUST respond with JSON of the shape:

{
  "historySummary": string
}

Output only JSON, no extra commentary.
  `.trim();

  //
  // Realistic loop: up to 2 attempts.
  // Attempt 1: we intentionally corrupt the Actor output before validation
  // to simulate a schema failure. Historian records that failure.
  // Attempt 2: Actor sees lastToolResults + updated historySummary and
  // produces a corrected output which we then execute.
  //

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`\n=== Actor attempt ${attempt} ===`);

    const actorInput: ActorInput = {
      goal,
      userRequest,
      historySummary,
      filesInScope,
      lastToolResults,
    };

    const rawActorOutput = await runActorStep(
      actorBasePrompt,
      actorLLM,
      actorConfig,
      actorInput,
      actorExamples,
      { temperature: 0, maxTokens: 512 }
    );

    console.log("\n--- Raw ActorOutput ---\n");
    console.log(JSON.stringify(rawActorOutput, null, 2));

    // For attempt 1 only, corrupt the output to force a validation failure.
    const outputForValidation: any =
      attempt === 1 ? corruptActorOutputForDemo(rawActorOutput) : rawActorOutput;

    const validationOutcome = validateActorOutput(outputForValidation);
    const validationResult = makeValidationResult(
      "actor",
      validationOutcome,
      JSON.stringify(outputForValidation).slice(0, 400)
    );

    console.log("\n--- ValidationOutcome ---\n");
    console.log(validationOutcome);

    console.log("\n--- ValidationResult ---\n");
    console.log(JSON.stringify(validationResult, null, 2));

    let stepToolResults: ActionResult[] = [validationResult];

    // Only execute actions if validation passed.
    if (validationOutcome.ok) {
      const { files: updatedFiles, results } = await executeActionsInMemory(
        filesInScope,
        rawActorOutput.actions as AgentAction[],
        fakeRunCommand
      );
      filesInScope = updatedFiles;
      stepToolResults = [...stepToolResults, ...results];

      console.log("\n--- Updated Login.tsx ---\n");
      const updatedLogin = filesInScope.find(
        (f) => f.path === "samples/Login.tsx"
      );
      console.log(updatedLogin?.content ?? "(not found)");

      console.log("\n--- ActionResults ---\n");
      results.forEach((r: ActionResult, idx: number) => {
        console.log(`Result ${idx + 1}:`, JSON.stringify(r, null, 2));
      });
    } else {
      console.log(
        "\nValidation failed; actions will NOT be executed for this attempt."
      );
    }

    // Historian summarizes this step, including validation result.
    const historianInput: HistorianInput = {
      goal,
      previousHistorySummary: historySummary,
      userTurn: { message: userRequest },
      actorTurn: {
        stepSummary: rawActorOutput.stepSummary,
        actions: rawActorOutput.actions as AgentAction[],
        nextExpected: rawActorOutput.nextExpected,
      },
      toolResults: { results: stepToolResults },
    };

    const historianOutput = await runHistorianUpdate(
      historianBasePrompt,
      historianLLM,
      historianConfig,
      historianInput,
      historianExamples,
      { temperature: 0, maxTokens: 256 }
    );

    historySummary = historianOutput.historySummary;
    lastToolResults = stepToolResults;

    console.log("\n--- Updated historySummary ---\n");
    console.log(historySummary);

    if (validationOutcome.ok) {
      console.log(
        "\nValidation passed on this attempt; demo loop will stop here."
      );
      break;
    } else if (attempt === 1) {
      console.log(
        "\nValidation failed on attempt 1; proceeding to attempt 2 " +
          "with updated historySummary + lastToolResults."
      );
    } else {
      console.log(
        "\nValidation still failing after the maximum number of attempts."
      );
    }
  }

  console.log("\n=== validation-demo (realistic loop) complete ===");
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}