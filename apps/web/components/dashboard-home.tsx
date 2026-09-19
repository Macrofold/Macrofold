'use client';

import {
  Activity,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  Circle,
  Code2,
  CreditCard,
  FolderOpen,
  KeyRound,
  Plus,
  Sparkles,
  Terminal,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { money, useApi, type Page, type Schema } from '../lib/client';
import { WorkspaceCard, RunTable, Stat } from './dashboard-shared';
import { SetupPrompt } from './setup-prompt';
import { FeaturedTemplates } from './templates';
import { Button, ErrorState, Loading, Modal, PageHeading, SectionHeading } from './ui';
import './dashboard-home.css';

export function DashboardHome({ onRun }: { onRun: (prompt?: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [guide, setGuide] = useState(false);
  const workspaces = useApi<Page<Schema['Workspace']>>('/v1/workspaces?archived=false&limit=4');
  const runs = useApi<Page<Schema['Run']>>('/v1/runs?limit=100');
  const successfulRuns = useApi<Page<Schema['Run']>>('/v1/runs?status=succeeded&limit=1');
  const billing = useApi<Schema['Billing']>('/v1/billing');
  const usage = useApi<Schema['Report']>('/v1/usage');
  const identity = useApi<Schema['Identity']>('/v1/me');
  if (workspaces.isPending || runs.isPending) return <Loading />;
  const loadError = workspaces.error || runs.error;
  if (loadError)
    return (
      <ErrorState
        error={loadError}
        retry={() => {
          void workspaces.refetch();
          void runs.refetch();
        }}
      />
    );
  const workspaceList = workspaces.data?.data || [];
  const allRuns = runs.data?.data || [];
  const metrics = usage.data?.metrics || [];
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value;
  const canRun = Boolean(identity.data?.effective_scopes.includes('runs:write'));
  const funded = billing.data
    ? BigInt(billing.data.available_micro_usd) > 0n && !billing.data.billing_hold
    : false;
  const completed = Boolean(successfulRuns.data?.data.length);
  const steps = [
    {
      title: 'Create a workspace',
      description: 'A persistent home for your agent’s files.',
      done: workspaceList.length > 0,
      href: '/workspaces',
      icon: FolderOpen,
    },
    {
      title: billing.error ? 'Check your funding' : 'Set up funding',
      description: 'Review credits, limits, and optional provider keys.',
      done: funded,
      href: '/billing',
      icon: CreditCard,
    },
    {
      title: successfulRuns.error ? 'Review your runs' : 'Complete your first run',
      description: 'Give an agent a task and follow its progress.',
      done: completed,
      href: '/runs',
      icon: Activity,
    },
  ];
  const ready = steps.filter((step) => step.done).length;
  return (
    <div className="page dashboard-home">
      <PageHeading
        title="Home"
        description="A little direction. A lot of possibility."
        action={
          <Button variant="secondary" onClick={() => setGuide(true)}>
            <BookOpen size={15} />
            Setup guide
          </Button>
        }
      />
      <section className="welcome-surface" aria-labelledby="welcome-title">
        <div className="welcome-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="welcome-intro">
          <span className="welcome-kicker">
            <Sparkles size={14} />
            Your worktree for what’s next
          </span>
          <h2 id="welcome-title">What will you build today?</h2>
          <p>Give an agent a task. Come back to work that lasts.</p>
        </div>
        <form
          className="welcome-composer input-surface"
          onSubmit={(event) => {
            event.preventDefault();
            onRun(prompt);
          }}
        >
          <label className="sr-only" htmlFor="home-prompt">
            Describe your task
          </label>
          <textarea
            id="home-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Research an idea, improve your code, or turn data into a clear answer…"
            rows={2}
            maxLength={100000}
          />
          <div className="welcome-composer-footer">
            <span>
              <span className="welcome-status-dot" />
              Files and history stay with your workspace
            </span>
            <Button type="submit" disabled={!canRun || !prompt.trim()} aria-label="Review run">
              <ArrowUp size={17} />
            </Button>
          </div>
        </form>
        <div className="welcome-suggestions" aria-label="Task ideas">
          {['Review my code', 'Research a topic', 'Analyze a dataset'].map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() =>
                setPrompt(
                  idea === 'Review my code'
                    ? 'Review this workspace for correctness and maintainability. Write a prioritized report to review.md. Do not modify source files.'
                    : idea === 'Research a topic'
                      ? 'Research [topic] using the sources I provide. Write a concise brief to research.md with citations and open questions.'
                      : 'Analyze the dataset in this workspace. Document data quality, summarize the key trends, and save your findings to analysis.md.',
                )
              }
            >
              <Plus size={12} />
              {idea}
            </button>
          ))}
        </div>
        {!canRun && identity.data && (
          <p className="welcome-permission">
            Your role can explore this worktree. Ask an administrator for access to start runs.
          </p>
        )}
      </section>
      <section className="home-start-grid" aria-label="Getting started">
        <div className="onboarding-card">
          <div className="home-card-heading">
            <h2>Your first steps</h2>
            <span>{ready} of 3 complete</span>
          </div>
          <progress value={ready} max={3} aria-label="Setup progress" />
          <div className="onboarding-steps">
            {steps.map((step) => (
              <Link
                key={step.title}
                href={step.href}
                className={step.done ? 'setup-step complete' : 'setup-step'}
              >
                <span className="setup-step-mark">
                  {step.done ? <Check size={15} /> : <step.icon size={15} />}
                </span>
                <span>
                  <strong>{step.title}</strong>
                  <small>{step.description}</small>
                </span>
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </div>
        <div className="build-ai-card">
          <span className="home-feature-icon">
            <Code2 size={21} />
          </span>
          <h2>Build with your AI agent</h2>
          <p>
            Let your coding agent handle the integration. One prompt gives it the right docs, setup steps, and
            a clear first result.
          </p>
          <div className="build-ai-actions">
            <SetupPrompt />
            <Link href="/developers" className="text-link">
              Explore developer tools <ArrowRight size={14} />
            </Link>
          </div>
          <div className="build-ai-caption">
            <span>TypeScript</span>
            <span>Python</span>
            <span>Go</span>
            <span>Rust</span>
            <span>Java</span>
          </div>
        </div>
      </section>
      <FeaturedTemplates />
      <div className="home-activity-heading">
        <SectionHeading
          title="Your worktree at a glance"
          description="Current activity and the work you can return to."
          action={
            <Button variant="secondary" onClick={() => onRun()} disabled={!canRun}>
              <Plus size={14} />
              New run
            </Button>
          }
        />
      </div>
      <div className="stats-grid home-stats">
        <Stat
          label="Active runs"
          value={metric('runs_active') ?? '—'}
          detail="Working or waiting"
          icon={<Activity />}
        />
        <Stat
          label="Completed runs"
          value={metric('runs_succeeded') ?? '—'}
          detail="In the last 30 days"
          icon={<Check />}
        />
        <Stat
          label="Available credits"
          value={billing.data ? money(billing.data.available_micro_usd) : '—'}
          detail={billing.data?.execution_policy?.plan_name || 'View billing for details'}
          icon={<CreditCard />}
        />
      </div>
      <SectionHeading title="Your workspaces" href="/workspaces" />
      {workspaceList.length ? (
        <div className="workspace-grid home-workspaces">
          {workspaceList.map((workspace, index) => (
            <WorkspaceCard key={workspace.id} workspace={workspace} index={index} />
          ))}
        </div>
      ) : (
        <div className="home-workspace-empty">
          <span className="home-feature-icon">
            <FolderOpen size={22} />
          </span>
          <div>
            <h3>Give your ideas a home</h3>
            <p>Create a workspace to keep files and return to your agent’s work.</p>
          </div>
          <Link href="/workspaces" className="button secondary">
            Create a workspace <ArrowRight size={14} />
          </Link>
        </div>
      )}
      <SectionHeading title="Recent runs" href="/runs" />
      <RunTable runs={allRuns.slice(0, 6)} />
      <div className="home-resources">
        {[
          {
            href: '/docs/quickstart',
            icon: BookOpen,
            title: 'Your first agent run',
            text: 'Follow the short quickstart.',
          },
          {
            href: '/api-keys',
            icon: KeyRound,
            title: 'Connect your application',
            text: 'Create a scoped API key.',
          },
          {
            href: '/developers',
            icon: Terminal,
            title: 'Work from your terminal',
            text: 'Bring the same worktree to your CLI.',
          },
        ].map((item) => (
          <Link key={item.href} href={item.href}>
            <item.icon size={18} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </span>
            <ArrowRight size={14} />
          </Link>
        ))}
      </div>
      <Modal
        open={guide}
        onOpenChange={setGuide}
        title="From an idea to your first run"
        description="A few steps connect your account, your workspace, and your tools."
      >
        <div className="setup-guide-steps">
          {steps.map((step, index) => (
            <div key={step.title}>
              <span className="setup-step-mark">{step.done ? <Check size={16} /> : index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <Link className="text-link" href={step.href} onClick={() => setGuide(false)}>
                  {step.done ? 'Review setup' : 'Continue'} <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          ))}
        </div>
        <div className="setup-guide-extra">
          <Circle size={14} />
          <p>
            Review the harness, model, permissions, and budget before starting. Adding a connection never
            grants it to an agent automatically.
          </p>
        </div>
        <SetupPrompt label="Copy integration prompt" />
      </Modal>
    </div>
  );
}
