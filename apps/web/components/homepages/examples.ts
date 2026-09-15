/** These snippets use existing SDK operations. Setup variables are disclosed beside the code. */
export const examples = {
  TypeScript: {
    Run: `import { Macrofold } from 'macrofold';

const macrofold = new Macrofold();
const run = await macrofold.runs.create({
    project_id,
    harness: 'codex',
    model: 'gpt-5.4-mini',
    billing_mode: 'managed',
    prompt: 'Build a working prototype.',
});`,
    Stream: `for await (const text of macrofold.runs.streamText(run.run_id)) {
  process.stdout.write(text);
}`,
    Continue: `const next = await macrofold.runs.create({
    session_id: run.session_id,
    prompt: 'Add tests for the prototype.',
});`,
  },
  Python: {
    Run: `from macrofold import Macrofold

macrofold = Macrofold()
run = macrofold.runs.create(
    project_id=project_id,
    harness='codex',
    model='gpt-5.4-mini',
    billing_mode='managed',
    prompt='Build a working prototype.',
)
macrofold.close()`,
    Stream: `macrofold = Macrofold()
for text in macrofold.runs.stream_text(run.run_id):
    print(text, end="", flush=True)

macrofold.close()`,
    Continue: `macrofold = Macrofold()
next_run = macrofold.runs.create(
    session_id=run.session_id,
    prompt='Add tests for the prototype.',
)

macrofold.close()`,
  },
  cURL: {
    Run: `REQUEST_KEY=$(uuidgen)
curl -sS "https://app.macrofold.ai/v1/runs" \\
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \\
  -H "Idempotency-Key: $REQUEST_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "project_id": "<project-id>",
    "harness": "codex",
    "model": "gpt-5.4-mini",
    "billing_mode": "managed",
    "prompt": "Build a working prototype."
  }'`,
    Stream: `curl -N "https://app.macrofold.ai/v1/runs/$RUN_ID/stream" \\
  -H "Authorization: Bearer $MACROFOLD_API_KEY"`,
    Continue: `NEXT_REQUEST_KEY=$(uuidgen)
curl -sS "https://app.macrofold.ai/v1/runs" \\
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \\
  -H "Idempotency-Key: $NEXT_REQUEST_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"session_id":"<session-id>",
       "prompt":"Add tests for the prototype."}'`,
  },
  CLI: {
    Run: `# After login and linking your project.
macrofold run "Build a working prototype." \\
  --harness codex \\
  --model gpt-5.4-mini`,
    Stream: `# run already streams; reattach to an existing run.
macrofold run attach "$RUN_ID"`,
    Continue: `macrofold run "Add tests for the prototype." \\
  --session "$SESSION_ID"`,
  },
} as const;
export type ExampleLanguage = keyof typeof examples;
export type ExampleOperation = keyof (typeof examples)['TypeScript'];
