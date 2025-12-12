This bundle contains a more realistic validation-demo that uses a stable
Actor/Historian base prompt and drives retries through the actual
historySummary + lastToolResults loop.

Files:

- src/validation-demo.ts

What it demonstrates:

1) Single, stable base prompts:
   - actorBasePrompt: describes ActorInput/ActorOutput, the validator, and
     how the Actor should react when lastToolResults contains a validation_result.
   - historianBasePrompt: describes HistorianInput/Output and how to narrate
     validation_result events.

2) Realistic loop with up to 2 attempts:
   - Attempt 1:
       - Actor receives (goal, userRequest, historySummary, filesInScope, lastToolResults?).
       - We intentionally corrupt the ActorOutput BEFORE validation to simulate
         a schema error (by deleting nextExpected).
       - validateActorOutput fails, makeValidationResult emits a validation_result.
       - Historian gets toolResults = [validation_result], rewrites historySummary
         to mention the failed validation.
       - lastToolResults is set to [validation_result] for the next Actor step.
   - Attempt 2:
       - Actor receives the SAME base prompt, but now:
           - historySummary describes the earlier validation failure,
           - lastToolResults includes the validation_result.
       - Actor is expected to fix its output schema and move the goal forward.
       - validateActorOutput now passes.
       - We execute the actions (edit Login.tsx, run tests via fakeRunCommand).
       - Historian summarizes this successful step, including both the
         validation_result and the action results.
       - Loop stops.

3) The Actor never gets a special "attempt 2" prompt; all retry behavior is driven
   purely by:
   - historySummary (maintained by the Historian), and
   - lastToolResults (maintained by the executor/validator).

Usage:

1) Copy src/validation-demo.ts into your project's src/ directory,
   replacing any previous validation-demo.ts.

2) Add an npm script if needed:

   "scripts": {
     "build": "tsc",
     "test": "jest",
     "validation-demo": "npm run build && node dist/validation-demo.js"
   }

3) Ensure you have:
   - OPENAI_API_KEY set,
   - samples/Login.tsx and samples/login.test.ts present (as in openai-demo),
   - agentDomain.ts defining ActionResult (with ValidationResult, etc.),
   - validation.ts providing validateActorOutput and makeValidationResult.

4) Run:

   export OPENAI_API_KEY=sk-...
   npm run validation-demo

You should observe:
- Attempt 1: validation failure, no actions executed, Historian records failure.
- Attempt 2: Actor sees updated historySummary + lastToolResults, produces a
  corrected ActorOutput, actions execute, Historian records success.