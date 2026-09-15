'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowRight, Pause, Play } from 'lucide-react';
import { CopyButton } from '../copy-button';
import { BrandedText, Mark } from './brands';
import { examples } from './examples';
import { pillars, useCases, type Journey, type UseCase } from './catalog';
import { JourneyDiagram } from './diagram';

export function Surface({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(Boolean(entry?.isIntersecting)));
    const hero = ref.current?.querySelector('.jl-hero');
    if (hero) observer.observe(hero);
    return () => {
      document.removeEventListener('visibilitychange', update);
      observer.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      className="jl-page"
      data-motion={paused || hidden ? 'paused' : 'playing'}
      data-hero-visible={heroVisible}
    >
      {children}
      <button className="jl-motion" type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
        {paused ? <Play size={13} /> : <Pause size={13} />}
        {paused ? 'Play animations' : 'Pause animations'}
      </button>
    </div>
  );
}

export function CodePanel() {
  const [language, setLanguage] = useState<keyof typeof examples>('TypeScript');
  const languages = Object.keys(examples) as (keyof typeof examples)[];
  return (
    <div className="jl-code-panel">
      <Tabs.Root
        value={language}
        onValueChange={(value) => {
          const found = languages.find((x) => x === value);
          if (found) setLanguage(found);
        }}
      >
        <div className="jl-code-toolbar">
          <Tabs.List aria-label="Example language">
            {languages.map((name) => (
              <Tabs.Trigger value={name} key={name}>
                <Mark name={name} />
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <CopyButton variant="plain" text={examples[language]} label="Copy code example" iconOnly />
        </div>
        {languages.map((name) => (
          <Tabs.Content value={name} key={name}>
            <pre tabIndex={0} aria-label={`${name} run and stream example`}>
              <code>
                {examples[name].split('\n').map((line, index) => (
                  <span className="jl-code-line" key={index}>
                    {line
                      .split(/('[^']*'|"[^"]*"|\b(?:const|await|for|from|import|let|return|if|in|of)\b)/g)
                      .map((part, i) => (
                        <span
                          key={i}
                          className={
                            /^['"]/.test(part)
                              ? 'jl-code-string'
                              : /^(?:const|await|for|from|import|let|return|if|in|of)$/.test(part)
                                ? 'jl-code-keyword'
                                : undefined
                          }
                        >
                          {part}
                        </span>
                      ))}
                  </span>
                ))}
              </code>
            </pre>
          </Tabs.Content>
        ))}
      </Tabs.Root>
      <details className="jl-setup">
        <summary>
          Set up your first run <ArrowRight size={14} />
        </summary>
        <div>
          <p>
            Create a project in the dashboard and set <code>project_id</code> and{' '}
            <code>MACROFOLD_API_KEY</code>. Choose a compatible model from the catalog: this example uses
            OpenAI’s GPT-5.4 mini with Codex. The catalog determines the provider. Managed execution uses your
            credits; no saved session or agent preset is required.
          </p>
          <p>
            Follow the <Link href="/docs/sdk">SDK installation guide</Link>. <Mark name="Go" /> is a function
            body with <code>ctx</code>, <code>projectID</code>, <code>fmt</code>, and the SDK import;{' '}
            <Mark name="Rust" /> runs in an async function with a parsed project UUID. The <Mark name="CLI" />{' '}
            command runs after <Link href="/docs/cli">installation</Link>, login, and project linking.
          </p>
          <p>
            <Mark name="cURL" /> uses <code>jq</code> to extract the ID. Keep the request key and body if a
            response is interrupted. SDKs handle idempotency and stream reconnection for you.{' '}
            <Link href="/docs/api/quickstart">Complete API quickstart →</Link>
          </p>
        </div>
      </details>
    </div>
  );
}

function StageCopy({ useCase, stage }: { useCase: UseCase; stage: number }) {
  const pillar = pillars[stage];
  const copy = useCase.stages[stage];
  if (!pillar || !copy) return null;
  return (
    <>
      <p className="jl-eyebrow">
        0{stage + 1} <span>/</span> <BrandedText>{pillar.label}</BrandedText>
      </p>
      <h3 className="jl-gleam">{copy[0]}</h3>
      <p>
        <BrandedText>{copy[1]}</BrandedText>
      </p>
      <Link className="jl-text-link" href={pillar.link}>
        {stage === 4 ? 'Browse all connectors' : 'Explore this feature'}
        <ArrowRight size={14} />
      </Link>
    </>
  );
}

function Story({ study, useCase }: { study: Journey; useCase: UseCase }) {
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = matchMedia('(max-width: 900px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (compact || study.layout === 'chapters') return;
    const sections = [...(ref.current?.querySelectorAll<HTMLElement>('[data-journey-step]') || [])];
    const observer = new IntersectionObserver(
      () => {
        const center = innerHeight * 0.52;
        const index = sections.findIndex((section) => {
          const bounds = section.getBoundingClientRect();
          return bounds.top <= center && bounds.bottom >= center;
        });
        if (index >= 0) setStage(index);
      },
      { rootMargin: '-50% 0px -46% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [compact, study.layout]);
  if (compact)
    return (
      <Tabs.Root
        value={String(stage)}
        onValueChange={(v) => setStage(Number(v))}
        className="jl-compact-story"
      >
        <Tabs.List aria-label="Explore the five pillars">
          {pillars.map((pillar, i) => (
            <Tabs.Trigger key={pillar.label} value={String(i)}>
              <BrandedText>{pillar.label}</BrandedText>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {pillars.map((pillar, i) => (
          <Tabs.Content key={pillar.label} value={String(i)}>
            <div className="jl-stage-copy">
              <StageCopy stage={i} useCase={useCase} />
            </div>
            <JourneyDiagram stage={i} useCase={useCase} form={study.form} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    );
  if (study.layout === 'chapters')
    return (
      <div className="jl-chapters">
        {pillars.map((pillar, i) => (
          <article key={pillar.label} data-journey-step={i}>
            <div className="jl-stage-copy">
              <StageCopy stage={i} useCase={useCase} />
            </div>
            <JourneyDiagram stage={i} useCase={useCase} form={study.form} />
          </article>
        ))}
      </div>
    );
  return (
    <div ref={ref} className={`jl-story jl-story-${study.layout}`}>
      <div className="jl-story-copy">
        {pillars.map((pillar, i) => (
          <article
            data-journey-step={i}
            key={pillar.label}
            className="jl-stage-copy"
            data-active={stage === i}
          >
            <StageCopy stage={i} useCase={useCase} />
          </article>
        ))}
      </div>
      <aside className="jl-sticky" aria-label="Evolving workspace diagram">
        <div className="jl-step-nav" role="group" aria-label="Jump to a pillar">
          {pillars.map((pillar, i) => (
            <button
              type="button"
              key={pillar.label}
              aria-label={pillar.label}
              aria-pressed={i === stage}
              onClick={() =>
                ref.current
                  ?.querySelectorAll<HTMLElement>('[data-journey-step]')
                  [i]?.scrollIntoView({ block: 'center' })
              }
            >
              0{i + 1}
            </button>
          ))}
        </div>
        <JourneyDiagram stage={stage} form={study.form} useCase={useCase} />
        <p className="jl-scroll-note">
          Scroll to explore <span>↓</span>
        </p>
      </aside>
    </div>
  );
}

export function UseCaseJourney({ study }: { study: Journey }) {
  const [selected, setSelected] = useState<UseCase>(useCases[0]);
  return (
    <div className="jl-use-case">
      <div className="jl-use-case-picker">
        <span>Use cases:</span>
        <div role="group" aria-label="Choose a use case">
          {useCases.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected.id === item.id}
              onClick={() => setSelected(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="jl-incoming">
        <span>Start with a prompt</span>
        <p>“{selected.prompt}”</p>
        <i />
      </div>
      <Story key={selected.id} study={study} useCase={selected} />
      <noscript>
        <div className="jl-no-script">
          {useCases.map((item) => (
            <article key={item.id}>
              <h3>{item.label}</h3>
              <p>{item.prompt}</p>
              {item.stages.map(([title, body]) => (
                <p key={title}>
                  <strong>{title}</strong> {body}
                </p>
              ))}
            </article>
          ))}
        </div>
      </noscript>
    </div>
  );
}
