'use client';
import { copyText } from '../lib/clipboard';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  CircleCheck,
  Code2,
  Copy,
  FolderOpen,
  GitBranch,
  Layers,
  Plus,
  Terminal,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { money, useApi, type Page, type Schema } from '../lib/client';
import { ProjectCard, RunTable, Stat } from './dashboard-shared';
import { RunComposer } from './run-composer';
import { Button, Empty, ErrorState, Loading, PageHeading, SectionHeading } from './ui';
// Each view loads its own client bundle; opening Overview does not load the editor or charts.
const loading = () => <Loading />;
const UsageView = dynamic(() => import('./usage').then((m) => m.UsageView), { loading });
const WebhooksView = dynamic(() => import('./webhooks').then((m) => m.WebhooksView), { loading });
const TriggersView = dynamic(() => import('./triggers').then((m) => m.TriggersView), { loading });
const SecurityView = dynamic(() => import('./security').then((m) => m.SecurityView), { loading });
const TeamView = dynamic(() => import('./team').then((m) => m.TeamView), { loading });
const ProjectsView = dynamic(() => import('./projects').then((m) => m.ProjectsView), { loading });
const WorkspaceView = dynamic(() => import('./projects').then((m) => m.WorkspaceView), { loading });
const RunDetail = dynamic(() => import('./runs').then((m) => m.RunDetail), { loading });
const RunsView = dynamic(() => import('./runs').then((m) => m.RunsView), { loading });
const ConnectionsView = dynamic(() => import('./management').then((m) => m.ConnectionsView), { loading });
const KeysView = dynamic(() => import('./management').then((m) => m.KeysView), { loading });
const BillingView = dynamic(() => import('./management').then((m) => m.BillingView), { loading });
const AgentsView = dynamic(() => import('./management').then((m) => m.AgentsView), { loading });
const OperatorView = dynamic(() => import('./management').then((m) => m.OperatorView), { loading });
export function Dashboard({ segments }: { segments: string[] }) {
  const [compose, setCompose] = useState(false);
  const route = segments[0] || 'overview';
  let content: React.ReactNode;
  if (route === 'overview') content = <Overview onRun={() => setCompose(true)} />;
  else if (route === 'projects')
    content = segments[1] ? (
      <WorkspaceView key={segments[1]} projectId={segments[1]} workspaceId={segments[3]} />
    ) : (
      <ProjectsView />
    );
  else if (route === 'runs')
    content = segments[1] ? (
      <RunDetail key={segments[1]} runId={segments[1]} />
    ) : (
      <RunsView onRun={() => setCompose(true)} />
    );
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
      <RunComposer open={compose} onOpenChange={setCompose} />
    </>
  );
}
function Overview({ onRun }: { onRun: () => void }) {
  const projects = useApi<Page<Schema['Project']>>('/v1/projects?archived=false&limit=4');
  const runs = useApi<Page<Schema['Run']>>('/v1/runs?limit=100');
  const billing = useApi<Schema['Billing']>('/v1/billing');
  const usage = useApi<Schema['Report']>('/v1/usage');
  if (projects.isPending || runs.isPending) return <Loading />;
  if (projects.error || runs.error)
    return (
      <ErrorState
        error={(projects.error || runs.error)!}
        retry={() => {
          projects.refetch();
          runs.refetch();
        }}
      />
    );
  const all = runs.data?.data || [];
  const active = all.filter((r) => !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(r.status));
  const metrics = usage.data?.metrics || [];
  const total = metrics.find((m) => m.name === 'runs')?.value || 0;
  return (
    <div className="page overview">
      <PageHeading
        eyebrow="YOUR CONTROL ROOM"
        title="Make room for your next idea."
        description="Your agents, projects, and progress. All in one place."
        action={
          <Button onClick={onRun}>
            <Plus size={17} />
            New run
          </Button>
        }
      />
      <div className="stats-grid">
        <Stat
          label="Active runs"
          value={String(metrics.find((m) => m.name === 'runs_active')?.value ?? '—')}
          detail={active.length ? 'Agents are working' : 'Ready for your next task'}
          icon={<Activity />}
          accent
        />
        <Stat
          label="Runs in the last 30 days"
          value={String(total)}
          detail={`${metrics.find((m) => m.name === 'runs_succeeded')?.value || 0} completed successfully`}
          icon={<CircleCheck />}
        />
        <Stat
          label="Projects"
          value={String(metrics.find((m) => m.name === 'projects_active')?.value ?? '—')}
          detail="Persistent, versioned workspaces"
          icon={<Layers />}
        />
        <Stat
          label="Available credits"
          value={money(billing.data?.available_micro_usd)}
          detail={billing.data?.execution_policy?.plan_name || 'Starter'}
          icon={<Box />}
        />
      </div>
      <div className="overview-columns">
        <div className="overview-main">
          <SectionHeading
            title="Your projects"
            description="A lasting home for the work that matters."
            href="/projects"
          />
          <div className="project-grid">
            {projects.data?.data
              .filter((p) => !p.archived)
              .slice(0, 4)
              .map((p, i) => (
                <ProjectCard key={p.id} project={p} index={i} />
              ))}
            {!projects.data?.data.length && (
              <Empty
                icon={<FolderOpen />}
                title="Start with a project"
                description="Give your agents a place to work and files to build on."
                action={
                  <Link className="button primary" href="/projects">
                    Create a project
                  </Link>
                }
              />
            )}
          </div>
          <SectionHeading
            title="Recent runs"
            description="Every step saved. Every result within reach."
            href="/runs"
          />
          <RunTable runs={all.slice(0, 6)} />
        </div>
        <aside className="overview-aside">
          <div className="quickstart-card">
            <div className="quickstart-icon">
              <Terminal size={22} />
              <span className="terminal-cursor" />
            </div>
            <span className="eyebrow">MEET YOUR NEW WORKFLOW</span>
            <h3>
              Local feel.
              <br />
              Cloud horsepower.
            </h3>
            <p>Link a project and talk to your hosted agent from any terminal.</p>
            <div className="code-mini">
              <span>$</span> agent link PROJECT_ID
            </div>
            <Link className="button secondary" href="/developers">
              Set up your terminal <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="workspace-principles">
            <div>
              <div className="principle-icon">
                <GitBranch size={17} />
              </div>
              <div>
                <strong>Work without losing your place</strong>
                <p>Files and conversations persist between runs.</p>
              </div>
            </div>
            <div>
              <div className="principle-icon">
                <Code2 size={17} />
              </div>
              <div>
                <strong>An API for everything</strong>
                <p>The same capabilities, ready for your applications.</p>
              </div>
            </div>
            <a href="/reference" target="_blank" rel="noreferrer">
              Explore the API <ArrowRight size={14} />
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
function DevelopersView() {
  const origin = typeof window !== 'undefined' ? location.origin : 'https://your-domain.example';
  const code = `curl ${origin}/v1/runs \\\n  -H "Authorization: Bearer $AGENT_API_KEY" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"project_id":"YOUR_PROJECT_ID","harness":"codex",\n       "model":"YOUR_MODEL","billing_mode":"managed",\n       "prompt":"Review this project and suggest the next step.",\n       "limits":{"timeout_seconds":300,"max_cost_micro_usd":"1000000"}}'`;
  return (
    <div className="page narrow-page">
      <PageHeading
        eyebrow="DEVELOPER EXPERIENCE"
        title="Your workspace, everywhere."
        description="The dashboard, API, SDKs, and CLI all operate on the same projects and history."
      />
      <div className="developer-sections">
        <section className="panel">
          <SectionHeading title="01 · Connect from your terminal" />
          <p>
            Follow the <Link href="/docs/cli">CLI installation guide</Link>, then run these commands from your
            local project folder. Browser sign-in connects the CLI to your hosted workspace.
          </p>
          <pre className="code-block">
            {`agent login --host ${origin}\nagent project list\nagent link YOUR_PROJECT_ID\nagent worktree create exploration --from main --use\nagent doctor\nagent chat --harness codex --model YOUR_ENABLED_MODEL`}
          </pre>
          <Link href="/api-keys" className="text-link">
            Create an API key <ArrowUpRight size={14} />
          </Link>
        </section>
        <section className="panel">
          <SectionHeading
            title="02 · Start a run from your application"
            action={
              <Button variant="ghost" onClick={() => copyText(code, 'Example copied')}>
                <Copy size={14} />
                Copy
              </Button>
            }
          />
          <p>
            Send a task, then reconnect to the event stream whenever you need an update. Keep your API key on
            the server. The <Link href="/docs/api/quickstart">API quickstart</Link> walks through model
            selection, spending limits, retries, and results.
          </p>
          <pre className="code-block">{code}</pre>
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
