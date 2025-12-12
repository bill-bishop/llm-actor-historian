This folder contains the new/updated files for LLM logging + dashboard.

Files:

- src/logging.ts
    - logLLMInteraction(record): append JSONL lines to logs/llm-YYYYMMDD.jsonl
    - LoggingLLMAdapter: wrapper for arbitrary LLMAdapter to capture prompts/completions

- src/openAIAdapter.ts
    - Updated to:
        - import logLLMInteraction
        - log each request/response with timestamp, runId, model, options
        - capture token usage (promptTokens, completionTokens, totalTokens) from OpenAI response

- dashboard/llm-dashboard.html
- dashboard/llm-dashboard.js
    - Static HTML+JS dashboard
    - Open dashboard/llm-dashboard.html in your browser
    - Use the file picker to select one or more logs/llm-*.jsonl files
    - Shows a table of calls and a detail panel for full prompt/completion

Integration steps:

1) Copy src/logging.ts into your project's src/.
2) Replace your existing src/openAIAdapter.ts with the one here.
3) Optionally wrap any non-OpenAI adapters (e.g. mocks) with LoggingLLMAdapter if you want their calls logged too.
4) Run your demos/tests that hit OpenAIAdapter; log files will appear in logs/llm-YYYYMMDD.jsonl (relative to project root at runtime).
5) Open dashboard/llm-dashboard.html in a browser and select those log files to inspect them.