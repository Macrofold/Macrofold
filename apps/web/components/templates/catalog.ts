export type AgentTemplate = {
  slug: string;
  name: string;
  category: string;
  description: string;
  outcome: string;
  requirements: readonly string[];
  instructions: string;
  example: string;
  tone: 'cyan' | 'ember' | 'sage';
  featured: boolean;
};

/** Starters are instructions, not grants, model choices, or permission to execute. */
export const agentTemplates: readonly AgentTemplate[] = [
  {
    slug: 'research-brief',
    featured: true,
    name: 'Research brief',
    category: 'Research',
    description: 'Turn a question and source material into a clear, cited brief.',
    outcome: 'A research-brief.md file with findings, sources, open questions, and next steps.',
    requirements: [
      'A question and source documents or links',
      'An authorized search connection for live research',
    ],
    instructions: `Build a concise research brief about the topic in my task. Start with the source material in this worktree and use only explicitly authorized tools for additional research. If live search is unavailable, work from supplied sources and identify the gap.

Separate evidence from interpretation. Cite a source for each material factual claim, compare conflicting evidence, and state what remains uncertain. Do not invent sources or quotes.

Write research-brief.md with an answer first, key findings, sources, open questions, and useful next steps. Preserve unrelated files. Finish by telling me where the brief is saved and which sources you could not verify.`,
    example:
      '# Research brief\n\n## Answer\nA concise conclusion supported by the supplied sources.\n\n## Key findings\n- Finding, supporting evidence, and source.\n\n## Open questions\n- What still needs verification.',
    tone: 'cyan',
  },
  {
    slug: 'code-review',
    featured: true,
    name: 'Code review',
    category: 'Engineering',
    description: 'Review a change for concrete bugs and explain what needs attention.',
    outcome: 'A code-review.md report with actionable findings, file references, and verification gaps.',
    requirements: ['Repository files in the selected worktree', 'A change, diff, or review scope'],
    instructions: `Review the code and change scope described in my task. Read the repository instructions, relevant callers, and existing tests before making a judgment. Prioritize demonstrated correctness, security, data loss, and recovery problems.

Do not modify implementation files or run commands with external side effects. Use existing local checks when they are safe and available. For each finding, give its impact, a concrete trigger, the file and line, and a small repair direction. Distinguish verified defects from uncertainties; do not invent findings to fill a quota.

Save code-review.md with the findings and checks actually performed. If no actionable issues are found, say so and explain the limits of the review.`,
    example:
      '# Code review\n\n## Findings\nEach issue includes a trigger, impact, and file reference.\n\n## Verification\nChecks performed and remaining gaps.',
    tone: 'sage',
  },
  {
    slug: 'data-analyst',
    featured: true,
    name: 'Data analyst',
    category: 'Data',
    description: 'Explore a dataset and turn the important patterns into a useful report.',
    outcome: 'An analysis.md report and reproducible analysis files, without changing source data.',
    requirements: ['A CSV or JSON dataset in the worktree', 'The question you want the data to answer'],
    instructions: `Analyze the dataset and question described in my task. Inspect its schema, units, missing values, duplicates, and date coverage before calculating results. Preserve the original data and work in separate output files.

Use reproducible local code for calculations. Distinguish observed associations from causal claims, document exclusions, and avoid exposing individual records unnecessarily. If the available data cannot answer the question, explain what is missing.

Save analysis.md with an answer, key measurements, methodology, caveats, and next steps. Include the analysis script and any useful summary tables in the worktree. Tell me how to reproduce the result.`,
    example:
      '# Analysis\n\n## Answer\nWhat the available data supports.\n\n## Measurements\nMetric | Value | Unit\n\n## Method and limitations\nCoverage, exclusions, and reproduction steps.',
    tone: 'ember',
  },
  {
    slug: 'support-triage',
    featured: true,
    name: 'Support triage',
    category: 'Operations',
    description: 'Classify incoming issues and prepare grounded replies for review.',
    outcome: 'A support-triage.md queue with severity, evidence, suggested owner, and reply drafts.',
    requirements: [
      'Support requests and product documentation',
      'Optional authorized connection to your support source',
    ],
    instructions: `Triage the support requests supplied in my task or available through explicitly authorized connections. Use this worktree's product documentation to distinguish known behavior, configuration issues, and potential defects.

For each request, capture the problem, severity with a reason, missing information, a suggested owner, and a concise reply draft grounded in the documentation. Escalate uncertainty rather than promising an unsupported fix or deadline.

Save support-triage.md for human review. Do not send replies, change tickets, or contact anyone. Keep sensitive customer details out of the report unless needed to identify the supplied request.`,
    example:
      '# Support triage\n\n## Request\nProblem and supporting evidence.\n\n## Recommendation\nSeverity, suggested owner, and missing context.\n\n## Reply draft\nA response ready for a person to review.',
    tone: 'cyan',
  },
  {
    slug: 'personal-assistant',
    featured: true,
    name: 'Personal assistant',
    category: 'Personal',
    description: 'Plan your day, organize errands, and turn scattered notes into clear next steps.',
    outcome: 'A personal-plan.md file with priorities, a practical plan, and decisions for you to review.',
    requirements: [
      'Your goal, available time, and preferences',
      'Relevant notes or files you choose to share; connections are optional',
    ],
    instructions: `Help me accomplish the personal task I describe, such as planning a day, organizing errands, or comparing options. Start with the relevant notes and files I choose to share in this worktree. Ask for missing constraints that would materially change the plan, and make ordinary planning assumptions explicit.

Use only the files needed for this task and explicitly authorized connections. Keep personal details private: do not copy sensitive records into summaries unnecessarily, expose credentials, or share my information with another service without authorization. If current availability, travel time, or prices matter, verify them with an authorized source or clearly mark them as unverified.

Save personal-plan.md with the goal, ordered priorities, a realistic plan, any tradeoffs, and decisions that need my input. Preserve original notes and unrelated files. Draft messages or calendar changes for review when useful, but do not send messages, book appointments, make purchases, change calendars, or delete files without my explicit authorization for those actions. Do not create a recurring schedule automatically. Tell me where the plan is saved and what remains for me to decide.`,
    example:
      '# Personal plan\n\n## Goal\nThe task and constraints you supplied.\n\n## Priorities\nThe most useful next steps, in order.\n\n## Plan\nA practical sequence that fits your available time.\n\n## For your review\nOpen decisions, unverified details, and any draft messages.',
    tone: 'sage',
  },
  {
    slug: 'weekly-workspace-digest',
    featured: false,
    name: 'Weekly workspace digest',
    category: 'Operations',
    description: 'Bring the week’s progress, decisions, and blockers into one update.',
    outcome: 'A weekly-digest.md draft with changes, decisions, blockers, and the next priorities.',
    requirements: [
      'Workspace notes, changelog, or authorized activity sources',
      'A reporting date range; add a schedule separately if needed',
    ],
    instructions: `Prepare a workspace digest for the date range in my task. Review the notes, changelog, and activity available in this worktree or through explicitly authorized connections. State the reporting period and source coverage.

Summarize completed work, important decisions, active blockers, and the next priorities. Link each substantive update to its source. Do not infer completion from a plan or an open task, and do not invent activity when the sources are quiet.

Save weekly-digest.md as a draft for review. Do not post or email the digest. A recurring schedule must be configured separately with an explicit prompt, timezone, and budget.`,
    example:
      '# Weekly digest\n\nReporting period: supplied date range\n\n## Completed\nVerified changes with source references.\n\n## Decisions and blockers\nWhat changed and what needs attention.\n\n## Next priorities\nFollow-up work for the team to review.',
    tone: 'ember',
  },
];

