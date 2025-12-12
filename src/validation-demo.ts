import {
  LLMAdapter,
  CompletionOptions,
  FewShotConfig,
} from "./llmAdapter";
import {
  ActorInput,
  ActorOutput,
} from "./actorTypes";
import {
  HistorianInput,
  HistorianOutput,
} from "./historianTypes";
import {
  FileSnapshot,
  ActionResult,
} from "./agentDomain";
import {
  validateActorOutput,
  makeValidationResult,
} from "./validation";
import { runHistorianUpdate } from "./orchestrator";

// Simple JSON helpers
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

// Mock Actor that returns INVALID JSON shape: uses "nextStep" instead of "nextExpected".
class InvalidActorAdapter implements LLMAdapter {
  async complete(_prompt: string, _options?: CompletionOptions): Promise<string> {
    const invalid = {
      stepSummary: "Oops, I used the wrong field name.",
      actions: [],
      // <-- wrong key on purpose
      nextStep: "tool_results",
    };
    return JSON.stringify(invalid, null, 2);
  }
}

// Mock Historian that just echoes the validation failure into historySummary.
class MockHistorianAdapter implements LLMAdapter {
  async complete(_prompt: string, _options?: CompletionOptions): Promise<string> {
    const output: HistorianOutput = {
      historySummary:
        "Previous Actor output failed schema validation (missing 'nextExpected'). " +
        "In the next attempt, the Actor must output a valid ActorOutput JSON with " +
        "a 'nextExpected' field and correctly shaped actions.",
    };
    return JSON.stringify(output, null, 2);
  }
}

async function main() {
  const goal = "Demo schema validation of the Actor output.";
  const userRequest =
    "Please propose some actions (this is a fake request for the demo).";
  const initialHistorySummary =
    "We are testing validation failures for the Actor.";
  const filesInScope: FileSnapshot[] = [
    {
      path: "samples/Login.tsx",
      content: "// not used in this demo",
      language: "tsx",
    },
  ];

  const actorInput: ActorInput = {
    goal,
    userRequest,
    historySummary: initialHistorySummary,
    filesInScope,
  };

  const actorBasePrompt = `
You are the Actor in a coding loop.
(For this demo, your output will intentionally be invalid; the validator will catch it.)
Always respond with ActorOutput JSON (but here we are mocking it).
  `.trim();

  const actorLLM = new InvalidActorAdapter();

  console.log("=== validation-demo: Actor invalid output ===");

  // For this demo, we bypass runActorStep and call the mock directly,
  // then parse using the same JSON parser we use in few-shot.
  const rawActor = await actorLLM.complete(actorBasePrompt);
  console.log("\n--- Raw Actor JSON (invalid) ---\n");
  console.log(rawActor);

  const actorOutput = jsonParser<ActorOutput>(rawActor); // structurally wrong

  const outcome = validateActorOutput(actorOutput as any);
  const validationResult = makeValidationResult(
    "actor",
    outcome,
    rawActor.slice(0, 200)
  );

  console.log("\n--- ValidationOutcome ---\n");
  console.log(outcome);

  console.log("\n--- ValidationResult (ActionResult) ---\n");
  console.log(JSON.stringify(validationResult, null, 2));

  if (outcome.ok) {
    console.log("\n(Unexpected) Actor output passed validation.");
    return;
  }

  // Now pretend this validationResult is a "tool result" and hand it to Historian.
  const historianInput: HistorianInput = {
    goal,
    previousHistorySummary: initialHistorySummary,
    userTurn: { message: userRequest },
    // No actorTurn, since the Actor output was invalid.
    toolResults: {
      results: [validationResult as ActionResult],
    },
  };

  const historianLLM = new MockHistorianAdapter();
  const historianBasePrompt = `
You are the Historian in a coding loop.
You see that the Actor's last output failed schema validation. Update the mission log.
  `.trim();

  const historianOutput = await runHistorianUpdate(
    historianBasePrompt,
    historianLLM,
    historianConfig,
    historianInput,
  );

  console.log("\n--- New historySummary after validation failure ---\n");
  console.log(historianOutput.historySummary);

  console.log(
    "\n(In a real loop, this updated historySummary + validationResult " +
      "would be fed into the next ActorInput.lastToolResults to encourage " +
      "the Actor to fix its schema on the next attempt.)"
  );

  console.log("\n=== validation-demo complete ===");
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}