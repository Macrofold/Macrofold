import { Fragment } from 'react';
import { Boxes, Terminal } from 'lucide-react';
import { ProviderLogo } from '../provider-logo';

const marks: Record<string, [string, string]> = {
  'Claude Code': ['claude', 'Claude Code'],
  Codex: ['codex', 'Codex'],
  OpenCode: ['opencode', 'OpenCode'],
  Anthropic: ['anthropic', 'Anthropic'],
  OpenAI: ['openai-mark', 'OpenAI'],
  OpenRouter: ['openrouter', 'OpenRouter'],
  GitHub: ['github', 'GitHub'],
  Git: ['git', 'Git'],
  Slack: ['slack', 'Slack'],
  Linear: ['linear', 'Linear'],
  TypeScript: ['typescript', 'TypeScript'],
  Python: ['python', 'Python'],
  Go: ['go', 'Go'],
  Rust: ['rust', 'Rust'],
  cURL: ['curl', 'cURL'],
  'Custom MCP': ['mcp', 'Custom MCP'],
  Brave: ['brave', 'Brave'],
  Exa: ['exa', 'Exa'],
  Tavily: ['tavily', 'Tavily'],
  'Parallel AI': ['parallel', 'Parallel AI'],
  Firecrawl: ['firecrawl', 'Firecrawl'],
};
export const brandNames: Record<string, string> = {
  gmail: 'Gmail',
  hubspot: 'HubSpot',
  notion: 'Notion',
  slack: 'Slack',
  github: 'GitHub',
  linear: 'Linear',
  postgresql: 'PostgreSQL · custom MCP',
  sentry: 'Sentry',
  datadog: 'Datadog',
};
export function Mark({ name }: { name: string }) {
  const mark = marks[name];
  return (
    <span className="jl-brand-label">
      {mark ? (
        <img src={`/brands/${mark[0]}.svg`} width={18} height={18} alt="" />
      ) : name === 'CLI' ? (
        <Terminal size={18} aria-hidden="true" />
      ) : name === 'Built-in connectors' ? (
        <Boxes size={18} aria-hidden="true" />
      ) : (
        <ProviderLogo provider={name} size={18} />
      )}
      <span>{mark?.[1] || name}</span>
    </span>
  );
}
const companyPattern = /(Claude Code|OpenCode|Codex|GitHub|Git\b|Slack|Linear|Composio)/g;
/** Keep authored company mentions paired with marks, including inline prose. */
export function BrandedText({ children }: { children: string }) {
  return children
    .split(companyPattern)
    .map((part, index) => <Fragment key={index}>{marks[part] ? <Mark name={part} /> : part}</Fragment>);
}
