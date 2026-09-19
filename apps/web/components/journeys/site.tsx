import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Clock3,
  Code2,
  CreditCard,
  KeyRound,
  Layers,
  Radio,
  ShieldCheck,
  Star,
  Webhook,
} from 'lucide-react';
import { docsRepository, docsSourceUrl } from '../../lib/docs/settings';
import snapshot from '../../../../packages/providers/data/connector-catalog.json';
import { BrandedText, Mark } from './brands';
import { CodePanel, Surface, UseCaseJourney } from './controls';
import { extras, headline, journeys, subtitle, type Journey } from './catalog';
import { JourneyDiagram } from './diagram';
import { useCases } from './catalog';

const contributor = docsSourceUrl('CONTRIBUTING.md');
function Brand() {
  return (
    <a className="jl-brand" href="/journeys">
      <Layers size={25} strokeWidth={1.4} />
      Macrofold
    </a>
  );
}
function Actions() {
  return (
    <div className="jl-actions">
      <Link className="jl-primary" href="/register">
        Start building <ArrowUpRight size={17} />
      </Link>
      <Link className="jl-secondary" href="/docs">
        View docs <ArrowRight size={16} />
      </Link>
    </div>
  );
}

export function JourneySite({ study }: { study: Journey }) {
  const index = journeys.indexOf(study);
  const extra = extras[study.extra];
  return (
    <Surface>
      <div className="jl-review">
        <a href="/journeys">← Journey library</a>
        <span>
          {String(index + 1).padStart(2, '0')} / {study.name}
        </span>
        <a href={`/journeys/${journeys[(index + 1) % journeys.length]!.slug}`}>Next version →</a>
      </div>
      <header className="jl-nav">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#integrations">Integrations</a>
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
        </nav>
        <Link className="jl-nav-cta" href="/register">
          Start building <ArrowUpRight size={14} />
        </Link>
      </header>
      <main id="main-content">
        <section className="jl-hero" aria-label="Introduction">
          <div className="jl-hero-art" aria-hidden="true">
            <Image
              src="/concepts/swarm.png"
              width={1536}
              height={1024}
              priority
              sizes="(max-width: 900px) 100vw, 80vw"
              alt=""
            />
            <div />
          </div>
          <div className="jl-hero-copy">
            <p className="jl-eyebrow">
              <i /> AI developer infrastructure
            </p>
            <h1 className="jl-gleam">{headline}</h1>
            <p className="jl-subtitle">
              <BrandedText>{subtitle}</BrandedText>
            </p>
            <Actions />
            <div className="jl-source-links">
              <a className="jl-github-icon" href={docsRepository} aria-label="GitHub repository">
                <img src="/brands/github.svg" width={19} height={19} alt="" />
              </a>
              <a href={contributor}>Contributor guide.</a>
              <a
                className="jl-star"
                href={docsRepository}
                aria-label="Star on GitHub"
                title="Open the repository and choose Star on GitHub"
              >
                <Star size={13} />
                Star
              </a>
            </div>
          </div>
        </section>
        <section className="jl-section jl-code-section" id="code" aria-labelledby="code-heading">
          <div className="jl-section-heading">
            <h2 className="jl-gleam" id="code-heading">
              Start with a few lines of code.
            </h2>
            <p>
              Choose a workspace, harness, and model.
              <br />
              Give it a task. Let it work.
            </p>
            <Link className="jl-text-link" href="/docs/api/quickstart">
              Read the API quickstart <ArrowRight size={14} />
            </Link>
          </div>
          <CodePanel />
        </section>
        <section className="jl-section jl-product" id="product" aria-labelledby="product-heading">
          <div className="jl-section-heading">
            <p className="jl-eyebrow">A working environment. Ready to invoke.</p>
            <h2 className="jl-gleam" id="product-heading">
              An entire agent harness as one unit of execution.
            </h2>
            <p>
              Everything agents can do on your computer, available in your product or internal tool.
              <br />
              <Link href="/docs/connectors">
                {snapshot.data.length.toLocaleString('en-US')} connectors. Thousands of tools.
              </Link>
            </p>
          </div>
          <UseCaseJourney study={study} />
        </section>
        <section className="jl-section jl-capabilities" aria-labelledby="bigger-heading">
          <div className="jl-section-heading">
            <h2 className="jl-gleam" id="bigger-heading">
              Make it part of something bigger.
            </h2>
          </div>
          <div className="jl-capability-grid">
            <article>
              <div className="jl-mini jl-mini-billing" aria-hidden="true">
                <span>
                  <KeyRound />
                  Your keys
                </span>
                <i />
                <span>
                  <CreditCard />
                  Managed credits
                </span>
                <div className="jl-meter">
                  <b />
                  <b />
                  <b />
                  <b />
                  <b />
                </div>
              </div>
              <h3 className="jl-gleam">Your keys. Or managed credits.</h3>
              <p>
                Bring your model API keys, or use managed credits. Pay for the compute you use; model,
                storage, and tool charges depend on your setup.
              </p>
              <Link className="jl-text-link" href="/pricing">
                Explore pricing <ArrowRight size={14} />
              </Link>
            </article>
            <article>
              <div className="jl-mini jl-mini-triggers" aria-hidden="true">
                <div>
                  <Mark name="Slack" />
                  <span>
                    <Webhook size={18} />
                    Webhook
                  </span>
                  <span>
                    <Clock3 size={18} />
                    Schedule
                  </span>
                </div>
                <div className="jl-mini-traces">
                  <i />
                  <i />
                  <i />
                </div>
                <strong>
                  <Code2 size={17} />
                  API
                </strong>
              </div>
              <h3 className="jl-gleam">Start from the right moment.</h3>
              <p>
                Wire a <Mark name="Slack" /> handler, a webhook, or your scheduler to the same run API. Your
                application chooses when the agent starts.
              </p>
              <Link className="jl-text-link" href="/docs/api/quickstart">
                Connect your triggers <ArrowRight size={14} />
              </Link>
            </article>
            <article>
              <div className="jl-mini jl-mini-extra" aria-hidden="true">
                <ShieldCheck size={28} />
                <div>
                  {['Request', 'Execution', 'Saved result'].map((label) => (
                    <span key={label}>
                      <Radio size={11} />
                      {label}
                      <i />
                    </span>
                  ))}
                </div>
              </div>
              <h3 className="jl-gleam">{extra[0]}</h3>
              <p>{extra[1]}</p>
              <Link className="jl-text-link" href={extra[2]}>
                {extra[3]} <ArrowRight size={14} />
              </Link>
            </article>
          </div>
        </section>
        <section className="jl-section jl-integrations" id="integrations">
          <div>
            <p className="jl-eyebrow">Your stack, connected</p>
            <h2 className="jl-gleam">
              The agents you trust.
              <br />
              The tools you need.
            </h2>
            <p>Native harnesses, model providers, and the tools your work depends on.</p>
            <Link className="jl-text-link" href="/docs/connectors">
              Explore all connectors <ArrowRight size={14} />
            </Link>
          </div>
          <div className="jl-integration-groups">
            {[
              ['Native harnesses', ['Claude Code', 'Codex', 'OpenCode']],
              ['Model providers', ['Anthropic', 'OpenAI', 'OpenRouter']],
              ['Tools', ['Custom MCP', 'Built-in connectors']],
              ['Search and web', ['Brave', 'Exa', 'Tavily', 'Parallel AI', 'Firecrawl']],
              ['Version control', ['Git', 'GitHub']],
            ].map(([label, names]) => (
              <div key={String(label)}>
                <h3>{label}</h3>
                <div>
                  {(names as string[]).map((name) => (
                    <Link key={name} href="/docs/connectors">
                      <Mark name={name} />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="jl-section jl-final">
          <div className="jl-final-field" aria-hidden="true" />
          <p className="jl-eyebrow">From your next idea to working software</p>
          <h2 className="jl-gleam">Let’s build.</h2>
          <p>Bring a task. Give it a place to work.</p>
          <Actions />
          <div className="jl-contribute">
            <a href={contributor}>
              Contribute to open source <ArrowUpRight size={13} />
            </a>
            <Link href="/docs/self-hosting">
              Self-host <ArrowUpRight size={13} />
            </Link>
          </div>
        </section>
      </main>
      <footer className="jl-footer">
        <Brand />
        <span>AI developer infrastructure.</span>
        <nav aria-label="Footer navigation">
          <Link href="/docs">Documentation</Link>
          <Link href="/reference">API reference</Link>
          <a href={docsRepository}>
            <Mark name="GitHub" />
          </a>
        </nav>
      </footer>
    </Surface>
  );
}

export function JourneyGallery() {
  return (
    <div className="jl-gallery">
      <header className="jl-nav">
        <Brand />
        <nav aria-label="Design libraries">
          <Link href="/concepts">Original designs</Link>
          <Link href="/homepages">Homepage studies</Link>
        </nav>
      </header>
      <main id="main-content">
        <section className="jl-gallery-intro">
          <p className="jl-eyebrow">Foundation / Journey library / Round 03</p>
          <h1 className="jl-gleam">
            One foundation.
            <br />
            Ten ways to show what’s possible.
          </h1>
          <p>
            The same Swarm hero and cyan palette. Three use cases. Five connected capabilities. Explore
            different ways to make the product click.
          </p>
        </section>
        <div className="jl-gallery-grid">
          {journeys.map((study, index) => (
            <article key={study.slug}>
              <a
                className="jl-gallery-preview"
                href={`/journeys/${study.slug}`}
                aria-label={`Preview ${study.name}`}
              >
                <JourneyDiagram stage={2} form={study.form} useCase={useCases[0]} />
              </a>
              <div className="jl-gallery-copy">
                <p className="jl-eyebrow">
                  {String(index + 1).padStart(2, '0')} /{' '}
                  {study.layout === 'chapters'
                    ? 'Illustrated chapters'
                    : study.layout === 'wide'
                      ? 'Panoramic scroll'
                      : study.layout === 'reverse'
                        ? 'Diagram-first scroll'
                        : 'Scroll-linked journey'}
                </p>
                <h2>{study.name}</h2>
                <p>{study.description}</p>
                <a className="jl-text-link" href={`/journeys/${study.slug}`}>
                  Explore {study.name}
                  <ArrowUpRight size={16} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </main>
      <footer className="jl-footer">
        <Boxes size={18} />
        <span>Design previews. Earlier libraries remain available.</span>
        <Link href="/homepages">Homepage studies →</Link>
      </footer>
    </div>
  );
}
