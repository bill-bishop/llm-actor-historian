This bundle contains schema-hinting support driven by the example output types.

Files:

- src/schemaHint.ts
    - describeShapeFromExamples(examples, name): derives a human-readable JSON shape description
      from a set of example outputs (e.g. ActorOutput[] or HistorianOutput[]).
    - Uses recursive merging over JSON-like values to build an approximate schema.
    - Output is a string you can splice into your base prompts so the LLM "sees"
      the structure implied by your examples, instead of hard-coded schema walls.

- src/openai-demo.ts
    - Updated version of the OpenAI demo:
      - Imports describeShapeFromExamples from ./schemaHint.
      - Builds ActorOutput and HistorianOutput shape hints from the few-shot examples:
          const actorOutputShapeHint = describeShapeFromExamples(
            actorExamples.map(e => e.output),
            "ActorOutput"
          );
          const historianOutputShapeHint = describeShapeFromExamples(
            historianExamples.map(e => e.output),
            "HistorianOutput"
          );
      - Injects those strings directly into the Actor and Historian base prompts, replacing
        hand-written schema descriptions.
      - Rest of the flow is the same: reads samples/Login.tsx, calls Actor and Historian via
        runActorStep/runHistorianUpdate, executes actions in-memory, and prints the results.

Integration:

1) Copy src/schemaHint.ts into your repo's src/ folder.
2) Replace your existing src/openai-demo.ts with the one in this zip (or merge the prompt
   construction parts if you've already customized it).
3) Rebuild and run:
     npm run build
     node dist/openai-demo.js
4) The prompts sent to the model will now contain schema hints automatically derived from your
   example outputs, keeping the contract definition in one place (the examples) instead of
   duplicated in the base prompt.