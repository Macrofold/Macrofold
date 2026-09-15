import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Github,
  Layers,
  Radio,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { docsRepository } from '../../lib/docs/settings';
import { headline, subtitle, homepages, type Homepage } from './catalog';
import { CapabilityDemo, FeatureStory, SnippetPanel, StudySurface } from './controls';

function Brand({ name }: { name: string }) {
  return (
    <Link href="/homepages" className="hp-brand">
      <Layers size={26} strokeWidth={1.6} aria-hidden="true" />
      <span>{name}</span>
    </Link>
  );
}

function SwarmArt({ thumbnail = false }: { thumbnail?: boolean }) {
  return (
    <div className="hp-hero-visual" aria-hidden="true">
      <Image
        src="/concepts/swarm.png"
        alt=""
        width={1536}
        height={1024}
        sizes={thumbnail ? '(max-width: 760px) 100vw, 50vw' : '(max-width: 760px) 100vw, 85vw'}
        priority={!thumbnail}
      />
      <div className="hp-light-field" />
    </div>
  );
}

function Hero({ study }: { study: Homepage }) {
  return (
    <section className={`hp-hero hp-hero-${study.hero}`} aria-label="Introduction">
      <SwarmArt />
      <div className="hp-hero-copy">
        <p className="hp-eyebrow">
          <span className="hp-spark" /> Open infrastructure for coding agents
        </p>
        <h1>{headline}</h1>
        <p className="hp-subtitle">{subtitle}</p>
        <div className="hp-actions">
          <Link href="/docs/quickstart" className="hp-primary">
            Start building <ArrowUpRight size={17} />
          </Link>
          <a href="#code" className="hp-secondary">
            See the code <ArrowDown size={16} />
          </a>
        </div>
        <p className="hp-open-note">
          <Github size={14} /> Open source <span>·</span> Apache 2.0 <span>·</span> Self-hostable
        </p>
      </div>
      <div className="hp-harness-strip">
        <span>The harnesses you know</span>
        <strong>Claude Code</strong>
        <strong>Codex</strong>
        <strong>OpenCode</strong>
      </div>
    </section>
  );
}

const capabilities = [
  {
    kind: 'stream',
    icon: Radio,
    title: 'Follow the work, as it happens.',
    body: 'Stream output and tool activity. Inspect results and replay retained run history from your application or the dashboard.',
    link: '/docs/api/events',
    label: 'Streaming and history',
  },
  {
    kind: 'tools',
    icon: Workflow,
    title: 'Give agents the right connections.',
    body: 'Add MCP servers, GitHub, web search, and Composio connections. Grant the tools each task needs.',
    link: '/docs/connections',
    label: 'Tools and integrations',
  },
  {
    kind: 'limits',
    icon: ShieldCheck,
    title: 'Keep the controls that matter.',
    body: 'Bring your model keys or use managed credits. Set spending, runtime, and concurrency limits before the work begins.',
    link: '/pricing',
    label: 'Usage and limits',
  },
] as const;

const integrationGroups = [
  { title: 'Native harnesses', names: ['Claude Code', 'Codex', 'OpenCode'] },
  { title: 'Model providers', names: ['Anthropic', 'OpenAI', 'OpenRouter'] },
  { title: 'Tools & projects', names: ['MCP', 'Composio', 'GitHub'] },
  { title: 'Search & web', names: ['Brave', 'Exa', 'Tavily', 'Parallel AI', 'Firecrawl'] },
];

