Updated validation.ts to allow the Actor to emit an `add_file_to_scope` action.

Change:
- In validateActorOutput, `actions[i].kind` is now allowed to be:
  - "message_to_user"
  - "file_edit"
  - "command"
  - "add_file_to_scope"

This fixes runtime validation errors like:
  actions[1].kind is invalid: add_file_to_scope
