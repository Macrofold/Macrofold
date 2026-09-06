import Link from 'next/link';
import { config } from '@platform/core/config';
import { PublicFrame } from '../../components/marketing';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quickstart' };
export default function Docs() {
  return (
    <PublicFrame name={config.name}>
      <main className="public-section public-reading">
        <span className="public-eyebrow">QUICKSTART</span>
        <h1>
          Your first persistent
          <br />
          agent workspace.
        </h1>
        <p className="public-lede">
          Create an account, connect a model, and start a task. The dashboard, REST API and terminal all work
          with the same projects and run history.
        </p>
        <ol className="quickstart-steps">
          <li>
            <h2>Create an account and project</h2>
            <p>
              <Link href="/register">Register</Link> and verify your email. Open Projects → New project. The
              main workspace is created for you; files and Git history persist between runs.
            </p>
          </li>
          <li>
            <h2>Choose your model funding</h2>
            <p>
              Add prepaid credits in Billing. For BYOK, add a model connection in Connections, then select it
              when starting a run. Your provider bills model use directly; platform credits still cover
              compute and authorized tools. Local development offers a clearly labeled simulator without paid
              calls.
            </p>
          </li>
          <li>
            <h2>Start from the dashboard</h2>
            <p>
              Open a project, upload files or edit its README, and select New run. Choose the harness,
              supported model, prompt and budget. Watch streamed output and tool activity; a verified
              checkpoint becomes available when the work is persisted.
            </p>
          </li>
          <li>
            <h2>Use the API</h2>
            <p>
              Create a scoped key in API keys and copy its secret once. Keep it on your server, never in
              browser code. Replace the placeholders below. A run request can consume credits when live
              execution is enabled.
            </p>
            <pre>
              <code>{`export AGENT_API_KEY='your-secret-key'
export AGENT_ORIGIN='${config.origin}'

curl "$AGENT_ORIGIN/v1/projects" \\
  -H "Authorization: Bearer $AGENT_API_KEY"

curl "$AGENT_ORIGIN/v1/runs" \\
  -H "Authorization: Bearer $AGENT_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: a-unique-key-for-this-task' \\
  -d '{"project_id":"PROJECT_UUID","harness":"codex",
       "model":"ENABLED_MODEL_ID","billing_mode":"managed",
       "prompt":"Review this project and save a progress note.",
       "limits":{"timeout_seconds":300,"max_cost_micro_usd":"2000000"}}'

curl -N "$AGENT_ORIGIN/v1/runs/RUN_UUID/stream" \\
  -H "Authorization: Bearer $AGENT_API_KEY"

curl "$AGENT_ORIGIN/v1/runs/RUN_UUID/result" \\
  -H "Authorization: Bearer $AGENT_API_KEY"`}</code>
            </pre>
            <p>
              Retry the same mutation with the same idempotency key. Reusing that key with different content
              returns a conflict. Reconnect SSE with <code>Last-Event-ID</code>. The stream is an observation
              of durable work; disconnecting does not cancel a run.
            </p>
            <p>
              <Link href="/reference">Open the complete interactive API reference</Link> or{' '}
              <a href="/openapi.json">download OpenAPI</a>. Every error includes a stable code and request ID.
            </p>
          </li>
          <li>
            <h2>Use your terminal</h2>
            <p>
              The CLI supports device login, profiles, remote workspaces, streaming chat, explicit transfers
              and verified Git review checkouts. Use the CLI distribution published by this deployment’s
              operator; a repository checkout can run it with <code>pnpm cli --help</code>. Package
              publication is separate from hosting the web application.
            </p>
            <pre>
              <code>{`pnpm cli login --help
pnpm cli project list
pnpm cli link --help
pnpm cli chat --help
pnpm cli worktree list --help`}</code>
            </pre>
          </li>
        </ol>
        <section id="data">
          <h2>Your files and history</h2>
          <p>
            Projects are tenant-scoped. Workspaces have independent writable state, ordinary Git history, and
            verified recovery checkpoints. Optional GitHub synchronization is separate from successful
            execution: branch protection and conflicts can require attention while your files remain saved.
          </p>
          <p>
            Detailed run content is retained for 30 days on pay as you go and 90 days on Pro. Current project
            files and compatible native conversation state persist until project deletion. Checkpoints follow
            a tiered retention policy; pins and current recovery points are protected. A historical run can
            retain its status and accounting after its detailed content expires.
          </p>
          <p>
            Project deletion has a seven-day undo window, followed by content removal and delayed
            physical-object collection. Retained accounting and payment records are separate. Storage quotas
            are measured periodically; already accepted work can finish persisting before subsequent admission
            is blocked.
          </p>
          <p>
            Only reasoning summaries or content actually exposed by a provider can be shown; hidden model
            reasoning is unavailable. Connected tools can cause external effects. Grant only the tools you
            intend to use, and inspect an uncertain outcome before repeating an action.
          </p>
          <p>
            Operators configure service providers, privacy/terms pages and support channels for their
            deployment. No compliance certification or third-party data-retention guarantee is implied by this
            software.
          </p>
        </section>
      </main>
    </PublicFrame>
  );
}
