"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("../src/orchestrator");
class MockAdapter {
    constructor() {
        this.lastPrompt = null;
        this.nextOutput = null;
    }
    async complete(prompt, _options) {
        this.lastPrompt = prompt;
        if (!this.nextOutput) {
            throw new Error("MockAdapter.nextOutput must be set before calling complete.");
        }
        return JSON.stringify(this.nextOutput, null, 2);
    }
}
const jsonSerializer = (v) => JSON.stringify(v, null, 2);
const jsonParser = (raw) => JSON.parse(raw);
const historianConfig = {
    serializeInput: jsonSerializer,
    serializeOutput: jsonSerializer,
    parseOutput: jsonParser,
    inputLabel: "Input",
    outputLabel: "Output",
};
describe("runHistorianUpdate", () => {
    const basePrompt = `
You are the Historian in a coding loop.
You maintain historySummary as the single mission log.
Each call, you receive: goal, previousHistorySummary, and possibly userTurn,
actorTurn, and toolResults. You must rewrite historySummary from scratch,
keeping it under a fixed word limit, and include key attempts, successes,
failures, and decisions.
Always respond with a JSON object matching HistorianOutput.
  `.trim();
    it("returns a rewritten history summary", async () => {
        const adapter = new MockAdapter();
        const actions = [
            {
                kind: "file_edit",
                path: "Login.tsx",
                mode: "replace_file",
                newContent: "console.log('Improved');",
            },
            {
                kind: "command",
                command: "npm test",
                purpose: "run_tests",
            },
        ];
        const input = {
            goal: "Improve login logging.",
            previousHistorySummary: "Initial request: improve logging.",
            userTurn: { message: "Please change the log message and run tests." },
            actorTurn: {
                stepSummary: "We will change console log and run tests.",
                actions,
                nextExpected: "tool_results",
            },
            toolResults: {
                results: [
                    {
                        kind: "file_edit_result",
                        path: "Login.tsx",
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
        };
        adapter.nextOutput = {
            historySummary: "User asked to improve login logging. We updated Login.tsx and tests passed.",
        };
        const out = await (0, orchestrator_1.runHistorianUpdate)(basePrompt, adapter, historianConfig, input);
        expect(out.historySummary).toContain("updated Login.tsx");
        expect(adapter.lastPrompt).toBeTruthy();
    });
});
