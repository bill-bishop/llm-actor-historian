

## OpenAI demo

To run a single-round demo using OpenAI:

```bash
export OPENAI_API_KEY=sk-...
npm install
npm run build
node dist/openai-demo.js
```

This will:

- Load `samples/Login.tsx` and `samples/login.test.ts`
- Call the Actor LLM (OpenAI) once to propose actions
- Apply the suggested file edits in-memory and simulate `npm test`
- Call the Historian LLM (OpenAI) once to update `historySummary`
- Print the results to the console
