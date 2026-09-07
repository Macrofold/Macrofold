import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowRight,
  FolderGit2,
  Terminal,
  Braces,
  History,
  PlugZap,
  ShieldCheck,
  Check,
  GitBranch,
  FileText,
  CircleCheck,
} from 'lucide-react';
import { Logo } from './ui';
export function PublicFrame({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="public-site">
      <header className="public-nav">
        <Link href="/" className="public-brand">
          <Logo />
          <strong>{name}</strong>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/docs">Documentation</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/register" className="button primary">
            Get started
            <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      {children}
      <footer className="public-footer">
        <div>
          <strong>{name}</strong>
          <p>A lasting home for your agents’ work.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/docs">Quickstart</Link>
          <Link href="/reference">API reference</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs/workspaces#retention-and-deletion">Your data</Link>
          {process.env.PRIVACY_URL?.startsWith('https://') && <a href={process.env.PRIVACY_URL}>Privacy</a>}
          {process.env.TERMS_URL?.startsWith('https://') && <a href={process.env.TERMS_URL}>Terms</a>}
          {process.env.SUPPORT_EMAIL && <a href={'mailto:' + process.env.SUPPORT_EMAIL}>Support</a>}
        </nav>
      </footer>
    </div>
  );
}
export function Marketing({ name }: { name: string }) {
  return (
    <PublicFrame name={name}>
      <main>
        <section className="public-hero">
          <div className="hero-copy">
            <span className="public-eyebrow">
              <span />
              PERSISTENT CLOUD AGENTS
            </span>
            <h1>
              Good work deserves
              <br />
              <em>a place to stay.</em>
            </h1>
            <p>
              Give your agents a workspace they can return to. Start a task from your app, your terminal, or
              your browser. Pick up where you left off.
            </p>
            <div className="hero-actions">
              <Link className="button primary" href="/register">
                Create your workspace
                <ArrowRight size={17} />
              </Link>
              <Link className="button secondary" href="/docs">
                Read the quickstart
              </Link>
            </div>
            <small>Codex · Claude Code · OpenCode</small>
          </div>
          <div className="hero-workspace" aria-label="Illustrative workspace preview">
            <div className="preview-title">
              <span className="preview-dots">● ● ●</span>
              <span>Example workspace</span>
              <GitBranch size={14} />
            </div>
            <div className="preview-body">
              <aside>
                <span className="public-eyebrow">PROJECT</span>
                <strong>Research notebook</strong>
                <p>
                  <GitBranch size={13} /> main
                </p>
                <p>
                  <FileText size={13} /> README.md
                </p>
                <p className="preview-selected">
                  <FileText size={13} /> findings.md
                </p>
              </aside>
              <div>
                <div className="preview-prompt">Review the latest findings and update the project brief.</div>
                <div className="preview-event">
                  <CircleCheck size={16} />
                  <span>Read the project files</span>
                  <small>01</small>
                </div>
                <div className="preview-event">
                  <CircleCheck size={16} />
                  <span>Updated findings.md</span>
                  <small>02</small>
                </div>
                <div className="preview-result">
                  <span className="public-eyebrow">SAVED TO YOUR PROJECT</span>
                  <strong>Ready for the next question.</strong>
                  <p>Files, tool activity, and the conversation stay connected.</p>
                </div>
                <div className="preview-bottom">
                  <span className="tiny-dot" /> Checkpoint verified
                  <History size={14} />
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="public-section">
          <div className="public-section-heading">
            <span className="public-eyebrow">ONE WORKSPACE. EVERY WAY YOU WORK.</span>
            <h2>
              From a single request
              <br />
              to an ongoing project.
            </h2>
          </div>
          <div className="public-features">
            {[
              [
                FolderGit2,
                'Files that persist',
                'Keep source code, notes, and artifacts across runs. Create independent workspaces and restore verified checkpoints.',
              ],
              [
                Terminal,
                'A terminal that reaches further',
                'Link a project, chat with a remote agent, stream its progress, and explicitly transfer the files you need.',
              ],
              [
                Braces,
                'An API built for your app',
                'Create runs with idempotency, follow durable event streams, retrieve results, and receive signed completion webhooks.',
              ],
              [
                History,
                'A clear record of the work',
                'Inspect run status, output, tool calls, and available reasoning summaries. Continue compatible native sessions.',
              ],
              [
                PlugZap,
                'Your tools, deliberately connected',
                'Add provider keys, authorized apps, or MCP servers. Choose the tools each agent can use.',
              ],
              [
                ShieldCheck,
                'Spending you control',
                'Choose managed funding or your own provider key. Set run budgets and explicitly enable storage overage.',
              ],
            ].map(([Icon, title, description]) => {
              const Component = Icon as typeof FolderGit2;
              return (
                <article key={String(title)}>
                  <Component size={24} />
                  <h3>{String(title)}</h3>
                  <p>{String(description)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="public-callout">
          <span className="public-eyebrow">START SMALL. KEEP BUILDING.</span>
          <h2>Your next task can have a home.</h2>
          <Link className="button primary" href="/register">
            Get started
            <ArrowUpRight size={17} />
          </Link>
        </section>
      </main>
    </PublicFrame>
  );
}
export function Pricing({
  name,
  plans,
  compute,
  search,
}: {
  name: string;
  plans: {
    name: string;
    price: string;
    included: string;
    concurrency: number;
    minutes: number;
    storage: number;
    history: number;
  }[];
  compute: string;
  search: string;
}) {
  return (
    <PublicFrame name={name}>
      <main className="public-section public-reading">
        <span className="public-eyebrow">CLEAR STARTING POINTS</span>
        <h1>
          Pay for the work.
          <br />
          Keep what matters.
        </h1>
        <p className="public-lede">
          Choose a plan for your organization. Fund usage with prepaid credits, and bring your own model key
          when you prefer.
        </p>
        <div className="pricing-grid">
          {plans.map((plan) => (
            <article className="pricing-card" key={plan.name}>
              <h2>{plan.name}</h2>
              <strong>
                {plan.price}
                <small>/ month + usage</small>
              </strong>
              <p>Persistent projects, parallel agents, and full visibility.</p>
              <ul>
                {[
                  `${plan.concurrency} concurrent jobs`,
                  `${plan.minutes} minutes per execution`,
                  `${plan.storage} GiB storage`,
                  `${plan.included} monthly credit`,
                  `${plan.history} days of detailed history`,
                ].map((i) => (
                  <li key={i}>
                    <Check size={16} />
                    {i}
                  </li>
                ))}
              </ul>
              <Link href="/register" className={`button ${plan.name === 'Pro' ? 'primary' : 'secondary'}`}>
                Choose {plan.name}
                <ArrowUpRight size={16} />
              </Link>
            </article>
          ))}
        </div>
        <p className="form-hint">
          Every plan includes a 24-hour queue deadline, adjustable downward per request. Limits are shared
          across your organization. Concurrency is a maximum, not a reservation or immediate-start guarantee.
        </p>
        <h2>Usage, in plain language</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Customer rate</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Standard cloud execution</td>
                <td>{compute} per minute, prorated per second</td>
              </tr>
              <tr>
                <td>Managed inference</td>
                <td>Published model rate card, including platform markup</td>
              </tr>
              <tr>
                <td>Your model API key</td>
                <td>$0 platform model charge; your provider bills you directly</td>
              </tr>
              <tr>
                <td>Managed web search</td>
                <td>{search} per billable search</td>
              </tr>
              <tr>
                <td>Extra retained storage</td>
                <td>$0.10 per GiB per 30-day month, only when enabled</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Model rates are the final retail rates. Cache reads use the input rate; Anthropic cache writes use
          twice that rate. Output includes reported reasoning tokens.
        </p>
        <p>
          Model prices are listed in the authenticated model catalog before a run is submitted. Compute and
          authorized tools still use platform credits with BYOK. Failed work can incur consumed usage; a
          budget is an admission and gateway limit, not a promise that failures are free.
        </p>
        <p>
          Purchased credits do not expire. Included subscription credits expire at the paid period’s end.
          Storage overage requires its own monthly budget. Projects can be exported or scheduled for deletion;
          detailed run retention is separate from the persistent native conversation state.
        </p>
        <Link href="/docs/workspaces#retention-and-deletion">
          Read about persistence and retention
          <ArrowRight size={15} />
        </Link>
      </main>
    </PublicFrame>
  );
}
