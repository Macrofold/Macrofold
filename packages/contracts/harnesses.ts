export const harnesses = [
  {
    id: 'codex',
    name: 'Codex',
    provider: 'OpenAI',
    description: 'Engineering and complex repository work',
    capabilities: {
      streaming: true,
      incremental_output: true,
      continuation: true,
      cancellation: true,
      mcp: true,
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    provider: 'Anthropic',
    description: 'Research, writing, and thoughtful code changes',
    capabilities: {
      streaming: true,
      incremental_output: true,
      continuation: true,
      cancellation: true,
      mcp: true,
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    provider: 'Multi-provider',
    description: 'Flexible, open-source agent workflows',
    capabilities: {
      streaming: true,
      incremental_output: true,
      continuation: true,
      cancellation: true,
      mcp: true,
    },
  },
  {
    id: 'hermes',
    name: 'Hermes',
    provider: 'Nous Research',
    description: 'Persistent skills, memory, and coding tools',
    capabilities: {
      streaming: true,
      incremental_output: true,
      continuation: true,
      cancellation: true,
      mcp: true,
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Harness',
    provider: 'DeepSeek',
    description: 'Plugin-based coding with persistent sessions',
    capabilities: {
      streaming: true,
      incremental_output: false,
      continuation: true,
      cancellation: true,
      mcp: true,
    },
  },
  {
    id: 'pi',
    name: 'Pi',
    provider: 'Multi-provider',
    description: 'Minimal coding agent with file and shell tools',
    capabilities: {
      streaming: true,
      incremental_output: true,
      continuation: true,
      cancellation: true,
      mcp: true,
    },
  },
] as const;
export type HarnessName = (typeof harnesses)[number]['id'];
export const harnessNames = harnesses.map((h) => h.id) as [HarnessName, ...HarnessName[]];
export const harnessLabel = (id: string) => harnesses.find((h) => h.id === id)?.name || id;
