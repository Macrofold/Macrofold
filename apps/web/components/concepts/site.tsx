import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  Github,
  GitBranch,
  Folder,
  Terminal,
  Radio,
  ShieldCheck,
  Code2,
  Layers,
} from 'lucide-react';
import { docsRepository } from '../../lib/docs/settings';
import { ConceptArt } from './art';
import { CodeExample, MotionSurface, ProductFlow } from './controls';
import { concepts, productDescription, type Concept } from './catalog';

const capabilities = [
  {
    icon: Folder,
    title: 'A project that persists.',
    text: 'Source, notes, and artifacts stay in your workspace between runs. Checkpoints let you inspect and restore saved work.',
    detail: 'FILES + CHECKPOINTS',
  },
  {
    icon: Radio,
    title: 'Every run, in view.',
    text: 'Follow output and tool calls as they happen. Inspect status, retrieve results, and replay retained history.',
    detail: 'STREAMING + HISTORY',
  },
  {
    icon: GitBranch,
    title: 'Version the work.',
    text: 'Connect GitHub, review changes, and synchronize your repository. Use worktrees for independent tasks.',
    detail: 'GIT + WORKTREES',
  },
  {
    icon: ShieldCheck,
    title: 'Explicit control.',
    text: 'Bring your model keys or use managed funding. Set spending and execution limits. Grant only the tools a task needs.',
    detail: 'KEYS + PERMISSIONS',
  },
];
const integrations = [
  { title: 'Native harnesses', items: ['Claude Code', 'Codex', 'OpenCode'] },
  { title: 'Model providers', items: ['Anthropic', 'OpenAI', 'OpenRouter'] },
  { title: 'Tools & projects', items: ['MCP', 'Composio', 'GitHub'] },
  { title: 'Web search', items: ['Brave Search', 'Exa', 'Tavily', 'Parallel AI', 'Firecrawl'] },
];

function Wordmark({ name }: { name: string }) {
  return (
    <Link href="/" className="concept-wordmark">
      <Layers size={23} strokeWidth={1.6} aria-hidden="true" />
      {name}
    </Link>
  );
}
function Actions() {
  return (
    <div className="concept-actions">
      <Link href="/docs/local-development" className="concept-primary">
        Start building <ArrowUpRight size={17} />
      </Link>
      <a href="#code" className="concept-secondary">
        See the API <ArrowRight size={16} />
      </a>
    </div>
  );
}

