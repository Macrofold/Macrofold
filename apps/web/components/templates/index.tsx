'use client';

import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  Code2,
  FileText,
  Headphones,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CopyButton } from '../copy-button';
import { Button, Modal, PageHeading } from '../ui';
import {
  agentTemplates,
  featuredTemplates,
  plannedTemplates,
  searchTemplates,
  templateCodingPrompt,
  type AgentTemplate,
} from './catalog';
import './templates.css';

const templateIcons: Record<string, LucideIcon> = {
  'research-brief': BookOpen,
  'code-review': Code2,
  'data-analyst': BarChart3,
  'support-triage': Headphones,
  'weekly-project-digest': FileText,
};

function TemplateIcon({ template }: { template: AgentTemplate }) {
  const Icon = templateIcons[template.slug] || FileText;
  return (
    <span className={`template-icon template-tone-${template.tone}`}>
      <Icon size={20} strokeWidth={1.6} />
    </span>
  );
}

function TemplatePreview({
  template,
  onClose,
}: {
  template: AgentTemplate | undefined;
  onClose: () => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const copyPrompt = template ? templateCodingPrompt(template, origin) : '';
  return (
    <Modal
      open={Boolean(template)}
      onOpenChange={(open) => {
        if (!open) {
          setShowPrompt(false);
          onClose();
        }
      }}
      title={template?.name || 'Agent template'}
      description={template?.description || 'Preview an agent starter.'}
      wide
      className="template-preview"
    >
      {template && (
        <>
          <div className="template-outcome">
            <TemplateIcon template={template} />
            <div>
              <h3>What you’ll get</h3>
              <p>{template.outcome}</p>
            </div>
          </div>
          <div className="template-requirements">
            <h3>Before you run</h3>
            <ul>
              {template.requirements.map((requirement) => (
                <li key={requirement}>
                  <Check size={14} />
                  <span>{requirement}</span>
                </li>
              ))}
            </ul>
          </div>
          <Tabs.Root defaultValue="instructions" className="template-tabs">
            <Tabs.List aria-label="Template preview">
              <Tabs.Trigger value="instructions">Agent instructions</Tabs.Trigger>
              <Tabs.Trigger value="example">Example result</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="instructions">
              <div className="template-code-heading">
                <span>Editable after selection</span>
                <CopyButton variant="ghost" text={template.instructions} label="Copy instructions" />
              </div>
              <pre tabIndex={0}>{template.instructions}</pre>
            </Tabs.Content>
            <Tabs.Content value="example">
              <div className="template-code-heading">
                <span>Illustrative structure · no agent has run</span>
              </div>
              <pre tabIndex={0}>{template.example}</pre>
            </Tabs.Content>
          </Tabs.Root>
          <div className="template-assist">
            <div>
              <Sparkles size={16} />
              <strong>Building this into your app?</strong>
            </div>
            <p>Give your coding agent a brief with the current docs and this template.</p>
            <CopyButton
              text={copyPrompt}
              label="Copy prompt for my agent"
              onClick={() => setShowPrompt(true)}
            />
            {showPrompt && (
              <details className="template-copy-text">
                <summary>View prompt for manual copy</summary>
                <pre tabIndex={0}>{copyPrompt}</pre>
              </details>
            )}
          </div>
          <div className="dialog-actions template-actions">
            <p>Review your model and funding before saving. This won’t start a run.</p>
            <Link className="button secondary" href={`/agents?template=${template.slug}&schedule=true`}>
              Use and schedule
            </Link>
            <Link className="button primary" href={`/agents?template=${template.slug}`}>
              Use template
              <ArrowRight size={15} />
            </Link>
          </div>
        </>
      )}
    </Modal>
  );
}

export function FeaturedTemplates() {
  const [selected, setSelected] = useState<AgentTemplate>();
  return (
    <section className="featured-templates" aria-labelledby="featured-templates-title">
      <div className="section-heading">
        <div>
          <h2 id="featured-templates-title">Start with an example</h2>
          <p>Five useful ways to put an agent to work.</p>
        </div>
        <Link className="text-link" href="/templates">
          Browse library
          <ArrowRight size={14} />
        </Link>
      </div>
      <div className="featured-template-grid">
        {featuredTemplates.map((template) => (
          <button key={template.slug} className="featured-template" onClick={() => setSelected(template)}>
            <TemplateIcon template={template} />
            <strong>{template.name}</strong>
            <span>{template.description}</span>
            <ArrowRight className="template-arrow" size={15} />
          </button>
        ))}
      </div>
      <TemplatePreview template={selected} onClose={() => setSelected(undefined)} />
    </section>
  );
}

export function TemplatesView() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AgentTemplate>();
  const ready = searchTemplates(agentTemplates, search);
  const planned = searchTemplates(plannedTemplates, search);
  return (
    <div className="page template-library">
      <PageHeading
        title="Examples library"
        description="A useful starting point. Make it yours, then choose where it works."
        action={
          <Link className="button secondary" href="/agents">
            Your presets
            <ArrowRight size={15} />
          </Link>
        }
      />
      <div className="template-library-intro">
        <div>
          <span className="template-intro-icon">
            <Sparkles size={20} />
          </span>
          <h2>What would you like to build?</h2>
          <p>
            Explore the instructions, preview an outcome, and save a preset with your own model and account
            connections.
          </p>
        </div>
        <Link className="text-link" href="/docs/agents">
          Build with your coding agent
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="template-search-row">
        <label className="template-search input-surface">
          <Search size={17} />
          <input
            aria-label="Search examples"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search examples by task or category…"
          />
        </label>
        <span role="status">
          {ready.length} {ready.length === 1 ? 'starter' : 'starters'}
          {planned.length ? ` · ${planned.length} planned` : ''}
        </span>
      </div>
      {ready.length > 0 && (
        <section aria-labelledby="ready-template-title">
          <div className="section-heading">
            <h2 id="ready-template-title">
              {search.trim() ? 'Matching starters' : 'Ready to make your own'}
            </h2>
          </div>
          <div className="template-library-grid">
            {ready.map((template) => (
              <button className="template-card" key={template.slug} onClick={() => setSelected(template)}>
                <div className={`template-art template-tone-${template.tone}`} aria-hidden="true">
                  <TemplateIcon template={template} />
                  <span className="template-art-lines">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="template-art-result">
                    <FileText size={14} />
                    <span>Markdown report</span>
                  </span>
                </div>
                <div className="template-card-copy">
                  <span className="template-category">{template.category}</span>
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                  <span className="template-card-link">
                    Explore template
                    <ArrowRight size={14} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {planned.length > 0 && (
        <section className="planned-template-section" aria-labelledby="planned-template-title">
          <div className="section-heading">
            <div>
              <h2 id="planned-template-title">On the drawing board</h2>
              <p>Ideas for future starters. These templates aren’t available yet.</p>
            </div>
          </div>
          <div className="planned-template-grid">
            {planned.map((template) => (
              <article key={template.slug} className="planned-template">
                <div>
                  <FileText size={17} />
                  <span>Planned</span>
                </div>
                <h3>{template.name}</h3>
                <p>{template.description}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      {!ready.length && !planned.length && (
        <div className="template-no-results">
          <Search size={24} />
          <h2>No matching examples</h2>
          <p>Try “research,” “engineering,” or “support.”</p>
          <Button variant="secondary" onClick={() => setSearch('')}>
            Clear search
          </Button>
        </div>
      )}
      <TemplatePreview template={selected} onClose={() => setSelected(undefined)} />
    </div>
  );
}
