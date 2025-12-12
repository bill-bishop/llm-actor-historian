export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  stop?: string | string[];
}

export interface LLMAdapter {
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
}

export interface FewShotExample<I, O> {
  input: I;
  output: O;
}

export type Serializer<T> = (value: T) => string;
export type Parser<T> = (raw: string) => T;

export interface FewShotConfig<I, O> {
  inputLabel?: string;
  outputLabel?: string;
  exampleHeader?: string;

  serializeInput: Serializer<I>;
  serializeOutput: Serializer<O>;
  parseOutput: Parser<O>;

  includeExampleIndex?: boolean;
  separator?: string;
}