export function HomepageSite({ study, name }: { study: Homepage; name: string }) {
  const index = homepages.indexOf(study);
  const next = homepages[(index + 1) % homepages.length] ?? homepages[0];
  return (
    <StudySurface className={`hp-page hp-${study.slug} hp-accent-${study.accent}`}>
      <div className="hp-review-bar">
        <Link href="/homepages">← All homepage studies</Link>
        <span>
          {String(index + 1).padStart(2, '0')} / {study.name}
        </span>
        <Link href={`/homepages/${next.slug}`}>Next version →</Link>
      </div>
      <header className="hp-nav">
        <Brand name={name} />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">Product</a>
          <a href="#integrations">Integrations</a>
          <Link href="/docs">Docs</Link>
          <Link href="/pricing">Pricing</Link>
          <a href={docsRepository}>
            <Github size={14} />
            GitHub
          </a>
        </nav>
        <Link className="hp-nav-action" href="/docs/quickstart">
          Get started <ArrowUpRight size={14} />
        </Link>
      </header>
      <main id="main-content">
        <Hero study={study} />
        <section className="hp-code-section hp-section" id="code" aria-labelledby="code-heading">
          <div className="hp-code-intro">
            <p className="hp-eyebrow">The entire harness. One request.</p>
            <h2 id="code-heading">
              Start with a few
              <br />
              lines of code.
            </h2>
            <p>
              Choose a project, harness, and model.
              <br />
              Give it a task. Let it work.
            </p>
            <Link href="/docs/api/quickstart" className="hp-text-link">
              Read the API quickstart <ArrowRight size={15} />
            </Link>
            <p className="hp-code-note">
              Native tools. Multi-step execution.
              <br />
              An ordinary API response to get you started.
            </p>
          </div>
          <SnippetPanel />
        </section>
        <section
          className="hp-product-section hp-section"
          id="how-it-works"
          aria-labelledby="product-heading"
        >
          <div className="hp-section-heading">
            <p className="hp-eyebrow">A familiar workflow. A different reach.</p>
            <h2 id="product-heading">{study.introduction}</h2>
            <p>
              Follow a project from its first file to independent agents,
              <br className="hp-desktop-break" /> saved versions, and the interfaces in your application.
            </p>
          </div>
          <FeatureStory study={study} />
        </section>
        <section className="hp-capabilities hp-section" aria-labelledby="capabilities-heading">
          <div className="hp-section-heading">
            <p className="hp-eyebrow">The rest of the workflow, connected</p>
            <h2 id="capabilities-heading">
              Make it part of
              <br />
              something bigger.
            </h2>
          </div>
          <div className="hp-capability-grid">
            {capabilities.map(({ kind, icon: Icon, title, body, link, label }) => (
              <article key={kind}>
                <CapabilityDemo kind={kind} />
                <div className="hp-capability-copy">
                  <Icon size={21} strokeWidth={1.5} />
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <Link href={link} className="hp-text-link">
                    {label}
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <p className="hp-demo-note">
            Diagrams illustrate the workflow; they do not display live account activity.
          </p>
        </section>
        <section
          className="hp-integration-section hp-section"
          id="integrations"
          aria-labelledby="integrations-heading"
        >
          <div>
            <p className="hp-eyebrow">Bring the rest of your stack</p>
            <h2 id="integrations-heading">
              The agents you trust.
              <br />
              The tools you need.
            </h2>
            <p>
              Native harnesses, your model provider, and authorized connections. One place to put them to
              work.
            </p>
            <Link href="/docs/connections" className="hp-text-link">
              Explore integrations <ArrowRight size={15} />
            </Link>
          </div>
          <div className="hp-integration-groups">
            {integrationGroups.map(({ title, names }) => (
              <div key={title}>
                <h3>{title}</h3>
                <div>
                  {names.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="hp-final hp-section">
          <div className="hp-final-field" aria-hidden="true" />
          <p className="hp-eyebrow">
            <Github size={15} /> Open source. Yours to build on.
          </p>
          <h2>
            What will you build
            <br />
            with all of this?
          </h2>
          <p>Read the source. Run it locally. Take it further.</p>
          <div className="hp-actions">
            <Link className="hp-primary" href="/docs/quickstart">
              Start building <ArrowUpRight size={17} />
            </Link>
            <a className="hp-secondary" href={docsRepository}>
              Explore the source <Github size={16} />
            </a>
          </div>
          <Link className="hp-self-host" href="/docs/self-hosting/vercel">
            Self-hosting guide →
          </Link>
        </section>
      </main>
      <footer className="hp-footer">
        <Brand name={name} />
        <span>AI developer infrastructure.</span>
        <nav aria-label="Footer navigation">
          <Link href="/docs">Documentation</Link>
          <Link href="/reference">API reference</Link>
          <Link href="/login">Dashboard</Link>
          <Link href="/concepts">Original designs</Link>
        </nav>
      </footer>
    </StudySurface>
  );
}

export function HomepageGallery({ name }: { name: string }) {
  return (
    <div className="hp-gallery">
      <header>
        <Brand name={name} />
        <span>Swarm / Homepage studies</span>
        <Link href="/concepts">Original designs ↗</Link>
      </header>
      <main id="main-content">
        <div className="hp-gallery-intro">
          <p className="hp-eyebrow">One direction. Ten ways to tell the story.</p>
          <h1>
            From Swarm
            <br />
            to {name}.
          </h1>
          <p>
            The same headline. The same product. Ten compositions and animated explanations to explore. All
            original designs remain available.
          </p>
        </div>
        <div className="hp-gallery-grid">
          {homepages.map((study, i) => (
            <article
              key={study.slug}
              className={`hp-gallery-card hp-${study.slug} hp-accent-${study.accent}`}
            >
              <Link
                className={`hp-thumbnail hp-thumb-${study.hero}`}
                href={`/homepages/${study.slug}`}
                aria-label={`Preview ${study.name}`}
              >
                <SwarmArt thumbnail />
                <div className="hp-thumbnail-nav">
                  <span>{name}</span>
                  <i />
                  <i />
                  <i />
                </div>
                <div className="hp-thumbnail-title">
                  Stand on the
                  <br />
                  Shoulders of Giants.
                </div>
                <div className="hp-thumbnail-lines">
                  <i />
                  <i />
                  <i />
                  <span />
                </div>
                <div className="hp-thumbnail-diagram" data-diagram={study.diagram}>
                  <i />
                  <i />
                  <i />
                  <i />
                  <b />
                </div>
                <span className="hp-thumbnail-number">{String(i + 1).padStart(2, '0')}</span>
              </Link>
              <div className="hp-gallery-card-copy">
                <div className="hp-gallery-meta">
                  <span>
                    {study.story === 'scroll'
                      ? 'Scroll-linked story'
                      : study.story === 'chapters'
                        ? 'Illustrated chapters'
                        : study.story === 'rail'
                          ? 'Step-by-step sequence'
                          : 'Interactive explorer'}
                  </span>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                </div>
                <h2>
                  <Link href={`/homepages/${study.slug}`}>
                    {study.name}
                    <ArrowUpRight size={24} />
                  </Link>
                </h2>
                <p>{study.description}</p>
                <span className="hp-study-references">{study.references}</span>
                <Link href={`/homepages/${study.slug}`} className="hp-text-link">
                  Explore {study.name}
                  <ArrowRight size={16} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </main>
      <footer>
        <span>Ten homepage studies · Swarm visual direction</span>
        <Link href="/concepts/swarm">View the original Swarm →</Link>
      </footer>
    </div>
  );
}
