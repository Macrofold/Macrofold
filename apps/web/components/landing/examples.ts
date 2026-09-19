/** New runs select their harness directly; workspace setup is disclosed beside the examples. */
export const examples = {
  TypeScript: `import { Macrofold } from 'macrofold';

const macrofold = new Macrofold();
const run = await macrofold.runs.create({
  workspace_id,
  harness: 'codex',
  model: 'gpt-5.4-mini',
  billing_mode: 'managed',
  prompt: 'Build a working prototype.',
});

for await (const text of macrofold.runs.streamText(run.run_id)) {
  process.stdout.write(text);
}`,
  Python: `from macrofold import Macrofold

macrofold = Macrofold()
run = macrofold.runs.create(
    workspace_id=workspace_id,
    harness='codex',
    model='gpt-5.4-mini',
    billing_mode='managed',
    prompt='Build a working prototype.',
)

for text in macrofold.runs.stream_text(run.run_id):
    print(text, end="", flush=True)

macrofold.close()`,
  Go: `client, err := macrofold.NewClient()
if err != nil { return err }

input := macrofold.NewRunCreate("Build a working prototype.")
input.SetWorkspaceId(workspaceID)
input.SetHarness("codex")
input.SetModel("gpt-5.4-mini")
input.SetBillingMode("managed")
run, err := client.Runs.Create(ctx, input)
if err != nil { return err }

return client.Runs.StreamText(ctx, run.RunId, "0", func(text string) error {
    fmt.Print(text)
    return nil
})`,
  Rust: `let client = macrofold::Macrofold::new()?;
let mut input = macrofold::models::RunCreate::new(
    "Build a working prototype.".into(),
);
input.workspace_id = Some(workspace_id);
input.harness = Some(macrofold::models::run_create::Harness::Codex);
input.model = Some("gpt-5.4-mini".into());
input.billing_mode = Some(macrofold::models::run_create::BillingMode::Managed);
let run = client.runs().create(input).await?;

client.runs().stream_text(&run.run_id.to_string(), "0", |text| {
    print!("{text}");
    true
}).await?;`,
  cURL: `REQUEST_KEY=$(uuidgen)
RUN_ID=$(curl -sS https://app.macrofold.ai/v1/runs \\
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \\
  -H "Idempotency-Key: $REQUEST_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "workspace_id": "<workspace-id>",
    "harness": "codex",
    "model": "gpt-5.4-mini",
    "billing_mode": "managed",
    "prompt": "Build a working prototype."
  }' | jq -er '.run_id') &&

curl -N https://app.macrofold.ai/v1/runs/$RUN_ID/stream \\
  -H "Authorization: Bearer $MACROFOLD_API_KEY"`,
  CLI: `macrofold run "Build a working prototype." \\
  --harness codex \\
  --model gpt-5.4-mini

# The command streams as the agent works.`,
} as const;
