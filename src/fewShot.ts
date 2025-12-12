import {
  LLMAdapter,
  CompletionOptions,
  FewShotExample,
  FewShotConfig,
} from "./llmAdapter";

export function buildFewShotPrompt<I, O>(
  basePrompt: string,
  examples: FewShotExample<I, O>[],
  newInput: I,
  config: FewShotConfig<I, O>,
): string {
  const {
    inputLabel = "Input",
    outputLabel = "Output",
    exampleHeader = "Example",
    serializeInput,
    serializeOutput,
    includeExampleIndex = true,
    separator = "\n\n",
  } = config;

  const lines: string[] = [];

  lines.push(basePrompt.trim());

  if (examples.length > 0) {
    lines.push(
      "Here are some examples of the desired behavior. Follow the same pattern."
    );

    examples.forEach((ex, idx) => {
      const indexPrefix = includeExampleIndex ? ` ${idx + 1}` : "";
      lines.push(
        `${exampleHeader}${indexPrefix}:\n` +
        `${inputLabel}:\n${serializeInput(ex.input)}\n\n` +
        `${outputLabel}:\n${serializeOutput(ex.output)}`
      );
    });
  }

  lines.push(
    "Now respond to the following case using the same format.\n" +
    `${inputLabel}:\n${serializeInput(newInput)}\n\n` +
    `${outputLabel}:`
  );

  return lines.join(separator) + " ";
}

export async function runFewShot<I, O>(
  basePrompt: string,
  llm: LLMAdapter,
  examples: FewShotExample<I, O>[],
  newInput: I,
  config: FewShotConfig<I, O>,
  options?: CompletionOptions
): Promise<{ raw: string; parsed: O }> {
  const prompt = buildFewShotPrompt(basePrompt, examples, newInput, config);
  const raw = await llm.complete(prompt, options);
  const cleaned = raw.trim();
  const parsed = config.parseOutput(cleaned);
  return { raw: cleaned, parsed };
}