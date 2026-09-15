export const headline = 'The Power of Agent Harnesses, in the Cloud';
export const subtitle =
  'Invoke Claude Code, Codex, and OpenCode via API, CLI, or UI. Parallel worktrees, persistent file system, and version control, in sandboxed environments.';

/** These are presentation treatments of one product model, not execution configuration. */
export const journeys = [
  {
    slug: 'fanout',
    name: 'Fanout',
    layout: 'split',
    form: 'fan',
    description: 'A single working unit expands into independent agents, then comes back into focus.',
    extra: 'replay',
  },
  {
    slug: 'terraces',
    name: 'Terraces',
    layout: 'reverse',
    form: 'terraces',
    description: 'Stepped glass planes make persistent working contexts feel tangible.',
    extra: 'budgets',
  },
  {
    slug: 'matrix',
    name: 'Matrix',
    layout: 'wide',
    form: 'matrix',
    description: 'A precise grid turns one context into a field of independent work.',
    extra: 'permissions',
  },
  {
    slug: 'lanes',
    name: 'Lanes',
    layout: 'split',
    form: 'lanes',
    description: 'Parallel execution lanes put requests, saved work, and interfaces in one view.',
    extra: 'results',
  },
  {
    slug: 'strata',
    name: 'Strata',
    layout: 'reverse',
    form: 'strata',
    description: 'Stacked working layers expose the continuity underneath each execution.',
    extra: 'sessions',
  },
  {
    slug: 'switchboard',
    name: 'Switchboard',
    layout: 'wide',
    form: 'switchboard',
    description: 'An angular routing surface makes the relationship between inputs and agents explicit.',
    extra: 'replay',
  },
  {
    slug: 'aperture',
    name: 'Aperture',
    layout: 'chapters',
    form: 'aperture',
    description: 'Five cinematic frames alternate between the whole project and its working parts.',
    extra: 'permissions',
  },
  {
    slug: 'ledger',
    name: 'Ledger',
    layout: 'split',
    form: 'ledger',
    description: 'A chronological surface connects independent work to a visible chain of saved versions.',
    extra: 'budgets',
  },
  {
    slug: 'constellation',
    name: 'Constellation',
    layout: 'wide',
    form: 'constellation',
    description: 'A sparse computational field reveals connections without turning into a topology chart.',
    extra: 'sessions',
  },
  {
    slug: 'assembly',
    name: 'Assembly',
    layout: 'chapters',
    form: 'assembly',
    description: 'Modular execution tiles build up a complete system, one capability at a time.',
    extra: 'results',
  },
] as const;
export type Journey = (typeof journeys)[number];
export type Form = Journey['form'];

export const pillars = [
  { label: 'Project', link: '/docs/workspaces' },
  { label: 'Worktrees', link: '/docs/workspaces' },
  { label: 'Checkpoints and Git Sync', link: '/docs/workspaces' },
  { label: 'API, CLI, UI', link: '/docs/cli' },
  { label: 'Connectors', link: '/docs/connectors' },
] as const;

