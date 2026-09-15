import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Cpu,
  FolderGit2,
  GitBranch,
  KeyRound,
  Radio,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react';
import { MotionSurface } from '../landing/controls';
import { SiteHeader, SiteFooter } from '../landing/site';
import { CostCalculator } from './calculator';
import { dollars, type PricingPlan } from './estimate';
import './site.css';

const descriptions: Record<string, string> = {
  payg: 'Explore the platform. Build your first cloud agent.',
  pro: 'For daily work and the products you’re bringing to life.',
  scale: 'More parallel work for a growing product or team.',
};
const features = [
  [
    Terminal,
    'Your choice of harness',
    'Claude Code, Codex, and OpenCode through API, CLI, or the dashboard.',
  ],
  [FolderGit2, 'Persistent project files', 'Keep context and return to the same files across runs.'],
  [GitBranch, 'Worktrees and version control', 'Work in parallel, checkpoint changes, and sync with GitHub.'],
  [Radio, 'Live progress and history', 'Stream tool activity and outputs, then inspect recorded runs.'],
  [Workflow, 'Tools and triggers', 'Connect apps and MCP tools. Start work from webhooks or schedules.'],
  [
    ShieldCheck,
    'Scoped, sandboxed execution',
    'Limit access to the task. Keep provider credentials encrypted at rest.',
  ],
] as const;

