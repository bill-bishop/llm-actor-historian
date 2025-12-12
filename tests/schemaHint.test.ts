import { describeShapeFromExamples } from "../src/schemaHint";

describe("describeShapeFromExamples", () => {
  it("describes a simple ActorOutput-like shape", () => {
    const examples = [
      {
        stepSummary: "First step",
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
      {
        stepSummary: "Second step",
        actions: [],
        nextExpected: "done",
      },
    ];

    const hint = describeShapeFromExamples(examples as any, "ActorOutput");

    expect(hint).toContain("ActorOutput");
    expect(hint).toContain("stepSummary");
    expect(hint).toContain("actions: array<");
    expect(hint).toContain("nextExpected");
  });

  it("merges primitive type unions correctly", () => {
    const examples = [
      { value: 1 },
      { value: 2 },
      { value: "three" },
    ];

    const hint = describeShapeFromExamples(examples as any, "UnionExample");

    // We expect the 'value' field to show both number and string in some order.
    expect(hint).toContain("value:");
    // Order is deterministic (sorted), but we allow either just in case of future changes.
    const hasNumberString = hint.includes("number | string");
    const hasStringNumber = hint.includes("string | number");
    expect(hasNumberString || hasStringNumber).toBe(true);
  });

  it("handles nested object shapes", () => {
    const examples = [
      {
        outer: {
          inner: {
            flag: true,
            count: 1,
          },
        },
      },
    ];

    const hint = describeShapeFromExamples(examples as any, "NestedExample");

    expect(hint).toContain("outer:");
    expect(hint).toContain("inner:");
    expect(hint).toContain("flag: boolean");
    expect(hint).toContain("count: number");
  });
});