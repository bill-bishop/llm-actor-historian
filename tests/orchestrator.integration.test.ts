import { FileSnapshot, AgentAction, ActionResult } from "../src/agentDomain";
import { ActorInput, ActorOutput } from "../src/actorTypes";
import {
  HistorianInput,
  HistorianOutput,
} from "../src/historianTypes";
import {
  LLMAdapter,
  CompletionOptions,
  FewShotConfig,
} from "../src/llmAdapter";
import {
  runActorStep,
  runHistorianUpdate,
  executeActionsInMemory,
} from "../src/orchestrator";

class MockAdapterActor implements LLMAdapter {
  public nextOutput: ActorOutput | null = null;
  async complete(_prompt: string, _options?: CompletionOptions): Promise<string> {
    if (!this.nextOutput) {
      throw new Error("MockAdapterActor.nextOutput must be set.");
    }
    return JSON.stringify(this.nextOutput, null, 2);
  }
}

class MockAdapterHistorian implements LLMAdapter {
  public nextOutput: HistorianOutput | null = null;
  async complete(_prompt: string, _options?: CompletionOptions): Promise<string> {
    if (!this.nextOutput) {
      throw new Error("MockAdapterHistorian.nextOutput must be set.");
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

const historianConfig: FewShotConfig<HistorianInput, HistorianOutput> = {
  serializeInput: jsonSerializer,
  serializeOutput: jsonSerializer,
  parseOutput: jsonParser,
  inputLabel: "Input",
  outputLabel: "Output",
};

describe("Actor + Historian integration", () => {
  const actorPrompt = `
You are the Actor in a coding loop.
Decide actions and nextExpected based on the given ActorInput.
Always respond with ActorOutput JSON.
  `.trim();

  const historianPrompt = `
You are the Historian in a coding loop.
Update historySummary given previousHistorySummary and the latest events.
Always respond with HistorianOutput JSON.
  `.trim();

  it("runs one round: actor -> tool_results -> historian", async () => {
    const actorAdapter = new MockAdapterActor();
    const historianAdapter = new MockAdapterHistorian();

    let filesInScope: FileSnapshot[] = [
      { path: "Login.tsx", content: "console.log('old');" },
    ];

    const actorInput: ActorInput = {
      goal: "Improve login logging.",
      userRequest: "Change log and run tests.",
      historySummary: "Initial request: improve logging.",
      filesInScope,
    };

    actorAdapter.nextOutput = {
      stepSummary: "Change log and run tests.",
      actions: [
        {
          kind: "file_edit",
          path: "Login.tsx",
          mode: "replace_file",
          newContent: "console.log('improved');",
        },
        {
          kind: "command",
          command: "npm test",
          purpose: "run_tests",
        },
      ],
      nextExpected: "tool_results",
    };

    const actorOut = await runActorStep(
      actorPrompt,
      actorAdapter,
      actorConfig,
      actorInput,
    );

    const { files: updatedFiles, results: actionResults } =
      await executeActionsInMemory(filesInScope, actorOut.actions);

    filesInScope = updatedFiles;

    const historianInput: HistorianInput = {
      goal: actorInput.goal,
      previousHistorySummary: actorInput.historySummary,
      userTurn: { message: actorInput.userRequest },
      actorTurn: {
        stepSummary: actorOut.stepSummary,
        actions: actorOut.actions,
        nextExpected: actorOut.nextExpected,
      },
      toolResults: { results: actionResults },
    };

    historianAdapter.nextOutput = {
      historySummary:
        "We improved login logging and tests passed (if npm test succeeded).",
    };

    const historianOut = await runHistorianUpdate(
      historianPrompt,
      historianAdapter,
      historianConfig,
      historianInput,
    );

    expect(filesInScope[0].content).toContain("improved");
    expect(actionResults).toHaveLength(2);
    expect(historianOut.historySummary).toContain("improved login logging");
  });
});