import { ActorOutput } from "./actorTypes";
import { HistorianOutput } from "./historianTypes";
import { ValidationResult } from "./agentDomain";

export interface ValidationOutcome {
  ok: boolean;
  errors: string[];
}

/**
 * Very lightweight runtime validation of ActorOutput.
 * This is NOT trying to be perfect, just enough to catch structural mistakes
 * like missing nextExpected, wrong kinds, or non-array actions.
 */
export function validateActorOutput(value: any): ValidationOutcome {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["ActorOutput must be an object"] };
  }

  // stepSummary is optional but if present must be string
  if (
    "stepSummary" in value &&
    typeof value.stepSummary !== "string"
  ) {
    errors.push("stepSummary must be a string if present");
  }

  if (!("actions" in value)) {
    errors.push("Missing 'actions' field");
  } else if (!Array.isArray(value.actions)) {
    errors.push("'actions' must be an array");
  } else {
    // Basic per-action checks
    for (let i = 0; i < value.actions.length; i++) {
      const a = value.actions[i];
      if (typeof a !== "object" || a === null) {
        errors.push(`actions[${i}] must be an object`);
        continue;
      }
      if (
        a.kind !== "message_to_user" &&
        a.kind !== "file_edit" &&
        a.kind !== "command"
      ) {
        errors.push(`actions[${i}].kind is invalid: ${String(a.kind)}`);
      }
    }
  }

  if (!("nextExpected" in value)) {
    errors.push("Missing 'nextExpected' field");
  } else if (
    value.nextExpected !== "user" &&
    value.nextExpected !== "tool_results" &&
    value.nextExpected !== "done"
  ) {
    errors.push(
      `nextExpected must be "user" | "tool_results" | "done", got ${String(
        value.nextExpected
      )}`
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Simple validation that HistorianOutput has a non-empty historySummary string.
 */
export function validateHistorianOutput(value: any): ValidationOutcome {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["HistorianOutput must be an object"] };
  }

  if (typeof value.historySummary !== "string") {
    errors.push("historySummary must be a string");
  } else if (!value.historySummary.trim()) {
    errors.push("historySummary must not be empty");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Turn a ValidationOutcome into a ValidationResult ActionResult.
 */
export function makeValidationResult(
  target: "actor" | "historian",
  outcome: ValidationOutcome,
  rawOutputSnippet?: string
): ValidationResult {
  return {
    kind: "validation_result",
    target,
    success: outcome.ok,
    errors: outcome.ok ? undefined : outcome.errors,
    rawOutputSnippet,
  };
}