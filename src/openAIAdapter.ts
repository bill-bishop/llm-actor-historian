import OpenAI from "openai";
import { CompletionOptions, LLMAdapter } from "./llmAdapter";
import { logLLMInteraction } from "./logging";

export interface OpenAIAdapterConfig {
  apiKey?: string;
  model: string;
}

export class OpenAIAdapter implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor(config: OpenAIAdapterConfig) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAIAdapter: OPENAI_API_KEY is not set and no apiKey was provided."
      );
    }

    this.client = new OpenAI({ apiKey });
    this.model = config.model;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const start = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
        stop: options?.stop,
      });

      const choice = response.choices[0];
      const content = choice.message?.content;

      let text: string;

      if (!content) {
        text = "";
      } else if (typeof content === "string") {
        text = content;
      } else {
        const parts = content as any[];
        text = parts
          .map((part: any) => {
            if (typeof part === "string") return part;
            if (typeof part?.text === "string") return part.text;
            if (typeof part?.content === "string") return part.content;
            return "";
          })
          .join("");
      }

      const usage = (response as any).usage;

      logLLMInteraction({
        timestamp: new Date().toISOString(),
        adapterName: "OpenAIAdapter",
        model: this.model,
        runId,
        prompt,
        completion: text,
        options,
        usage: usage
          ? {
              promptTokens:
                typeof usage.prompt_tokens === "number"
                  ? usage.prompt_tokens
                  : usage.promptTokens,
              completionTokens:
                typeof usage.completion_tokens === "number"
                  ? usage.completion_tokens
                  : usage.completionTokens,
              totalTokens:
                typeof usage.total_tokens === "number"
                  ? usage.total_tokens
                  : usage.totalTokens,
            }
          : undefined,
        durationMs: Date.now() - start,
      });

      return text;
    } catch (err: any) {
      logLLMInteraction({
        timestamp: new Date().toISOString(),
        adapterName: "OpenAIAdapter",
        model: this.model,
        runId,
        prompt,
        completion: "",
        options,
        usage: undefined,
        durationMs: Date.now() - start,
        errorMessage: err?.message ?? String(err),
      });
      throw err;
    }
  }
}