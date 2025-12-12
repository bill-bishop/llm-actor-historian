import OpenAI from "openai";
import { CompletionOptions, LLMAdapter } from "./llmAdapter";

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
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: options?.temperature,
      max_completion_tokens: options?.maxTokens,
      stop: options?.stop,
    });

    const choice = response.choices[0];
    const content = choice.message?.content;

    // If nothing came back, just return empty string
    if (!content) {
      return "";
    }

    // Most models return a plain string
    if (typeof content === "string") {
      return content;
    }

    // Some models/SDK modes may return an array of "content parts"
    // We defensively treat it as any[] and join whatever text we can find.
    const parts = content as any[];

    return parts
        .map((part: any) => {
          if (typeof part === "string") return part;
          if (typeof part?.text === "string") return part.text;
          if (typeof part?.content === "string") return part.content;
          return "";
        })
        .join("");
  }
}