export const useCases = [
  {
    id: 'customers',
    label: 'Per-Customer Agent Workspaces',
    short: 'Customer context',
    prompt: 'Write a cold email to Alex at Northstar.',
    tasks: ['Draft the email', 'Research the account', 'Update the brief', 'Review the draft'],
    files: ['product.md', 'audience.md', 'brand-voice.md', 'objections.md', 'draft.md'],
    brands: ['gmail', 'hubspot', 'notion', 'slack', 'github', 'linear'],
    stages: [
      [
        'An agent that knows your customer.',
        'Give each customer a workspace with their product context, voice, and notes. The agent reads those files before writing the first draft.',
      ],
      [
        'One context. Independent tasks.',
        'Create separate worktrees to draft an email, research an account, and improve the brief. Each agent has its own working files.',
      ],
      [
        'Keep the context growing.',
        'Save the draft and updated notes in a checkpoint. Review versions or sync a worktree to GitHub before the next task.',
      ],
      [
        'Your product starts the work.',
        'Your backend sends the requests. Your team can inspect a worktree from the terminal or review the same files in the dashboard.',
      ],
      [
        'Put useful tools within reach.',
        'Connect the customer’s email, CRM, and knowledge sources. Give the agent only the connections and actions it needs.',
      ],
    ],
  },
  {
    id: 'improvement',
    label: 'Self-improving Agents',
    short: 'Strategy workspace',
    prompt: 'Run a simulation and revise the strategy.',
    tasks: ['Run the baseline', 'Test an alternative', 'Review the results', 'Inspect the revision'],
    files: ['strategy.md', 'simulation.py', 'constraints.md', 'results.json', 'observations.md'],
    brands: ['github', 'notion', 'postgresql', 'slack', 'sentry', 'datadog'],
    stages: [
      [
        'Give improvement a place to live.',
        'Keep the strategy, simulation code, and evaluation criteria together. Ask the agent to test an idea against your own rules.',
      ],
      [
        'Try alternatives independently.',
        'Run a baseline and alternative strategies in separate worktrees. Compare their results without overwriting the original approach.',
      ],
      [
        'Make every revision inspectable.',
        'The agent records the simulation result and updates strategy.md. A checkpoint preserves the revision; Git history makes it reviewable.',
      ],
      [
        'Build your own improvement loop.',
        'Trigger the next experiment from your application, inspect it from the CLI, and review the revised strategy in the dashboard.',
      ],
      [
        'Connect the feedback that matters.',
        'Bring in evaluation data, experiment notes, and monitoring tools. Your instructions decide what to measure and what the agent may change.',
      ],
    ],
  },
  {
    id: 'team',
    label: 'Shared Team Agents',
    short: 'Team workspace',
    prompt: 'Help debug the checkout timeout.',
    tasks: ['Trace the failure', 'Test the fix', 'Review the incident', 'Inspect the patch'],
    files: ['src/', 'tests/', 'runbook.md', 'incident.md', 'patch.diff'],
    brands: ['slack', 'linear', 'github', 'postgresql', 'sentry', 'datadog'],
    stages: [
      [
        'Start with the team’s working context.',
        'Give the agent your code and runbook. A concrete issue becomes a task in a shared project, with the context your team already maintains.',
      ],
      [
        'Investigate without getting in the way.',
        'Trace the failure, test a fix, and review the incident in independent worktrees. Each task keeps its own branch and working directory.',
      ],
      [
        'Keep the patch and the reasoning trail.',
        'Save files in a verified checkpoint and inspect the diff. Sync to GitHub when ready; repository conflicts stay visible for review.',
      ],
      [
        'One workspace across the team.',
        'Start an investigation from your internal tool. A developer can continue from the terminal while a teammate reviews the output in the UI.',
      ],
      [
        'Bring the rest of the incident together.',
        'Read the Linear issue and Slack context. Add database access through a custom MCP server, alongside logging and monitoring connections.',
      ],
    ],
  },
] as const;
export type UseCase = (typeof useCases)[number];

export const extras = {
  replay: [
    'See the work as it happens.',
    'Stream progress and tool activity. Reopen retained history when you need to understand a result.',
    '/docs/api/events',
    'Streaming and history',
  ],
  budgets: [
    'Set the boundaries first.',
    'Choose spending, runtime, and concurrency limits. Keep ambitious work within an explicit budget.',
    '/docs/billing',
    'Usage and limits',
  ],
  permissions: [
    'Scope access to the task.',
    'Choose the project, keys, and connection grants each agent can use. Keep account boundaries intact.',
    '/docs/connections',
    'Connections and permissions',
  ],
  results: [
    'Turn work into an outcome.',
    'Collect the final output, inspect artifacts, and use completion webhooks to continue your application workflow.',
    '/docs/api/events',
    'Results and webhooks',
  ],
  sessions: [
    'Pick up where you left off.',
    'Send a follow-up to the same session. The next task works with the saved context of the previous one.',
    '/docs/api/quickstart',
    'Sessions and continuation',
  ],
} as const;