export function ConceptSite({ concept, name }: { concept: Concept; name: string }) {
  const number = concepts.indexOf(concept) + 1;
  return (
    <MotionSurface className={`concept-site concept-${concept.slug} composition-${concept.layout}`}>
      <div className="concept-review-bar">
        <Link href="/concepts">← All 10 concepts</Link>
        <span>
          {String(number).padStart(2, '0')} / {concept.name}
        </span>
        <Link href={`/concepts/${concepts[number % concepts.length].slug}`}>Next concept →</Link>
      </div>
      <header className="concept-nav">
        <Wordmark name={name} />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">Product</a>
          <a href="#integrations">Integrations</a>
          <Link href="/docs">Docs</Link>
          <a href={docsRepository} className="concept-github">
            <Github size={15} />
            GitHub
          </a>
        </nav>
        <Link href="/docs/local-development" className="concept-nav-cta">
          Get started <ArrowUpRight size={14} />
        </Link>
      </header>
      <main id="main-content">
        <section className="concept-hero">
          <div className="concept-hero-copy">
            <p className="concept-kicker">
              <span />
              {concept.eyebrow}
            </p>
            <h1>
              {concept.title.split('\n').map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
            <p className="concept-description">{productDescription}</p>
            <Actions />
            <p className="concept-license">
              <Github size={13} />
              Open source <span>·</span> Apache 2.0 <span>·</span> Self-hostable
            </p>
          </div>
          <div className="concept-hero-art">
            <ConceptArt concept={concept} />
          </div>
          <div className="concept-hero-foot">
            <span>CLAUDE CODE</span>
            <span>CODEX</span>
            <span>OPENCODE</span>
            <span className="concept-hero-foot-note">NATIVE HARNESSES. SHARED INFRASTRUCTURE.</span>
          </div>
        </section>

        <section id="code" className="concept-developer concept-section">
          <div className="concept-developer-copy">
            <p className="concept-kicker">01 / IN YOUR CODE</p>
            <h2>
              A native agent.
              <br />
              An ordinary API call.
            </h2>
            <p>
              Send a task. Stream the work. Keep the files. Add a coding agent to your backend without running
              it on your laptop.
            </p>
            <ol className="concept-start-steps">
              <li>
                <span>1</span>Create a project and scoped API key.
              </li>
              <li>
                <span>2</span>Choose your harness and model.
              </li>
              <li>
                <span>3</span>Submit a run and follow its events.
              </li>
            </ol>
            <Link href="/docs/api/quickstart" className="concept-text-link">
              API quickstart <ArrowRight size={16} />
            </Link>
            <details className="concept-example-setup">
              <summary>Set up these examples</summary>
              <p>
                Install the SDK from source using the <Link href="/docs/sdk">SDK guide</Link>. Set your host,
                API key, workspace ID, and compatible model. For a local simulation, use{' '}
                <code>fixture-model</code>. Cloud execution uses credits.
              </p>
            </details>
          </div>
          <CodeExample />
        </section>

        <section id="how-it-works" className="concept-system concept-section">
          <div className="concept-section-heading">
            <div>
              <p className="concept-kicker">02 / HOW IT WORKS</p>
              <h2>
                From a request
                <br />
                to real work.
              </h2>
            </div>
            <p>
              The harness runs in a cloud sandbox. The project outlives the run. Choose a step to see how it
              connects.
            </p>
          </div>
          <ProductFlow />
        </section>

        <section className="concept-control concept-section">
          <div>
            <p className="concept-kicker">03 / YOUR CONTROL PLANE</p>
            <h2>
              Your code. Your terminal.
              <br />
              The same workspace.
            </h2>
            <p>
              Start through the API. Check in from the CLI. Review files and agent history in the dashboard.
              Every interface connects to the same projects and runs.
            </p>
            <Link href="/docs/workspaces" className="concept-text-link">
              Explore projects <ArrowRight size={16} />
            </Link>
          </div>
          <div
            className="concept-control-diagram"
            role="img"
            aria-label="Your application, CLI and dashboard connect to the same project with persistent files, run history and optional GitHub sync."
          >
            <div className="concept-interface-row">
              <span>
                <Code2 size={17} />
                API
              </span>
              <span>
                <Terminal size={17} />
                CLI
              </span>
              <span>
                <Layers size={17} />
                Dashboard
              </span>
            </div>
            <div className="concept-connectors" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="concept-project-node">
              <Folder size={22} />
              <div>
                <strong>Your project</strong>
                <span>Persistent workspace</span>
              </div>
              <span className="concept-node-badge">SHARED STATE</span>
            </div>
            <div className="concept-state-row">
              <span>Files</span>
              <span>Run history</span>
              <span>GitHub sync</span>
            </div>
            <small>Conceptual view · GitHub connection is optional</small>
          </div>
        </section>

        <section className="concept-capabilities concept-section">
          <div className="concept-section-heading">
            <div>
              <p className="concept-kicker">04 / THE FOUNDATION</p>
              <h2>
                Built for the work
                <br />
                that comes next.
              </h2>
            </div>
            <p>Keep the useful parts of a local agent workflow. Make them available to your application.</p>
          </div>
          <div className="concept-capability-grid">
            {capabilities.map(({ icon: Icon, title, text, detail }) => (
              <article key={title}>
                <Icon size={25} strokeWidth={1.4} />
                <h3>{title}</h3>
                <p>{text}</p>
                <span>{detail}</span>
              </article>
            ))}
          </div>
        </section>

        <section id="integrations" className="concept-integrations concept-section">
          <div>
            <p className="concept-kicker">05 / CONNECT YOUR STACK</p>
            <h2>
              The agents you know.
              <br />
              The tools you use.
            </h2>
            <p>Choose the native harness, model provider, and authorized connections for each task.</p>
            <Link href="/docs/connections" className="concept-text-link">
              Explore connections <ArrowRight size={16} />
            </Link>
          </div>
          <div className="concept-integration-list">
            {integrations.map((group) => (
              <div className="concept-integration-group" key={group.title}>
                <h3>{group.title}</h3>
                <div>
                  {group.items.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="concept-open-source concept-section">
          <Github size={29} strokeWidth={1.4} />
          <p className="concept-kicker">OPEN BY DESIGN</p>
          <h2>
            Build on something
            <br />
            you can make your own.
          </h2>
          <p>
            Read the source. Run a local simulation. Host it yourself.
            <br />
            Start with a working example and take it further.
          </p>
          <div className="concept-actions">
            <a href={docsRepository} className="concept-primary">
              Explore the source <ArrowUpRight size={17} />
            </a>
            <Link href="/docs/local-development" className="concept-secondary">
              Run it locally <ArrowRight size={16} />
            </Link>
          </div>
          <p className="concept-source-note">
            <Link href="/pricing">Pricing and concurrency limits</Link>
            <span>·</span>
            <Link href="/docs/self-hosting/vercel">Self-hosting guide</Link>
          </p>
        </section>
      </main>
      <footer className="concept-footer">
        <Wordmark name={name} />
        <p>Infrastructure for what you build next.</p>
        <nav aria-label="Footer navigation">
          <Link href="/docs">Documentation</Link>
          <Link href="/reference">API reference</Link>
          <Link href="/login">
            Open console <ArrowUpRight size={13} />
          </Link>
        </nav>
      </footer>
    </MotionSurface>
  );
}

export function ConceptGallery({ name }: { name: string }) {
  return (
    <div className="concept-gallery">
      <header>
        <Wordmark name={name} />
        <span>DESIGN STUDIES / SERIES 02</span>
        <Link href="/docs">Documentation ↗</Link>
      </header>
      <main id="main-content">
        <div className="gallery-heading">
          <div>
            <p className="concept-kicker">DEVELOPER INFRASTRUCTURE, REIMAGINED</p>
            <h1>
              More possibility.
              <br />
              Less metaphor.
            </h1>
          </div>
          <p className="gallery-intro">
            Ten directions for {name}. Computational forms, precise materials, and clear product stories.
            Hover over an image—or focus or tap its animation button—to explore the proposed motion.
          </p>
        </div>
        <div className="concept-gallery-grid">
          {concepts.map((concept, i) => (
            <article className={`concept-gallery-card concept-${concept.slug}`} key={concept.slug}>
              <div className="concept-card-image">
                <ConceptArt concept={concept} gallery />
                <span className="concept-card-number">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="concept-card-copy">
                <span>{concept.category}</span>
                <h2>
                  <Link href={`/concepts/${concept.slug}`}>
                    {concept.name}
                    <ArrowUpRight size={22} />
                  </Link>
                </h2>
                <p className="concept-card-tagline">{concept.title.replace('\n', ' ')}</p>
                <p>{concept.description}</p>
                <Link className="concept-card-open" href={`/concepts/${concept.slug}`}>
                  Explore {concept.name}
                  <ArrowRight size={15} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </main>
      <footer>
        Ten original image studies. Five hero compositions. One shared product.
        <span>Motion notes describe proposed animations.</span>
      </footer>
    </div>
  );
}
