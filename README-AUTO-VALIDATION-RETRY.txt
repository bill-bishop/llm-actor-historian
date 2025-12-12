
Update: auto-retry on invalid Actor schema
=========================================

This patch changes the core `/api/session/:id/user-turn` loop so that
**validation failures are handled inside the tool loop**, not by the UX.

Behavior:

- On each user turn, the server:
  1. Builds an ActorInput from session state.
  2. Calls the Actor LLM.
  3. Validates the ActorOutput schema.
  4. If validation fails:
     - Emits a `validation_result` ActionResult.
     - Pushes it into `stepToolResults`.
     - Builds a new ActorInput whose `lastToolResults` is **that
       validation_result**, so the Actor can fix its own shape.
     - Repeats, up to `maxValidationAttempts` (currently 3).
  5. Once validation passes:
     - Executes actions via `executeActionsOnDisk`, gathering
       `file_edit_result`, `command_result`, `file_added_to_scope_result`, etc.
     - Appends those to `stepToolResults`.

- The Historian always sees the full `stepToolResults` array, including:
  - All `validation_result` entries (for failed attempts),
  - The executor results for the final valid attempt (if any).

- The session state is then updated:
  - `historySummary` via HistorianOutput,
  - `lastToolResults` = all `stepToolResults`,
  - `filesInScope` = final executor snapshots.

- The ChatTurn stores:
  - `actorInput`: the **final** ActorInput used,
  - `actorOutput`: the ActorOutput from the **last attempt**,
  - `validationResult`: the first `validation_result` found in
    `stepToolResults` (or a synthesized one),
  - `toolResults`: the entire `stepToolResults`,
  - `historianInput` / `historianOutput`.

Net effect:

- Schema errors from the Actor no longer require another user message.
- The Actor is given a chance (up to 3 tries) to self-correct based on
  the `validation_result` surfaced in `lastToolResults`.
- The Historian logs those failures as part of the mission log, so the
  loop behavior is fully transparent and lives in the **core** actor /
  historian / executor loop instead of in the dashboard UX.
