import express from "express";
import path from "path";
import fs from "fs";
import {
  FileSnapshot,
  AgentAction,
  ActionResult,
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
  runHistorianUpdate,
} from "./orchestrator";
import {
  executeActionsOnDisk,
} from "./executor";
import { OpenAIAdapter } from "./openAIAdapter";
import {
  validateActorOutput,
  makeValidationResult,
} from "./validation";

const app = express();
app.use(express.json());

const projectRoot = path.join(__dirname, "..");

// Serve static dashboard assets
app.use(express.static(path.join(projectRoot, "dashboard")));

interface ChatTurn {
  id: number;
  userMessage: string;
  actorInput: ActorInput;
  actorOutput: ActorOutput;
  validationResult: ActionResult; // specifically ValidationResult
  toolResults: ActionResult[];
  historianInput: HistorianInput;
  historianOutput: HistorianOutput;
}

interface ChatSession {
  id: string;
  goal: string;
  historySummary: string;
  filesInScope: FileSnapshot[];
  lastToolResults?: ActionResult[];
  turns: ChatTurn[];
  dryRun: boolean;
}

const sessions = new Map<string, ChatSession>();

// ---------- LLM + few-shot config ----------

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
  {
    // Demonstrates dynamic add_file_to_scope usage
    input: {
      goal: "Inspect a config file and summarize its contents.",
      userRequest: "Figure out what's in config/app.json.",
      historySummary:
        "User wants a summary of config/app.json but it is not yet in scope.",
      filesInScope: [],
      lastToolResults: [],
    },
    output: {
      stepSummary:
        "Add config/app.json to scope so I can read and summarize it next.",
      actions: [
        {
          kind: "add_file_to_scope",
          path: "config/app.json",
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

const actorBasePrompt = `
You are the **Actor** in a coding loop for editing code and running tests.

You receive an ActorInput JSON and must respond with an ActorOutput JSON.

ActorInput fields:
- goal: overall objective for this session.
- userRequest: most recent high-level request from the user.
- historySummary: short narrative of what has happened so far.
- filesInScope: current working set of files you are allowed to edit.
- lastToolResults: (optional) ActionResult[] from the previous step
  (e.g. validation failures, file edit results, command results,
   file_added_to_scope_result, etc).

ActorOutput fields (as seen in the examples):
- stepSummary: short description of what you will do this step.
- actions: an array of actions to take in this step:
  - file_edit
  - command
  - message_to_user
  - add_file_to_scope
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
   - If lastToolResults contains a file_added_to_scope_result, note whether
     the file was successfully added and plan the next step accordingly.
2. Propose a small, coherent set of actions to move the goal forward.
3. Use actions:
   - file_edit for concrete code edits in filesInScope.
   - command for running tests or other shell commands.
   - add_file_to_scope when you need to read or edit a file that is not
     yet present in filesInScope (it will be loaded from disk if it exists).
   - message_to_user when you need to ask the user something directly.
4. Set nextExpected:
   - "tool_results" if you want to see the outcome of your actions.
   - "user" if you expect the next step to be a user message.
   - "done" only if the goal is fully satisfied.

IMPORTANT:
- Output ONLY JSON for ActorOutput, no extra commentary.
- Match the structure of the ActorOutput examples exactly
  (same top-level keys, same field names, compatible types).
`.trim();

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
  - file_added_to_scope_result

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
- When you see a file_added_to_scope_result:
  - Note whether the file was successfully added to the working set or not.

You MUST respond with JSON of the shape:

{
  "historySummary": string
}

Output only JSON, no extra commentary.
`.trim();

// Instantiate LLMs once
function makeActorLLM(): LLMAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAIAdapter({
    apiKey,
    model: "gpt-4.1-mini",
  });
}

function makeHistorianLLM(): LLMAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAIAdapter({
    apiKey,
    model: "gpt-4.1-mini",
  });
}

const actorLLM = makeActorLLM();
const historianLLM = makeHistorianLLM();

// ---------- Helpers ----------

function loadInitialFiles(paths: string[]): FileSnapshot[] {
  const snapshots: FileSnapshot[] = [];
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(projectRoot, p);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    snapshots.push({
      path: p,
      content,
    });
  }
  return snapshots;
}

function createSessionId(): string {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

// ---------- Routes ----------

app.post("/api/session", (req, res) => {
  try {
    const { goal, initialFiles, dryRun } = req.body || {};
    if (!goal || typeof goal !== "string") {
      return res.status(400).json({ error: "goal (string) is required" });
    }
    const files: string[] = Array.isArray(initialFiles)
      ? initialFiles.filter((p) => typeof p === "string")
      : [];

    const filesInScope = loadInitialFiles(files);
    const sessionId = createSessionId();

    const session: ChatSession = {
      id: sessionId,
      goal,
      historySummary:
        "Session started. No actions have been taken yet.",
      filesInScope,
      lastToolResults: undefined,
      turns: [],
      dryRun: typeof dryRun === "boolean" ? dryRun : true,
    };

    sessions.set(sessionId, session);

    return res.json(session);
  } catch (err: any) {
    console.error("Error creating session", err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get("/api/session/:id", (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  return res.json(session);
});

app.post("/api/session/:id/user-turn", async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message (string) is required" });
  }

  try {
    const userRequest = message;
    const goal = session.goal;
    const historySummary = session.historySummary;
    const filesInScope = session.filesInScope;
    const lastToolResultsFromSession = session.lastToolResults;
    const dryRun = session.dryRun;
    const projectRootLocal = projectRoot;

    // We'll allow the Actor a few attempts to fix bad schema
    // before we give up and let the Historian log the failure.
    const maxValidationAttempts = 3;

    let actorInput: ActorInput = {
      goal,
      userRequest,
      historySummary,
      filesInScope,
      lastToolResults: lastToolResultsFromSession,
    };

    let actorOutput: ActorOutput | null = null;
    let stepToolResults: ActionResult[] = [];
    let newFilesInScope = filesInScope;
    let lastValidationOutcome: { ok: boolean; errors?: string[] } | null = null;

    for (let attempt = 0; attempt < maxValidationAttempts; attempt++) {
      actorOutput = await runActorStep(
        actorBasePrompt,
        actorLLM,
        actorConfig,
        actorInput,
        actorExamples,
        { temperature: 0, maxTokens: 768 }
      );

      const validationOutcome = validateActorOutput(actorOutput);
      lastValidationOutcome = validationOutcome;
      const validationResult = makeValidationResult(
        "actor",
        validationOutcome,
        JSON.stringify(actorOutput).slice(0, 400)
      );

      // Record this attempt's validation_result so the Historian can see
      // how many times the Actor struggled with schema.
      stepToolResults.push(validationResult);

      if (validationOutcome.ok) {
        // Only once we have a valid schema do we actually execute tools.
        const execResult = await executeActionsOnDisk(
          newFilesInScope,
          actorOutput.actions as AgentAction[],
          {
            projectRoot: projectRootLocal,
            dryRun,
          }
        );
        newFilesInScope = execResult.files;
        stepToolResults.push(...execResult.results);
        break;
      }

      // Prepare a new ActorInput that includes this validation failure
      // so the Actor can correct its own schema next attempt.
      actorInput = {
        ...actorInput,
        lastToolResults: [validationResult],
      };
    }

    if (!actorOutput) {
      // Extremely defensive: should never happen because we always
      // attempt at least once above.
      return res
        .status(500)
        .json({ error: "Actor did not produce any output" });
    }

    const historianInput: HistorianInput = {
      goal,
      previousHistorySummary: historySummary,
      userTurn: { message: userRequest },
      actorTurn: {
        stepSummary: actorOutput.stepSummary,
        actions: actorOutput.actions as AgentAction[],
        nextExpected: actorOutput.nextExpected,
      },
      toolResults: { results: stepToolResults },
    };

    const historianOutput = await runHistorianUpdate(
      historianBasePrompt,
      historianLLM,
      historianConfig,
      historianInput,
      historianExamples,
      { temperature: 0, maxTokens: 512 }
    );

    session.historySummary = historianOutput.historySummary;
    session.lastToolResults = stepToolResults;
    session.filesInScope = newFilesInScope;

    // For the ChatTurn, we keep the final ActorInput (which may contain
    // a validation_result in lastToolResults) and the final ActorOutput.
    const finalValidationResult =
      stepToolResults.find((r) => r.kind === "validation_result") ||
      makeValidationResult(
        "actor",
        (lastValidationOutcome && { ...lastValidationOutcome, errors: lastValidationOutcome.errors ?? [] }) || { ok: true, errors: [] },
        "No explicit validation_result recorded."
      );

    const turn: ChatTurn = {
      id: session.turns.length,
      userMessage: userRequest,
      actorInput,
      actorOutput,
      validationResult: finalValidationResult as ActionResult,
      toolResults: stepToolResults,
      historianInput,
      historianOutput,
    };

    session.turns.push(turn);

    return res.json(session);
  } catch (err: any) {
    console.error("Error running user turn", err);
    return res.status(500).json({ error: String(err) });
  }
});

// Fallback: serve dashboard by default at root
app.get("/", (_req, res) => {
  res.sendFile(path.join(projectRoot, "dashboard", "chat-dashboard.html"));
});

export function startChatServer(port: number = 4000) {
  app.listen(port, () => {
    console.log(
      `Chat server listening on http://localhost:${port} (dashboard at /)`
    );
  });
}

// If run directly: start the server.
if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  startChatServer(port);
}