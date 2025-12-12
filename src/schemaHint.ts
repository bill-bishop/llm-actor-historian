type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

interface ShapeNode {
  kind: "primitive" | "array" | "object";
  types?: Set<string>;
  keys?: Map<string, ShapeNode>;
  element?: ShapeNode;
}

function typeOfJson(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "string" | "number" | "boolean" | "object"
}

function mergeShapes(target: ShapeNode, value: JsonValue): void {
  const t = typeOfJson(value);

  if (t === "array") {
    target.kind = "array";
    if (!target.element) {
      target.element = { kind: "primitive", types: new Set<string>() };
    }
    for (const el of value as JsonValue[]) {
      mergeShapes(target.element, el);
    }
  } else if (t === "object" && value !== null && !Array.isArray(value)) {
    target.kind = "object";
    if (!target.keys) target.keys = new Map<string, ShapeNode>();
    const obj = value as { [k: string]: JsonValue };
    for (const [k, v] of Object.entries(obj)) {
      if (!target.keys.has(k)) {
        target.keys.set(k, { kind: "primitive", types: new Set<string>() });
      }
      mergeShapes(target.keys.get(k)!, v);
    }
  } else {
    target.kind = "primitive";
    if (!target.types) target.types = new Set<string>();
    target.types.add(t);
  }
}

function renderShape(node: ShapeNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (node.kind === "primitive") {
    const t =
      node.types && node.types.size
        ? Array.from(node.types).sort().join(" | ")
        : "unknown";
    return t;
  }

  if (node.kind === "array") {
    if (!node.element) return "array";
    return `array<${renderShape(node.element, indent)}>`;
  }

  // object
  if (!node.keys || node.keys.size === 0) return "object";

  const lines: string[] = [];
  lines.push("{");
  for (const [k, child] of node.keys) {
    const rendered = renderShape(child, indent + 1);
    lines.push(`${pad}  ${k}: ${rendered};`);
  }
  lines.push(pad + "}");
  return lines.join("\n");
}

/**
 * Given one or more example JSON values of the *same kind* (e.g. ActorOutput),
 * derive a human-readable shape description.
 */
export function describeShapeFromExamples<T>(
  examples: T[],
  name: string
): string {
  const root: ShapeNode = { kind: "primitive", types: new Set<string>() };
  for (const ex of examples) {
    mergeShapes(root, ex as JsonValue);
  }

  const shape = renderShape(root);
  return `The ${name} value must be JSON with the following approximate shape:\n${shape}`;
}