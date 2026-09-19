'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ArrowRight, Check, Pause, Play } from 'lucide-react';
import { CopyButton } from '../copy-button';
import { stages, type Homepage } from './catalog';
import { examples, type ExampleLanguage, type ExampleOperation } from './examples';
import { FeatureDiagram } from './diagram';

export function StudySurface({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    const hero = ref.current?.querySelector('.hp-hero');
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(Boolean(entry?.isIntersecting)));
    if (hero) observer.observe(hero);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      data-motion={paused || hidden ? 'paused' : 'playing'}
      data-hero-visible={heroVisible}
    >
      {children}
      <button
        className="hp-motion-control"
        type="button"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
      >
        {paused ? <Play size={13} /> : <Pause size={13} />}
        {paused ? 'Play animations' : 'Pause animations'}
      </button>
    </div>
  );
}

/** Authored examples are rendered as text. This is small visual token coloring, not executable HTML. */
function CodeText({ value }: { value: string }) {
  return value.split('\n').map((line, row) => {
    const parts = line.split(/('[^']*'|"[^"]*"|\/\/.*|#.*|\b(?:import|from|const|await|for|in|of)\b)/g);
    return (
      <span className="hp-code-line" key={row}>
        <span className="hp-line-number" aria-hidden="true">
          {row + 1}
        </span>
        <span>
          {parts.map((part, i) => (
            <span
              key={i}
              className={
                /^['"]/.test(part)
                  ? 'hp-token-string'
                  : /^(?:#|\/\/)/.test(part)
                    ? 'hp-token-comment'
                    : /^(import|from|const|await|for|in|of)$/.test(part)
                      ? 'hp-token-keyword'
                      : undefined
              }
            >
              {part}
            </span>
          ))}
        </span>
      </span>
    );
  });
}

export function SnippetPanel() {
  const [language, setLanguage] = useState<ExampleLanguage>('TypeScript');
  const [operation, setOperation] = useState<ExampleOperation>('Run');
  const operations = ['Run', 'Stream', 'Continue'] as const;
  const languages = Object.keys(examples) as ExampleLanguage[];
  return (
    <div className="hp-snippet">
      <div className="hp-example-operations" role="group" aria-label="Example operation">
        {operations.map((item, i) => (
          <button
            key={item}
            type="button"
            aria-pressed={operation === item}
            onClick={() => setOperation(item)}
          >
            <span>0{i + 1}</span>
            {item}
          </button>
        ))}
        <span className="hp-endpoint">
          {operation === 'Stream' ? 'SSE /v1/runs/:id/stream' : 'POST /v1/runs'}
        </span>
      </div>
      <Tabs.Root
        value={language}
        onValueChange={(value) => {
          const item = languages.find((key) => key === value);
          if (item) setLanguage(item);
        }}
      >
        <div className="hp-code-toolbar">
          <Tabs.List aria-label="Example language">
            {languages.map((item) => (
              <Tabs.Trigger key={item} value={item}>
                {item}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <CopyButton
            variant="plain"
            text={examples[language][operation]}
            label="Copy code example"
            iconOnly
          />
        </div>
        {languages.map((item) => (
          <Tabs.Content value={item} key={item}>
            <pre tabIndex={0} aria-label={`${item} ${operation.toLowerCase()} example`}>
              <code>
                <CodeText value={examples[item][operation]} />
              </code>
            </pre>
          </Tabs.Content>
        ))}
      </Tabs.Root>
      <div className="hp-code-result">
        <Check size={13} />
        <span>
          {operation === 'Run'
            ? 'Returns a run ID. The agent works asynchronously.'
            : operation === 'Stream'
              ? 'Follow output and tool events as the agent works.'
              : 'After the current run finishes, continue its session.'}
        </span>
      </div>
      <details className="hp-setup">
        <summary>
          Set up this example <span>↗</span>
        </summary>
        <div>
          <p>
            Install from source with the <Link href="/docs/sdk">SDK guide</Link>. Set{' '}
            <code>MACROFOLD_API_KEY</code>, <code>workspace_id</code>. This example selects Codex and OpenAI’s
            GPT-5.4 mini; the model catalog determines its provider. No saved session or agent preset is
            required. SDKs default to the hosted API; pass <code>baseURL</code> or <code>base_url</code> for
            local development or self-hosting.
          </p>
          <p>
            Use <code>fixture-model</code> with the free local simulator. Managed cloud execution needs
            credits; account limits and default spending/runtime limits apply. Optional limits can be set
            explicitly.
          </p>
          <p>
            For cURL, set <code>MACROFOLD_API_KEY</code>, replace bracketed IDs, and save the returned
            run/session IDs. Reuse the request key and body after a lost response. cURL streams rotate; use
            the SDK for automatic reconnection.
          </p>
          <p>
            Install the <Link href="/docs/cli">Macrofold CLI</Link>, log in, and link your workspace. Use
            returned IDs for reattachment and continuation.{' '}
            <Link href="/docs/api/quickstart">Complete quickstart →</Link>
          </p>
        </div>
      </details>
    </div>
  );
}

function StageCopy({ index }: { index: number }) {
  const stage = stages[index];
  if (!stage) return null;
  return (
    <>
      <p className="hp-eyebrow">
        0{index + 1} / {stage.label}
      </p>
      <h3>{stage.title}</h3>
      <p className="hp-stage-body">{stage.body}</p>
      <div className="hp-local-cloud">
        <span>{stage.local}</span>
        <ArrowRight size={16} />
        <strong>{stage.cloud}</strong>
      </div>
      <p className="hp-stage-detail">{stage.detail}</p>
      <Link className="hp-text-link" href={stage.link}>
        Explore {index === 4 ? 'the API' : index === 3 ? 'the CLI' : 'worktrees'} <ArrowRight size={14} />
      </Link>
    </>
  );
}

export function FeatureStory({ study }: { study: Homepage }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(mobile.matches);
    update();
    mobile.addEventListener('change', update);
    return () => mobile.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (study.story !== 'scroll' || compact) return;
    const sections = [...(ref.current?.querySelectorAll<HTMLElement>('[data-feature-step]') ?? [])];
    // Observe a band around the reading position; normal scrolling remains entirely browser-owned.
    const observer = new IntersectionObserver(
      () => {
        const midpoint = window.innerHeight / 2;
        const centered = sections.findIndex((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.top <= midpoint && bounds.bottom >= midpoint;
        });
        if (centered >= 0) setActive(centered);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    sections.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [study.story, compact]);
  function choose(index: number) {
    setActive(index);
    if (study.story === 'scroll' && !compact)
      ref.current
        ?.querySelectorAll<HTMLElement>('[data-feature-step]')
        [index]?.scrollIntoView({ block: 'center' });
  }

  if (study.story === 'chapters')
    return (
      <div className="hp-story-chapters" aria-label="How hosted workspaces work">
        {stages.map((stage, index) => (
          <article key={stage.id} className="hp-chapter" aria-label={stage.label}>
            <div className="hp-stage-copy">
              <StageCopy index={index} />
            </div>
            <FeatureDiagram stage={index} style={study.diagram} />
          </article>
        ))}
      </div>
    );

  if (study.story === 'scroll' && !compact)
    return (
      <div ref={ref} className="hp-story-scroll" aria-label="How hosted workspaces work">
        <div className="hp-scroll-copy">
          {stages.map((stage, index) => (
            <article
              id={`feature-${stage.id}`}
              key={stage.id}
              data-feature-step={index}
              className="hp-stage-copy"
              aria-label={stage.label}
              data-active={active === index}
            >
              <StageCopy index={index} />
            </article>
          ))}
        </div>
        <aside className="hp-story-sticky" aria-label="Workspace walkthrough diagram">
          <div className="hp-stage-dots" role="group" aria-label="Jump to a feature">
            {stages.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                aria-label={stage.label}
                aria-pressed={active === index}
                onClick={() => choose(index)}
              >
                0{index + 1}
              </button>
            ))}
          </div>
          <FeatureDiagram stage={active} style={study.diagram} />
          <p className="hp-scroll-hint">
            Scroll to explore <span>↓</span>{' '}
            <span>
              {active + 1} / 5 · {stages[active]?.label}
            </span>
          </p>
        </aside>
      </div>
    );

  return (
    <Tabs.Root
      value={String(active)}
      onValueChange={(value) => {
        const index = Number(value);
        if (stages[index]) setActive(index);
      }}
      className={`hp-story-tabs ${study.story === 'rail' ? 'hp-story-rail' : ''}`}
      orientation={study.slug === 'workbench' && !compact ? 'vertical' : 'horizontal'}
    >
      <Tabs.List aria-label="Explore the product">
        {stages.map((stage, index) => (
          <Tabs.Trigger key={stage.id} value={String(index)}>
            <span>0{index + 1}</span>
            {stage.label}
            <ArrowRight size={15} />
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {stages.map((stage, index) => (
        <Tabs.Content key={stage.id} value={String(index)}>
          <div className="hp-stage-copy">
            <StageCopy index={index} />
          </div>
          <FeatureDiagram stage={index} style={study.diagram} />
        </Tabs.Content>
      ))}
      {study.story === 'rail' && (
        <div className="hp-rail-controls">
          <button type="button" disabled={active === 0} onClick={() => choose(active - 1)}>
            <ArrowLeft size={16} />
            Previous feature
          </button>
          <span>{active + 1} / 5</span>
          <button type="button" disabled={active === 4} onClick={() => choose(active + 1)}>
            Next feature
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <noscript>
        <div className="hp-no-script">
          {stages.slice(1).map((stage) => (
            <p key={stage.id}>
              <strong>{stage.title}</strong> {stage.body}
            </p>
          ))}
        </div>
      </noscript>
    </Tabs.Root>
  );
}

export function CapabilityDemo({ kind }: { kind: 'stream' | 'tools' | 'limits' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`hp-capability-demo hp-demo-${kind}`} data-visible={visible} aria-hidden="true">
      {kind === 'stream' ? (
        <div className="hp-event-demo">
          {['request accepted', 'agent uses a tool', 'output streamed', 'checkpoint saved'].map((text, i) => (
            <div key={text} style={{ animationDelay: `${i * 0.55}s` }}>
              <span>0{i + 1}</span>
              <i />
              {text}
            </div>
          ))}
        </div>
      ) : kind === 'tools' ? (
        <div className="hp-tools-demo">
          <span>MCP</span>
          <span>GitHub</span>
          <span>Search</span>
          <div className="hp-tool-links">
            <i />
            <i />
            <i />
          </div>
          <strong>Granted tools</strong>
        </div>
      ) : (
        <div className="hp-limits-demo">
          <div>
            Execution window <span>bounded</span>
          </div>
          <i />
          <div>
            Spending <span>explicit limits</span>
          </div>
          <i />
          <p>BYOK or managed credits</p>
        </div>
      )}
    </div>
  );
}
