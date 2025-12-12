import {
  LLMAdapter,
  CompletionOptions,
  FewShotConfig,
} from "../src/llmAdapter";
import { ActorInput, ActorOutput } from "../src/actorTypes";
import { FileSnapshot } from "../src/agentDomain";
import { runActorStep } from "../src/orchestrator";

class MockAdapter implements LLMAdapter {
  public lastPrompt: string | null = null;
  public nextOutput: ActorOutput | null = null;

  async complete(prompt: string, _options?: CompletionOptions): Promise<string> {
    this.lastPrompt = prompt;
    if (!this.nextOutput) {
      throw new Error("MockAdapter.nextOutput must be set before calling complete.");
    }
    return JSON.stringify(this.nextOutput, null, 2);
  }
}

const jsonSerializer = <T>(v: T) => JSON.stringify(v, null, 2);
const jsonParser = <T>(raw: string): T => JSON.parse(raw) as T;

const actorConfig: FewShotConfig<ActorInput, ActorOutput> = {
  serializeInput: jsonSerializer,
  serializeOutput: jsonSerializer,
  parseOutput: jsonParser,
  inputLabel: "Input",
  outputLabel: "Output",
};

describe("runActorStep", () => {
  const basePrompt = `
You are the Actor in a coding loop.
You see: goal, userRequest, historySummary, filesInScope, lastToolResults.
You must decide a sequence of actions and a nextExpected.
You MUST NOT modify historySummary; you only read it.
Always respond with a JSON object matching ActorOutput.
  `.trim();

  it("returns the parsed ActorOutput from the adapter", async () => {
    const adapter = new MockAdapter();

    const filesInScope: FileSnapshot[] = [
      { path: "Login.tsx", content: "console.log('Login submitted');" },
    ];

    const input: ActorInput = {
      goal: "Improve login logging.",
      userRequest: "Please change log message.",
      historySummary: "User asked to improve logging.",
      filesInScope,
    };

    adapter.nextOutput = {
      stepSummary: "Change log message and run tests.",
      actions: [
        {
          kind: "file_edit",
          path: "Login.tsx",
          mode: "replace_range",
          range: { startOffset: 0, endOffset: 40 },
          rangeNewText: "console.log('Improved login submitted');",
        },
        {
          kind: "command",
          command: "npm test",
          purpose: "run_tests",
        },
      ],
      nextExpected: "tool_results",
    };

    const out = await runActorStep(
      basePrompt,
      adapter,
      actorConfig,
      input,
    );

    expect(out.nextExpected).toBe("tool_results");
    expect(out.actions).toHaveLength(2);
    expect(out.stepSummary).toContain("Change log message");
    expect(adapter.lastPrompt).toBeTruthy();
  });
});