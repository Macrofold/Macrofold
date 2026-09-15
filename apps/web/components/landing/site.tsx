import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Star,
  Layers,
  KeyRound,
  CreditCard,
  Clock3,
  Webhook,
  History,
  Radio,
  ShieldCheck,
  LockKeyhole,
  Boxes,
  Terminal,
  Check,
  GitBranch,
} from 'lucide-react';
import { docsRepository, docsSourceUrl } from '../../lib/docs/settings';
import { headline, subtitle } from './content';
import { CodePanel, MotionSurface } from './controls';
import { CustomerStory } from './customer-story';
import { ProductStory } from './story';
import { BrandLockup } from '../brand-lockup';
import './site.css';

const contributor = docsSourceUrl('CONTRIBUTING.md');
function Brand({ name }: { name: string }) {
  return (
    <a className="mf-brand" href="/">
      <BrandLockup name={name} />
    </a>
  );
}
function Actions() {
  return (
    <div className="mf-actions">
      <Link className="mf-primary" href="/register">
        Start building
        <ArrowUpRight size={17} />
      </Link>
      <Link className="mf-secondary" href="/docs">
        View docs
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}

const benefits = [
  {
    title: 'BYOK or Use Credits',
    body: 'Bring your own model keys or use managed credits. Pay for the compute you use, with model, storage, and tool charges based on your setup.',
    link: '/pricing',
    label: 'Explore pricing',
    icon: KeyRound,
  },
  {
    title: 'Start at the right moment.',
    body: 'Trigger an agent from a Slack message, a webhook, or a recurring schedule. Connect an agent preset to a project and let the work begin.',
    link: '/docs/triggers',
    label: 'Set up a trigger',
    icon: Webhook,
  },
  {
    title: 'Pick up where you left off.',
    body: 'Continue a compatible native session with its conversation and project files. Give another instruction without rebuilding the context from scratch.',
    link: '/docs/runs',
    label: 'Explore sessions',
    icon: History,
  },
  {
    title: 'See the work as it happens.',
    body: 'Stream progress and tool activity into your product. Follow live output, inspect results, and replay the run’s recorded events later.',
    link: '/docs/api/events',
    label: 'Explore streaming',
    icon: Radio,
  },
  {
    title: 'Scope access to the task.',
    body: 'Choose the projects, connections, and tools an agent can use. Scoped grants and server-side authorization keep access tied to the task.',
    link: '/docs/connections',
    label: 'Control access',
    icon: ShieldCheck,
  },
  {
    title: 'A boundary around every run.',
    body: 'Execute agents in isolated sandboxes. Infrastructure credentials stay outside agent processes, and stored provider keys and published checkpoints are encrypted.',
    link: '/docs/concepts',
    label: 'Understand the platform',
    icon: LockKeyhole,
  },
] as const;

function BenefitVisual({ index }: { index: number }) {
  if (index === 0)
    return (
      <div className="mf-benefit-visual mf-billing" aria-hidden="true">
        <span>
          <KeyRound size={21} />
          Your keys
        </span>
        <i />
        <span>
          <CreditCard size={21} />
          Credits
        </span>
        <div className="mf-usage-bars">
          {[30, 45, 38, 58, 74, 63, 86, 73, 93, 80].map((h, i) => (
            <b key={i} style={{ height: `${h}%`, animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
      </div>
    );
  if (index === 1)
    return (
      <div className="mf-benefit-visual mf-triggers" aria-hidden="true">
        <span>
          <img src="/brands/slack.svg" width={22} height={22} alt="" />
          <Webhook size={22} />
          <Clock3 size={22} />
        </span>
        <i />
        <div>
          <img src="/brands/codex.svg" width={22} height={22} alt="" />
          Codex
        </div>
      </div>
    );
  if (index === 2)
    return (
      <div className="mf-benefit-visual mf-session" aria-hidden="true">
        <span>
          Explore the idea.
          <Check size={13} />
        </span>
        <i />
        <span>
          Take it further.
          <span className="mf-prompt-cursor" />
        </span>
        <History size={25} />
      </div>
    );
  if (index === 3)
    return (
      <div className="mf-benefit-visual mf-stream" aria-hidden="true">
        {['Reading project files', 'Running tools', 'Writing the result'].map((t, i) => (
          <span key={t} style={{ animationDelay: `${i * 350}ms` }}>
            <i />
            {t}
            <b />
          </span>
        ))}
      </div>
    );
  if (index === 4)
    return (
      <div className="mf-benefit-visual mf-access" aria-hidden="true">
        <ShieldCheck size={47} />
        <div>
          <span>
            <Check size={12} />
            Selected project
          </span>
          <span>
            <Check size={12} />
            Approved tools
          </span>
          <span>
            <LockKeyhole size={12} />
            Your policy
          </span>
        </div>
      </div>
    );
  return (
    <div className="mf-benefit-visual mf-isolation" aria-hidden="true">
      <div>
        <LockKeyhole size={18} />
        <i />
        <span>
          <img src="/brands/codex.svg" width={23} height={23} alt="" />
          <img src="/brands/claude.svg" width={23} height={23} alt="" />
          <img src="/brands/opencode.svg" width={23} height={23} alt="" />
        </span>
      </div>
    </div>
  );
}

const integrationGroups = [
  {
    label: 'Agent harnesses',
    items: [
      ['Claude Code', 'claude'],
      ['Codex', 'codex'],
      ['OpenCode', 'opencode'],
      ['Hermes', 'hermes.png'],
      ['DeepSeek Harness', 'deepseek'],
      ['Pi', 'pi'],
    ],
  },
  {
    label: 'Model providers',
    items: [
      ['Anthropic', 'anthropic'],
      ['OpenAI', 'openai-mark'],
      ['OpenRouter', 'openrouter'],
    ],
  },
  {
    label: 'Tools',
    items: [
      ['Custom MCP', 'mcp'],
      ['Built-in Connectors (1,000+).', ''],
    ],
  },
  {
    label: 'Search and web',
    items: [
      ['Brave', 'brave'],
      ['Exa', 'exa'],
      ['Tavily', 'tavily'],
      ['Parallel AI', 'parallel'],
      ['Firecrawl', 'firecrawl'],
    ],
  },
  {
    label: 'Version control',
    items: [
      ['Git', 'git'],
      ['GitHub', 'github'],
    ],
  },
] as const;

export function SiteHeader({ name }: { name: string }) {
  return (
    <>
      <a className="mf-skip" href="#main-content">
        Skip to content
      </a>
      <header className="mf-nav">
        <Brand name={name} />
        <nav aria-label="Main navigation">
          <a href="/site#product">Product</a>
          <a href="/site#integrations">Integrations</a>
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
        </nav>
        <Link className="mf-signin" href="/login">
          Sign in
          <ArrowUpRight size={14} />
        </Link>
      </header>
    </>
  );
}

export function SiteFooter({ name }: { name: string }) {
  return (
    <footer className="mf-footer">
      <Brand name={name} />
      <nav aria-label="Footer navigation">
        <Link href="/docs">Documentation</Link>
        <Link href="/reference">API reference</Link>
        <a href={docsRepository}>GitHub</a>
        {process.env.PRIVACY_URL?.startsWith('https://') && <a href={process.env.PRIVACY_URL}>Privacy</a>}
        {process.env.TERMS_URL?.startsWith('https://') && <a href={process.env.TERMS_URL}>Terms</a>}
        {process.env.SUPPORT_EMAIL && <a href={`mailto:${process.env.SUPPORT_EMAIL}`}>Support</a>}
      </nav>
    </footer>
  );
}

export function LandingSite({ name = 'Macrofold' }: { name?: string }) {
  return (
    <MotionSurface>
      <SiteHeader name={name} />
      <main id="main-content">
        <section className="mf-hero" aria-label="Introduction">
          <div className="mf-hero-art" aria-hidden="true">
            <Image
              src="/concepts/swarm.png"
              alt=""
              width={1536}
              height={1024}
              priority
              sizes="(max-width: 800px) 100vw, 80vw"
            />
            <div />
          </div>
          <div className="mf-hero-copy">
            <h1 className="mf-gleam">{headline}</h1>
            <p className="mf-subtitle">{subtitle}</p>
            <Actions />
            <div className="mf-source-links">
              <a className="mf-github" href={docsRepository} aria-label="GitHub repository">
                <img src="/brands/github.svg" width={20} height={20} alt="" />
              </a>
              <a
                className="mf-star"
                href={docsRepository}
                aria-label="Star on GitHub"
                title="Open GitHub and choose Star"
              >
                <Star size={13} />
                Star
              </a>
              <a href={contributor}>View contributor guide.</a>
            </div>
          </div>
        </section>
        <section className="mf-section mf-code-section" id="code" aria-labelledby="code-heading">
          <div className="mf-section-heading">
            <h2 className="mf-gleam" id="code-heading">
              Start with a few lines of code.
            </h2>
            <p>
              Choose a project, harness, and model.
              <br />
              Give it a task. Let it work.
            </p>
            <Link className="mf-text-link" href="/docs/api/quickstart">
              Read the API quickstart
              <ArrowRight size={14} />
            </Link>
          </div>
          <CodePanel />
        </section>
        <CustomerStory />
        <section className="mf-section mf-product" id="product" aria-labelledby="product-heading">
          <div className="mf-section-heading">
            <h2 className="mf-gleam" id="product-heading">
              An entire agent harness
              <br />
              as one unit of execution.
            </h2>
            <p>
              Everything agents can do on your computer available in your product or internal tool, with
              thousands of available app connectors.
            </p>
          </div>
          <ProductStory />
        </section>
        <section className="mf-section mf-benefits" aria-labelledby="benefits-heading">
          <div className="mf-section-heading">
            <h2 className="mf-gleam" id="benefits-heading">
              Everything you need to go live.
            </h2>
          </div>
          <div className="mf-benefit-grid">
            {benefits.map((benefit, index) => (
              <article key={benefit.title}>
                <BenefitVisual index={index} />
                <h3>{benefit.title}</h3>
                <p>{benefit.body}</p>
                <Link className="mf-text-link" href={benefit.link}>
                  {benefit.label}
                  <ArrowRight size={14} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section
          className="mf-section mf-integrations"
          id="integrations"
          aria-labelledby="integrations-heading"
        >
          <div>
            <h2 className="mf-gleam" id="integrations-heading">
              The agents you trust.
              <br />
              The tools you need.
            </h2>
            <p>Native harnesses, model providers, and the tools your work depends on.</p>
            <Link className="mf-text-link" href="/docs/connectors">
              Explore all connectors
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mf-integration-groups">
            {integrationGroups.map((group) => (
              <div key={group.label}>
                <h3>{group.label}</h3>
                <div>
                  {group.items.map(([label, mark]) => (
                    <Link key={label} href="/docs/connectors">
                      {mark ? (
                        <img
                          src={`/brands/${mark.includes('.') ? mark : `${mark}.svg`}`}
                          width={21}
                          height={21}
                          alt=""
                        />
                      ) : (
                        <Boxes size={21} />
                      )}
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="mf-section mf-final">
          <div className="mf-final-field" aria-hidden="true">
            <Terminal />
            <GitBranch />
            <Layers />
          </div>
          <h2 className="mf-gleam">Let’s build.</h2>
          <p>Give your next idea a place to run.</p>
          <Actions />
          <div className="mf-contribute">
            <a href={contributor}>
              Contribute to open source
              <ArrowUpRight size={13} />
            </a>
            <Link href="/docs/self-hosting">
              Self-host
              <ArrowUpRight size={13} />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter name={name} />
    </MotionSurface>
  );
}
