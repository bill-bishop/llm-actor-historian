import * as fs from "fs";
import * as path from "path";
import { CompletionOptions, LLMAdapter } from "./llmAdapter";

export interface LLMUsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LLMLogRecord {
  timestamp: string;
  adapterName: string;
  model?: string;
  runId: string;
  prompt: string;
  completion: string;
  options?: CompletionOptions;
  usage?: LLMUsageInfo;
  durationMs?: number;
  errorMessage?: string;
}

const LOG_DIR = path.resolve(__dirname, "..", "logs");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Append a single JSON line to the daily LLM log file.
 */
export function logLLMInteraction(record: LLMLogRecord): void {
  try {
    ensureLogDir();
    const date = record.timestamp.slice(0, 10).replace(/-/g, "");
    const filePath = path.join(LOG_DIR, `llm-${date}.jsonl`);
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(filePath, line, { encoding: "utf8" });
  } catch {
    // best-effort logging only; ignore logging failures
  }
}

/**
 * Generic wrapper that logs requests and responses for any LLMAdapter.
 * For adapters that don't expose token usage, usage will be undefined.
 * For OpenAIAdapter, prefer its built-in logging so you also capture token counts.
 */
export class LoggingLLMAdapter implements LLMAdapter {
  constructor(
    private readonly inner: LLMAdapter,
    private readonly adapterName: string = "LLMAdapter",
    private readonly model?: string,
  ) {}

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const start = Date.now();
    let completion = "";
    let errorMessage: string | undefined;

    try {
      completion = await this.inner.complete(prompt, options);
      return completion;
    } catch (err: any) {
      errorMessage = err?.message ?? String(err);
      throw err;
    } finally {
      const durationMs = Date.now() - start;
      logLLMInteraction({
        timestamp: new Date().toISOString(),
        adapterName: this.adapterName,
        model: this.model,
        runId,
        prompt,
        completion,
        options,
        durationMs,
        errorMessage,
      });
    }
  }
}