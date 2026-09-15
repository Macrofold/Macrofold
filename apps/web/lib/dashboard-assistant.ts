export type AssistantGuidance = {
  title: string;
  answer: string;
  href: string;
  action: string;
  guide: string;
};

const guidance = {
  setup: {
    title: 'Start with one useful task',
    answer:
      'Create a project, choose a harness and an available model, then review funding and the run budget. Start with a small prompt. You can follow its output and inspect saved files when persistence finishes.',
    href: '/projects',
    action: 'Open projects',
    guide: '/docs/quickstart',
  },
  connection: {
    title: 'Connect the account you want to use',
    answer:
      'In Connections, add and name an account, then choose its authorized tools. Select that connection explicitly in your agent configuration. Adding another account does not change the connections an existing agent can use.',
    href: '/connections',
    action: 'Open connections',
    guide: '/docs/connections/named-accounts',
  },
  funding: {
    title: 'Review your funding and limits',
    answer:
      'Billing shows your recorded balance and plan. Review the funding method and maximum budget before starting a run. A provider key bills that provider separately; Macrofold infrastructure charges remain distinct. This preview cannot read your balance or change spending.',
    href: '/billing',
    action: 'Open billing',
    guide: '/docs/billing',
  },
  access: {
    title: 'Check access in the right organization',
    answer:
      'Check the active organization, membership, API-key scopes, and project restrictions. Manage profile, sessions, and security in Account & security. Never paste an API key or recovery code into this conversation.',
    href: '/account',
    action: 'Open account settings',
    guide: '/docs/troubleshooting#access-is-denied',
  },
  schedule: {
    title: 'Give recurring work a saved prompt',
    answer:
      'Open Scheduled tasks to choose a project, prompt, schedule, and budget. Review the configuration before enabling it. Each execution appears in Runs, where you can inspect its progress and files.',
    href: '/scheduled-tasks',
    action: 'Open scheduled tasks',
    guide: '/docs/triggers/scheduled-tasks',
  },
  trigger: {
    title: 'Connect an incoming event',
    answer:
      'Use Triggers to connect a Slack channel or incoming webhook to a project. Follow the integration guide for authentication, choose a prompt and budget, then review the trigger before enabling it.',
    href: '/triggers',
    action: 'Open triggers',
    guide: '/docs/triggers',
  },
  files: {
    title: 'Continue from persisted work',
    answer:
      'Open a project and choose its workspace to read saved files. Two agents can take turns in one workspace after persistence completes; parallel writers need independent workspaces and an explicit merge. Sharing files does not share conversations.',
    href: '/projects',
    action: 'Open projects',
    guide: '/docs/workspaces/shared-agents',
  },
  run: {
    title: 'Inspect the run before repeating work',
    answer:
      'Open the run to inspect its status, events, tool calls, and persistence outcome. Reopening a run restores available history. If an action may already have happened, inspect the result before starting it again. Closing a stream does not cancel the run.',
    href: '/runs',
    action: 'Open runs',
    guide: '/docs/troubleshooting',
  },
  api: {
    title: 'Build with your coding agent',
    answer:
      'Create a scoped API key for the selected organization, configure it in your application’s server-side secret environment, then use the setup prompt below. It links to this deployment’s guides and asks your coding agent to verify a complete first-run flow.',
    href: '/api-keys',
    action: 'Open API keys',
    guide: '/docs/agents',
  },
} satisfies Record<string, AssistantGuidance>;

/** This preview selects authored guidance only; it never interprets requests as account actions. */
export function assistantGuidance(question: string): AssistantGuidance {
  if (/\b(bill\w*|cost\w*|credit\w*|budget\w*|spend\w*|payment\w*|fund\w*)\b/i.test(question))
    return guidance.funding;
  if (/\b(schedule\w*|cron|recurring|daily|weekly)\b/i.test(question)) return guidance.schedule;
  if (/\b(trigger\w*|slack|webhook\w*)\b/i.test(question)) return guidance.trigger;
  if (/\b(connect\w*|gmail|mcp|integration\w*)\b/i.test(question)) return guidance.connection;
  if (/\b(file\w*|workspace\w*|share\w*|persist\w*|checkpoint\w*)\b/i.test(question)) return guidance.files;
  if (/\b(api|sdk|cli|install\w*|code|coding)\b/i.test(question)) return guidance.api;
  if (/\b(auth\w*|account\w*|permission\w*|member\w*|team|login|password|security)\b/i.test(question))
    return guidance.access;
  if (/\b(run\w*|error\w*|fail\w*|cancel\w*|stream\w*|history|replay)\b/i.test(question)) return guidance.run;
  return guidance.setup;
}
