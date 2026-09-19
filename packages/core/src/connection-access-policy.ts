import type { components } from '../../contracts/api';

type Schema = components['schemas'];
export type Grant = Schema['Grant'];
export type AccessRule = Schema['ConnectionAccessRuleInput'];
export type ExecutionContext = { workspace_id: string; agent_id: string | null };
/** Missing dimensions are wildcards only in browsing. A custom execution uses agent_id:null. */
export type AccessContext = { workspace_id?: string; agent_id?: string | null };
export type AccessSource = Schema['ConnectionAccessResolution']['source'];
export const toolConnectionKinds = ['composio', 'mcp_remote', 'mcp_stdio', 'search'] as const;
export const isToolConnection = (kind: string) => toolConnectionKinds.some((value) => value === kind);

/** Match one whole rule. Never combine workspace/agent halves of different paired rules. */
export function ruleMatches(rule: AccessRule, context: AccessContext): boolean {
  return (
    (!('workspace_id' in rule) || context.workspace_id === undefined || rule.workspace_id === context.workspace_id) &&
    (!('agent_id' in rule) || context.agent_id === undefined || rule.agent_id === context.agent_id)
  );
}
export function ruleConditional(rule: AccessRule, context: AccessContext): boolean {
  return (
    ('workspace_id' in rule && context.workspace_id === undefined) ||
    ('agent_id' in rule && context.agent_id === undefined)
  );
}
export function accessMatches(organizationWide: boolean, rules: AccessRule[], context: AccessContext) {
  return organizationWide || rules.some((rule) => ruleMatches(rule, context));
}
export const sourcePriority: Record<AccessSource, number> = {
  workspace_agent: 0,
  workspace: 1,
  agent: 2,
  organization: 3,
  run_override: 4,
  none: 5,
};
export function selectedGrants(explicit: Grant[] | undefined, saved: Grant[] | undefined) {
  return explicit ?? saved;
}
export function ruleInput(rule: {
  scope: AccessRule['scope'];
  workspace_id: string | null;
  agent_id: string | null;
}): AccessRule {
  switch (rule.scope) {
    case 'workspace':
      return { scope: 'workspace', workspace_id: rule.workspace_id! };
    case 'agent':
      return { scope: 'agent', agent_id: rule.agent_id! };
    case 'workspace_agent':
      return { scope: 'workspace_agent', workspace_id: rule.workspace_id!, agent_id: rule.agent_id! };
  }
}
