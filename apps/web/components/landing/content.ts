export const headline = 'Run Agent Harnesses in the Cloud';
export const subtitle =
  'Invoke Claude Code, Codex, and OpenCode via API, CLI, or UI. Run them in isolated sandboxes with persistent filesystems, parallel worktrees, and Git-native version control.';

export const pillars = [
  { label: 'Project', href: '/docs/workspaces' },
  { label: 'Worktrees', href: '/docs/workspaces' },
  { label: 'Checkpoints and Git Sync', href: '/docs/workspaces#connect-github' },
  { label: 'API, CLI, UI', href: '/docs/api/quickstart' },
  { label: 'Connectors', href: '/docs/connectors' },
] as const;

type Five<T> = readonly [T, T, T, T, T];
export type Scenario = {
  id: string;
  label: string;
  prompts: readonly [string, string, string, string];
  files: Five<string>;
  connectors: readonly string[];
  chapters: Five<readonly [string, string]>;
};

/** Content is independent of choreography: new examples need no diagram changes. */
export const scenarios: readonly Scenario[] = [
  {
    id: 'customers',
    label: 'Per-Customer Agent Workspaces',
    prompts: [
      'Write a cold sales email to Alex at Northstar. Refer to enterprise pitch guidance.',
      'What did Sam say on our last feedback call?',
      'Update our sales brief with this week’s customer insights.',
      'Make the email warmer and more concise.',
    ],
    files: ['product_info.md', 'pitch_guidance.md', 'brand_voice.md', 'customers/', 'meetings/'],
    connectors: [
      'gmail',
      'hubspot',
      'notion',
      'slack',
      'linear',
      'github',
      'exa',
      'firecrawl',
      'tavily',
      'parallel',
    ],
    chapters: [
      [
        'Give every customer a working context.',
        'Put an agent inside your product, with a project that holds each customer’s knowledge. It reads their context before it gets to work.',
      ],
      [
        'More tasks. Room for each one.',
        'Draft outreach, review feedback, and update a brief in parallel. Each agent gets its own worktree, so concurrent tasks can work independently.',
      ],
      [
        'Keep the work. Build on it.',
        'Persist files between runs with verified checkpoints. Review changes and merge them back into the project; sync your branches with GitHub when you’re ready.',
      ],
      [
        'Part of your product. Within your reach.',
        'Your application starts the work through the API. Step in from the CLI or dashboard to give another instruction and follow the result.',
      ],
      [
        'Let context come from your tools.',
        'Connect the customer’s CRM, email, and knowledge sources. Choose which connections and tools each task can access.',
      ],
    ],
  },
  {
    id: 'improving',
    label: 'Self-improving Agents',
    prompts: [
      'Run a simulation. Use the results to improve the strategy.',
      'Test the strategy against a more volatile scenario.',
      'Compare the latest results with our evaluation criteria.',
      'Explain what changed before we run the next simulation.',
    ],
    files: ['strategy.md', 'evaluation.md', 'simulations/', 'results/', 'lessons.md'],
    connectors: [
      'github',
      'notion',
      'postgresql',
      'sentry',
      'datadog',
      'slack',
      'linear',
      'exa',
      'firecrawl',
      'parallel',
    ],
    chapters: [
      [
        'An agent with something to learn from.',
        'Keep the strategy, evaluation criteria, and previous results in a persistent project. Each simulation starts with the context of earlier work.',
      ],
      [
        'Explore the alternatives in parallel.',
        'Give each experiment a separate worktree. Agents can test different approaches without overwriting one another’s working files.',
      ],
      [
        'Make improvement inspectable.',
        'Save the results and strategy changes as checkpoints. Compare versions, review the evidence, and merge the changes you want to keep.',
      ],
      [
        'Close the loop from your application.',
        'Start the next evaluation through the API, investigate from the terminal, or review the strategy in the dashboard. You define the criteria and the next step.',
      ],
      [
        'Bring evidence into the loop.',
        'Give the agent access to your data, research, and monitoring tools. Select the tools it needs to evaluate a strategy and record the outcome.',
      ],
    ],
  },
  {
    id: 'team',
    label: 'Shared Team Agents',
    prompts: [
      'Help debug the checkout issue reported in our team channel.',
      'What did Sam say on our last feedback call?',
      'Find the recent code changes related to this incident.',
      'Summarize the fix and the tests we should run.',
    ],
    files: ['product-repo/', 'AGENTS.md', 'runbooks/', 'meetings/', 'incidents/'],
    connectors: [
      'github',
      'slack',
      'linear',
      'sentry',
      'datadog',
      'postgresql',
      'notion',
      'gmail',
      'firecrawl',
      'exa',
    ],
    chapters: [
      [
        'A shared place to understand the work.',
        'Give a team agent your product repository, runbooks, and meeting context. A debugging request arrives with somewhere useful to begin.',
      ],
      [
        'Investigate from more than one angle.',
        'Run separate investigations in parallel worktrees. One agent traces the code while others review customer feedback and recent changes.',
      ],
      [
        'Turn an investigation into a reviewable change.',
        'Keep the investigation and its files. Verified checkpoints preserve progress; Git branches let your team review and merge the fix through its usual workflow.',
      ],
      [
        'Meet the team where it works.',
        'Your incident service invokes an agent through the API. A developer follows up from the CLI, while a teammate reviews the work in the dashboard.',
      ],
      [
        'Connect the evidence, not just the code.',
        'Bring together issue tracking, team conversations, logs, and monitoring. Add scoped database access through custom MCP when the investigation needs it.',
      ],
    ],
  },
  {
    id: 'personal',
    label: 'Personal Agent',
    prompts: [
      "Find me a new restaurant I'd like, for 2 at 6pm tonight.",
      'Find somewhere nearby for a walk before dinner.',
      'Compare tonight’s options with the places I already like.',
      'Keep the shortlist in my plans for tonight.',
    ],
    files: ['preferences.md', 'favorite_places.md', 'dietary_notes.md', 'plans/', 'past_outings/'],
    connectors: [
      'gmail',
      'notion',
      'googlecalendar',
      'exa',
      'tavily',
      'firecrawl',
      'parallel',
      'brave',
      'googlemaps',
      'todoist',
    ],
    chapters: [
      [
        'A little less explaining, every time.',
        'Keep preferences, past plans, and useful notes in one project. Your personal agent can read what matters before finding somewhere new.',
      ],
      [
        'Give every idea its own space.',
        'Explore dinner, nearby activities, and alternatives in separate worktrees. Each agent has the same starting context and its own task.',
      ],
      [
        'Remember the things worth keeping.',
        'Save recommendations and updated preferences across runs. Checkpoints let you revisit earlier versions; optional Git sync gives your project a repository home.',
      ],
      [
        'One agent environment. Your choice of interface.',
        'Invoke it from an application, send a quick terminal request, or open the dashboard to review the plan. Your project stays in the cloud.',
      ],
      [
        'Open up the possibilities.',
        'Connect selected personal apps, web search, and custom tools. Your agent can use the sources you authorize to build a more useful answer.',
      ],
    ],
  },
];

export const connectorLabels: Record<string, string> = {
  googlecalendar: 'Google Calendar',
  googlemaps: 'Google Maps',
  todoist: 'Todoist',
  gmail: 'Gmail',
  hubspot: 'HubSpot',
  notion: 'Notion',
  slack: 'Slack',
  linear: 'Linear',
  github: 'GitHub',
  exa: 'Exa',
  firecrawl: 'Firecrawl',
  tavily: 'Tavily',
  parallel: 'Parallel AI',
  postgresql: 'PostgreSQL via custom MCP',
  sentry: 'Sentry',
  datadog: 'Datadog',
  brave: 'Brave',
  mcp: 'Custom MCP',
};
