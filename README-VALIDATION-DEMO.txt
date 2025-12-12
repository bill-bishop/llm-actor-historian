This bundle contains an updated validation-demo that uses the OpenAIAdapter
and demonstrates:

1) A first Actor attempt that is deliberately INVALID (missing nextExpected).
2) A schema validation failure captured as ValidationResult (ActionResult).
3) A second Actor attempt that is instructed to correct the schema based on the validation.
4) Optional execution of the corrected actions against samples/Login.tsx.
5) A Historian pass (via OpenAIAdapter) that summarizes the whole story:
   - the failed validation,
   - the corrected Actor attempt,
   - any file edits / commands.

Files:

- src/validation-demo.ts
    - Requires:
        - src/agentDomain.ts (with ValidationResult in ActionResult union)
        - src/validation.ts (validateActorOutput, makeValidationResult)
        - src/openAIAdapter.ts
        - src/orchestrator.ts, src/actorTypes.ts, src/historianTypes.ts, src/llmAdapter.ts
        - samples/Login.tsx, samples/login.test.ts (same as in openai-demo)
    - Expects OPENAI_API_KEY in the environment.

Usage:

1) Copy src/validation-demo.ts into your project's src/ directory,
   replacing the previous validation-demo.ts if you had one.

2) Add an npm script if you haven't already, e.g.:

   "scripts": {
     "build": "tsc",
     "test": "jest",
     "validation-demo": "npm run build && node dist/validation-demo.js"
   }

3) Run:

   export OPENAI_API_KEY=sk-...
   npm run validation-demo

You should see:
- The first (invalid) ActorOutput and its failed ValidationOutcome.
- The second (corrected) ActorOutput and its successful ValidationOutcome.
- Any action results from the corrected attempt.
- A final historySummary from the Historian that mentions both the failure and correction.