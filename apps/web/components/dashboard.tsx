'use client';
import { CopyButton } from './copy-button';
import { ArrowRight, ArrowUpRight, Box } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { DashboardHome } from './dashboard-home';
import { SetupPrompt } from './setup-prompt';
import { RunComposer } from './run-composer';
import { Empty, Loading, PageHeading, SectionHeading } from './ui';
// Each view loads its own client bundle; opening Overview does not load the editor or charts.
const loading = () => <Loading />;
const TemplatesView = dynamic(() => import('./templates').then((m) => m.TemplatesView), { loading });
const UsageView = dynamic(() => import('./usage').then((m) => m.UsageView), { loading });
const WebhooksView = dynamic(() => import('./webhooks').then((m) => m.WebhooksView), { loading });
const TriggersView = dynamic(() => import('./triggers').then((m) => m.TriggersView), { loading });
const SecurityView = dynamic(() => import('./security').then((m) => m.SecurityView), { loading });
const TeamView = dynamic(() => import('./team').then((m) => m.TeamView), { loading });
const WorkersView = dynamic(() => import('./workers').then((m) => m.WorkersView), { loading });
const WorkspacesView = dynamic(() => import('./workspaces').then((m) => m.WorkspacesView), { loading });
const WorktreeView = dynamic(() => import('./workspaces').then((m) => m.WorktreeView), { loading });
const RunDetail = dynamic(() => import('./runs').then((m) => m.RunDetail), { loading });
const RunsView = dynamic(() => import('./runs').then((m) => m.RunsView), { loading });
const ConnectionsView = dynamic(() => import('./management').then((m) => m.ConnectionsView), { loading });
const KeysView = dynamic(() => import('./management').then((m) => m.KeysView), { loading });
const BillingView = dynamic(() => import('./management').then((m) => m.BillingView), { loading });
const AgentsView = dynamic(() => import('./management').then((m) => m.AgentsView), { loading });
const OperatorView = dynamic(() => import('./management').then((m) => m.OperatorView), { loading });
export function Dashboard({ segments }: { segments: string[] }) {
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState({ prompt: '', version: 0 });
  function openRun(prompt?: string) {
    if (prompt !== undefined) setDraft((current) => ({ prompt, version: current.version + 1 }));
    setCompose(true);
  }
  const route = segments[0] || 'overview';
  let content: React.ReactNode;
  if (route === 'overview') content = <DashboardHome onRun={openRun} />;
  else if (route === 'templates') content = <TemplatesView />;
  else if (route === 'workspaces')
    content = segments[1] ? (
      <WorktreeView key={segments[1]} workspaceId={segments[1]} worktreeId={segments[3]} />
    ) : (
      <WorkspacesView />
    );
  else if (route === 'runs')
    content = segments[1] ? (
      <RunDetail key={segments[1]} runId={segments[1]} />
    ) : (
      <RunsView onRun={() => setCompose(true)} />
    );
  else if (route === 'workers') content = <WorkersView />;
  else if (route === 'connections') content = <ConnectionsView />;
  else if (route === 'webhooks') content = <WebhooksView />;
  else if (route === 'triggers') content = <TriggersView key="triggers" />;
  else if (route === 'scheduled-tasks') content = <TriggersView key="scheduled" scheduled />;
  else if (route === 'account') content = <SecurityView />;
  else if (route === 'team') content = <TeamView />;
  else if (route === 'api-keys') content = <KeysView />;
  else if (route === 'usage') content = <UsageView />;
  else if (route === 'billing') content = <BillingView />;
  else if (route === 'agents') content = <AgentsView />;
  else if (route === 'operator') content = <OperatorView />;
  else if (route === 'developers') content = <DevelopersView />;
  else
    content = (
      <Empty
        icon={<Box />}
        title="Page not found"
        description="This page may have moved."
        action={
          <Link className="button primary" href="/">
            Back to overview
          </Link>
        }
      />
    );
  return (
    <>
      {content}
      <RunComposer
        key={draft.version}
        open={compose}
        onOpenChange={setCompose}
        initialPrompt={draft.prompt}
      />
    </>
  );
}
function DevelopersView() {
  const origin = typeof window !== 'undefined' ? location.origin : 'https://your-domain.example';
  const code = `curl ${origin}/v1/runs \\\n  -H "Authorization: Bearer $MACROFOLD_API_KEY" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"workspace_id":"YOUR_WORKSPACE_ID","harness":"codex",\n       "model":"YOUR_MODEL","billing_mode":"managed",\n       "prompt":"Review this workspace and suggest the next step.",\n       "limits":{"timeout_seconds":300,"max_cost_micro_usd":"1000000"}}'`;
  return (
    <div className="page narrow-page">
      <PageHeading
        eyebrow="Build with AI"
        title="Your worktree, everywhere."
        description="The dashboard, API, SDKs, and CLI all operate on the same workspaces and history."
      />
      <div className="developer-sections">
        <section className="panel developer-ai-start">
          <SectionHeading title="Let your coding agent handle the setup" />
          <p>
            Copy a brief with your deployment URL, SDK guides, and a verifiable first result. Paste it into
            the agent working in your application.
          </p>
          <div className="button-row">
            <SetupPrompt />
            <Link href="/docs/agents" className="text-link">
              Build with AI guide <ArrowRight size={14} />
            </Link>
          </div>
        </section>
        <section className="panel">
          <SectionHeading title="01 · Connect from your terminal" />
          <p>
            Follow the <Link href="/docs/cli">CLI installation guide</Link>, then run these commands from your
            local workspace folder. Browser sign-in connects the CLI to your hosted worktree.
          </p>
          <pre className="code-block">
            {`macrofold login --host ${origin}\nmacrofold workspace list\nmacrofold link YOUR_WORKSPACE_ID\nmacrofold worktree create exploration --from main --use\nmacrofold doctor\nmacrofold chat --harness codex --model YOUR_ENABLED_MODEL`}
          </pre>
          <Link href="/api-keys" className="text-link">
            Create an API key <ArrowUpRight size={14} />
          </Link>
        </section>
        <section className="panel">
          <SectionHeading
            title="02 · Start a run from your application"
            action={<CopyButton variant="ghost" text={code} />}
          />
          <p>
            Send a task, then reconnect to the event stream whenever you need an update. Keep your API key on
            the server. The <Link href="/docs/api/quickstart">API quickstart</Link> walks through model
            selection, spending limits, retries, and results.
          </p>
          <pre className="code-block">{code}</pre>
        </section>
        <section className="panel" aria-label="Integration paths">
          <SectionHeading title="Optional · Integration paths" />
          <p>
            Building an assistant for each customer? The Customer agents path handles setup and ownership
            using the same workspaces, worktrees, presets and runs. Add account connections when your customers
            need them.
          </p>
          <div className="button-row">
            <Link href="/docs/customer-agents/quickstart" className="button secondary">
              Build customer agents <ArrowRight size={14} />
            </Link>
            <Link href="/docs/customer-agents/connections" className="text-link">
              Embed account connections <ArrowRight size={14} />
            </Link>
          </div>
          <p className="muted">
            A use-case-specific shortcut. Core APIs remain available for your own resource layout.
          </p>
        </section>
        <section className="panel">
          <SectionHeading title="03 · Build with the full contract" />
          <p>
            Explore every endpoint, request schema, and response in the interactive reference. The OpenAPI
            contract also powers typed clients.
          </p>
          <div className="button-row">
            <a className="button primary" href="/reference" target="_blank" rel="noreferrer">
              Open API reference <ArrowUpRight size={15} />
            </a>
            <a className="button secondary" href="/openapi.json" download>
              Download OpenAPI
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