export const featuredTemplates = agentTemplates.filter((template) => template.featured);

export const plannedTemplates = [
  {
    slug: 'release-notes',
    name: 'Release notes',
    category: 'Engineering',
    description: 'Turn merged changes into a customer-ready release draft.',
  },
  {
    slug: 'account-research',
    name: 'Account research',
    category: 'Research',
    description: 'Prepare a sourced account brief before a customer conversation.',
  },
  {
    slug: 'incident-summary',
    name: 'Incident summary',
    category: 'Operations',
    description: 'Reconstruct an incident timeline and draft follow-up actions.',
  },
] as const;

export function findAgentTemplate(slug: string | null | undefined) {
  return agentTemplates.find((template) => template.slug === slug);
}

export function searchTemplates<T extends { name: string; category: string; description: string }>(
  templates: readonly T[],
  query: string,
): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return templates.filter((template) => {
    const text = `${template.name} ${template.category} ${template.description}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function templatePreset(slug: string | null | undefined) {
  const template = findAgentTemplate(slug);
  return template ? { name: template.name, instructions: template.instructions } : undefined;
}

/** Link to the shared onboarding brief instead of maintaining a second copy of its API instructions. */
export function templateCodingPrompt(template: AgentTemplate, origin: string) {
  const docsOrigin = new URL(origin).origin;
  return `Help me build a ${template.name.toLowerCase()} agent with Macrofold in this application.

Deployment: ${docsOrigin}
Expected outcome: ${template.outcome}
Inputs to arrange: ${template.requirements.join('; ')}.

Read and follow the current integration brief at ${docsOrigin}/docs/raw/agents.md, then the API quickstart at ${docsOrigin}/docs/raw/api/quickstart.md and SDK guide at ${docsOrigin}/docs/raw/sdk.md. These apply to this deployment; inspect its enabled models and available connections instead of assuming access. If these local URLs are unreachable, ask me for the Markdown rather than guessing.

Create a reviewable agent preset using the following instructions. Let me select the workspace/worktree, compatible model, funding method, and exact authorized connections. Do not invent a tool grant or configure a schedule automatically. Store credentials securely outside source code and chat. Ask for an explicit budget before paid execution. Verify the integration with deterministic fixtures or free local simulation first.

Agent instructions:
${template.instructions}`;
}
