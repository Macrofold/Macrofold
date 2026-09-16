'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowRight, Pause, Play, Terminal } from 'lucide-react';
import Link from 'next/link';
import { CopyButton } from '../copy-button';
import { examples } from './examples';

const MotionContext = createContext({ paused: false, explicit: false });
export const useMarketingMotion = () => useContext(MotionContext);

export function MotionSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Playback is the visitor's choice. Visibility may suspend rendering, but
  // returning to the page must never turn that choice into a permanent pause.
  const [motionOverride, setMotionOverride] = useState<'playing' | 'paused'>('playing');
  const [explicit, setExplicit] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  const [benefitsVisible, setBenefitsVisible] = useState(false);
  const paused = motionOverride === 'paused';
  useEffect(() => {
    const surface = ref.current;
    if (!surface || motionOverride === 'paused' || hidden) return;
    const hover = matchMedia('(any-hover: hover)');
    let active: HTMLElement | null = null;
    let frame = 0;
    let x = 0;
    let y = 0;
    const leave = () => {
      active?.style.setProperty('--mf-gleam-strength', '0');
      active = null;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const move = (event: MouseEvent) => {
      if (!hover.matches) return leave();
      const target =
        event.target instanceof Element ? event.target.closest<HTMLElement>('.mf-gleam, .mf-primary') : null;
      if (target !== active) {
        leave();
        active = target;
      }
      if (!active) return;
      const box = active.getBoundingClientRect();
      x = Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100));
      y = Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100));
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          active?.style.setProperty('--mf-gleam-x', `${x}%`);
          active?.style.setProperty('--mf-gleam-y', `${y}%`);
          active?.style.setProperty('--mf-light-angle', `${108 + (x - 50) * 0.35 - (y - 50) * 0.25}deg`);
          active?.style.setProperty('--mf-gleam-strength', '1');
        });
    };
    // One delegated listener serves headings and CTAs, including swapped copy.
    // CSS owns the reflection's interpolation and slow ambient movement.
    surface.addEventListener('mousemove', move);
    surface.addEventListener('mouseleave', leave);
    return () => {
      leave();
      surface.removeEventListener('mousemove', move);
      surface.removeEventListener('mouseleave', leave);
    };
  }, [motionOverride, hidden]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target.classList.contains('mf-hero')) setHeroVisible(entry.isIntersecting);
        if (entry.target.classList.contains('mf-benefits')) setBenefitsVisible(entry.isIntersecting);
        if (entry.target instanceof HTMLElement)
          entry.target.dataset.lightVisible = String(entry.isIntersecting);
      }
    });
    ref.current
      ?.querySelectorAll('.mf-hero, .mf-section, .mf-pricing-content')
      .forEach((region) => observer.observe(region));
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return (
    <MotionContext.Provider
      value={{
        paused,
        explicit,
      }}
    >
      <div
        className={`mf-site ${className}`.trim()}
        ref={ref}
        data-motion={paused || hidden ? 'paused' : 'playing'}
        data-motion-override={motionOverride}
        data-hero-visible={heroVisible}
        data-benefits-visible={benefitsVisible}
      >
        {children}
        <button
          className="mf-motion"
          type="button"
          aria-pressed={paused}
          onClick={() => {
            setExplicit(true);
            setMotionOverride(paused ? 'playing' : 'paused');
          }}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? 'Play animations' : 'Pause animations'}
        </button>
      </div>
    </MotionContext.Provider>
  );
}

export function CodePanel() {
  const languages = Object.keys(examples) as (keyof typeof examples)[];
  const [language, setLanguage] = useState<keyof typeof examples>('TypeScript');
  return (
    <div className="mf-code-panel">
      <Tabs.Root
        value={language}
        onValueChange={(value) => {
          const found = languages.find((name) => name === value);
          if (found) setLanguage(found);
        }}
      >
        <div className="mf-code-toolbar">
          <Tabs.List aria-label="Example language">
            {languages.map((name) => (
              <Tabs.Trigger value={name} key={name}>
                {name === 'CLI' ? (
                  <Terminal size={16} />
                ) : (
                  <img src={`/brands/${name.toLowerCase()}.svg`} width={16} height={16} alt="" />
                )}
                {name}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <CopyButton variant="plain" text={examples[language]} label="Copy code example" iconOnly />
        </div>
        {languages.map((name) => (
          <Tabs.Content value={name} key={name}>
            <pre tabIndex={0} aria-label={`${name} run and stream example`}>
              <code>
                {examples[name].split('\n').map((line, i) => (
                  <span className="mf-code-line" key={i}>
                    {line
                      .split(/('[^']*'|"[^"]*"|\b(?:const|await|for|from|import|let|return|if|in|of)\b)/g)
                      .map((part, index) => (
                        <span
                          key={index}
                          className={
                            /^['"]/.test(part)
                              ? 'mf-code-string'
                              : /^(?:const|await|for|from|import|let|return|if|in|of)$/.test(part)
                                ? 'mf-code-keyword'
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
      <details className="mf-code-setup">
        <summary>
          Set up your first run
          <ArrowRight size={14} />
        </summary>
        <div>
          <p>
            Create a project in the dashboard and set <code>project_id</code> and{' '}
            <code>MACROFOLD_API_KEY</code>. Choose a compatible model from the catalog: this example uses
            OpenAI’s GPT-5.4 mini with Codex. The catalog determines the provider. Managed execution uses your
            credits; no saved session or agent preset is required.
          </p>
          <p>
            Follow the <Link href="/docs/sdk">SDK installation guide</Link>. Go is a function body with{' '}
            <code>ctx</code>, <code>projectID</code>, <code>fmt</code>, and the SDK import. Rust runs in an
            async function with a parsed project UUID. Install the <Link href="/docs/cli">Macrofold CLI</Link>
            , then log in and link a project.
          </p>
          <p>
            cURL uses <code>jq</code> to read the run ID. Keep the request key and body to recover an
            interrupted response. SDKs handle idempotency and stream reconnection.{' '}
            <Link href="/docs/api/quickstart">Complete API quickstart →</Link>
          </p>
        </div>
      </details>
    </div>
  );
}