export function Pricing({
  name,
  plans,
  computeMicroPerMinute,
  searchMicroPerCall,
  connectorMicroPerCall,
  contactHref,
}: {
  name: string;
  plans: PricingPlan[];
  computeMicroPerMinute: string;
  searchMicroPerCall: string | null;
  connectorMicroPerCall: string | null;
  contactHref?: string;
}) {
  const pro = plans.find((plan) => plan.id === 'pro');
  return (
    <MotionSurface className="mf-pricing">
      <SiteHeader name={name} />
      <main id="main-content" className="mp-main">
        <section className="mf-section mp-intro" aria-labelledby="pricing-title">
          <p className="mp-kicker">Pricing</p>
          <h1 id="pricing-title" className="mf-gleam">
            Start building.
            <br />
            Scale on your terms.
          </h1>
          <p>Choose the capacity your team needs. Pay for execution and model usage as you go.</p>
          <a href="#calculator" className="mf-text-link">
            Estimate your monthly cost
            <ArrowRight size={16} />
          </a>
        </section>

        <section className="mf-section mp-plans" aria-label="Plans">
          <div className="mp-plan-grid">
            {plans.map((plan) => (
              <article className="mp-plan" data-featured={plan.id === 'pro'} key={plan.id}>
                <div className="mp-plan-heading">
                  <h2>{plan.name}</h2>
                  {plan.id === 'pro' && <span>For builders</span>}
                </div>
                <p>{descriptions[plan.id]}</p>
                <div className="mp-plan-price">
                  <strong>{dollars(plan.monthlyMicro).replace(/\.00$/, '')}</strong>
                  <span>
                    / month
                    <br />
                    <small>+ usage</small>
                  </span>
                </div>
                <p className="mp-included">
                  {dollars(plan.includedMicro).replace(/\.00$/, '')} in monthly usage credits
                </p>
                <Link href="/register" className={plan.id === 'pro' ? 'mf-primary' : 'mf-secondary'}>
                  Choose {plan.name}
                  <ArrowUpRight size={16} />
                </Link>
                <ul>
                  {[
                    [`${plan.concurrency}`, 'concurrent jobs'],
                    [`${plan.minutes} min`, 'maximum per run'],
                    [`${plan.storage} GiB`, 'included retained storage'],
                    [`${plan.history} days`, 'detailed run history'],
                    ['All', 'core platform features'],
                  ].map(([value, label]) => (
                    <li key={label}>
                      <Check size={15} aria-hidden="true" />
                      <span>
                        <strong>{value}</strong> {label}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="mp-assisted-grid">
            {[
              {
                name: 'Business',
                price: '$1,000',
                suffix: '/ month + usage',
                description: 'For larger workloads with capacity planned around your product.',
                details: [
                  'Concurrency and runtime agreed for your workload',
                  'Storage, retention, and credit allowance in your proposal',
                ],
              },
              {
                name: 'Enterprise',
                price: 'Let’s talk',
                suffix: 'custom terms',
                description: 'Work through your organization’s scale and deployment requirements with us.',
                details: [
                  'Capacity and commercial terms by agreement',
                  'Deployment and procurement requirements reviewed together',
                ],
              },
            ].map((plan) => (
              <article className="mp-assisted" key={plan.name}>
                <div className="mp-plan-heading">
                  <h2>{plan.name}</h2>
                  <span>Sales-assisted</span>
                </div>
                <div className="mp-assisted-price">
                  <strong>{plan.price}</strong>
                  <span>{plan.suffix}</span>
                </div>
                <p>{plan.description}</p>
                <ul>
                  {plan.details.map((detail) => (
                    <li key={detail}>
                      <Check size={15} aria-hidden="true" />
                      {detail}
                    </li>
                  ))}
                </ul>
                <a className="mf-text-link" href={contactHref || '/docs/billing'}>
                  {contactHref ? 'Contact sales' : 'View billing guide'}
                  <ArrowUpRight size={16} />
                </a>
              </article>
            ))}
          </div>
          <p className="mp-fineprint">
            Self-serve limits are shared across your organization. Concurrency is the maximum number of active
            jobs, not reserved or guaranteed immediate capacity. One writer runs per workspace; use worktrees
            for parallel changes. Business and Enterprise capacity is confirmed before activation.
          </p>
        </section>

        <section className="mf-section mp-features" aria-labelledby="included-title">
          <div className="mf-section-heading">
            <h2 id="included-title" className="mf-gleam">
              Every plan. The full harness.
            </h2>
            <p>The same building blocks, from your first request to your next product.</p>
          </div>
          <div className="mp-feature-grid">
            {features.map(([Icon, title, body]) => (
              <article key={title}>
                <Icon size={22} strokeWidth={1.3} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mf-section mp-usage" aria-labelledby="usage-title">
          <div className="mf-section-heading">
            <p className="mp-kicker">Usage</p>
            <h2 id="usage-title" className="mf-gleam">
              Know what you’re paying for.
            </h2>
            <p>Your plan sets capacity. Credits cover metered work.</p>
          </div>
          <div className="mp-usage-grid">
            <article>
              <Cpu size={24} strokeWidth={1.3} aria-hidden="true" />
              <h3>Execution</h3>
              <strong>
                {dollars(BigInt(computeMicroPerMinute) * 60n, 3)}
                <small>/ hour</small>
              </strong>
              <p>2 vCPU · 4 GB memory per sandbox.</p>
              <p>
                {dollars(computeMicroPerMinute, 3)} per minute, prorated per second of execution. Queued time
                is not compute usage.
              </p>
            </article>
            <article>
              <KeyRound size={24} strokeWidth={1.3} aria-hidden="true" />
              <h3>Models</h3>
              <strong>Your choice</strong>
              <p>Use credits or bring your own key.</p>
              <p>
                Managed inference uses published model rates. With BYOK, your provider bills model usage
                directly; compute still uses platform credits.
              </p>
              <Link href="/docs/models" className="mf-text-link">
                Explore models
                <ArrowRight size={14} />
              </Link>
            </article>
            <article>
              <FolderGit2 size={24} strokeWidth={1.3} aria-hidden="true" />
              <h3>Retained storage</h3>
              <strong>
                $0.10<small>/ GiB-month</small>
              </strong>
              <p>Only above your plan’s included storage.</p>
              <p>
                Extra storage is opt-in, with its own budget. Metered over a 30-day month. Persistent files
                are separate from sandbox memory.
              </p>
              <Link href="/docs/workspaces#retention-and-deletion" className="mf-text-link">
                Storage and retention
                <ArrowRight size={14} />
              </Link>
            </article>
          </div>
          <details className="mp-tool-rates">
            <summary>
              Search, connectors, and other tools
              <ChevronDown size={16} />
            </summary>
            <div>
              <p>
                Managed web search:{' '}
                {searchMicroPerCall === null
                  ? 'review the connection’s rate before execution'
                  : `${dollars(searchMicroPerCall, 3)} per billable search`}
                . Built-in connector execution:{' '}
                {connectorMicroPerCall === null
                  ? 'review the connection’s rate before execution'
                  : `${dollars(connectorMicroPerCall, 3)} per billable call`}
                .
              </p>
              <p>
                Third-party subscriptions and tools billed to your own accounts are separate. Grant tools
                explicitly and review their rates before running an agent.
              </p>
              <Link href="/docs/billing">Read the billing guide →</Link>
            </div>
          </details>
        </section>

        <section className="mf-section mp-faq" aria-labelledby="faq-title">
          <h2 id="faq-title" className="mf-gleam">
            A few useful details.
          </h2>
          <div>
            {[
              [
                'How do plans and credits work?',
                `The monthly subscription pays for your plan. Its included credits offset eligible compute, managed models, and tool usage. Add prepaid credits for additional usage.${pro ? ` For example, ${pro.name} costs ${dollars(pro.monthlyMicro)} per month and includes ${dollars(pro.includedMicro)} in usage credits.` : ''}`,
              ],
              [
                'Can I use my existing model API keys?',
                'Yes. BYOK model charges go directly to your provider and do not consume platform model credits. You still need platform credits for compute and any paid platform tools or storage. Included credits cannot offset your separate provider bill.',
              ],
              [
                'Does every minute count as execution?',
                'The configured execution window is metered while the run executes, including waits within that window. Waiting in the queue is not charged as compute. Failed or cancelled work can still incur usage already consumed.',
              ],
              [
                'What happens when all my slots are busy?',
                'Eligible jobs wait for capacity, with a default queue deadline of 24 hours that you can shorten. You can cancel queued jobs. Their reserved budget is released on cancellation or expiry. The execution timeout starts separately when execution begins.',
              ],
              [
                'Do credits or project files expire?',
                'Purchased credits do not expire. Included subscription credits expire at the end of their paid period. Detailed run history follows your plan’s retention window; persistent files and native conversation state have separate storage and deletion rules.',
              ],
              [
                'Can I set limits on spending?',
                'Yes. Runs reserve an authorized budget before starting, and unused funds are released at settlement. Spending controls and storage budgets help bound usage. They are not a promise that provider failures or work already performed will be free.',
              ],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={16} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="mf-section mp-calculator-section"
          id="calculator"
          aria-labelledby="calculator-title"
        >
          <div className="mf-section-heading">
            <p className="mp-kicker">Cost calculator</p>
            <h2 id="calculator-title" className="mf-gleam">
              A clearer picture of your month.
            </h2>
            <p>Two estimates. One total. Adjust the hours and model spend to match your workload.</p>
          </div>
          <CostCalculator plans={plans} computeMicroPerMinute={computeMicroPerMinute} />
          <p className="mp-fineprint">
            Estimates use the current self-serve rates and assume the selected plan is active for the whole
            month. Business and Enterprise are quoted separately. This calculator makes no API calls and does
            not create a subscription.
          </p>
        </section>
      </main>
      <SiteFooter name={name} />
    </MotionSurface>
  );
}
