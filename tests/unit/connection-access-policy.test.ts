import { describe, it, expect } from 'vitest';
import {
  accessMatches,
  ruleMatches,
  ruleConditional,
  selectedGrants,
  type AccessRule,
} from '../../packages/core/src/connection-access-policy';
const pair: AccessRule = { scope: 'workspace_agent', workspace_id: 'sales', agent_id: 'writer' };
describe('connection access policy', () => {
  it.each([
    [{ workspace_id: 'sales', agent_id: 'writer' }, true],
    [{ workspace_id: 'sales', agent_id: 'researcher' }, false],
    [{ workspace_id: 'support', agent_id: 'writer' }, false],
    [{ workspace_id: 'sales', agent_id: null }, false],
    [{ workspace_id: 'sales' }, true],
    [{ agent_id: 'writer' }, true],
    [{}, true],
  ] as const)('matches a whole pair in %j', (context, expected) =>
    expect(ruleMatches(pair, context)).toBe(expected),
  );
  it('does not join crossed pairs and does not confuse a custom execution with a browse wildcard', () => {
    const rules: AccessRule[] = [
      pair,
      { scope: 'workspace_agent', workspace_id: 'support', agent_id: 'researcher' },
    ];
    expect(accessMatches(false, rules, { workspace_id: 'sales', agent_id: 'researcher' })).toBe(false);
    expect(accessMatches(false, rules, { workspace_id: 'sales', agent_id: null })).toBe(false);
    expect(accessMatches(false, rules, { workspace_id: 'sales' })).toBe(true);
    expect(ruleConditional(pair, { workspace_id: 'sales' })).toBe(true);
    expect(ruleConditional(pair, { workspace_id: 'sales', agent_id: 'writer' })).toBe(false);
  });
  it('adds matching scopes without precedence or a master toggle', () => {
    expect(
      accessMatches(false, [pair, { scope: 'workspace', workspace_id: 'sales' }], {
        workspace_id: 'sales',
        agent_id: null,
      }),
    ).toBe(true);
    expect(accessMatches(true, [], { workspace_id: 'support', agent_id: null })).toBe(true);
    expect(accessMatches(false, [], { workspace_id: 'sales', agent_id: 'writer' })).toBe(false);
  });
  it('retains the difference between inherit, saved selection, and explicit none', () => {
    const saved = [{ connection_id: 'mail', tools: ['read'] }];
    expect(selectedGrants(undefined, undefined)).toBeUndefined();
    expect(selectedGrants(undefined, saved)).toBe(saved);
    expect(selectedGrants([], saved)).toEqual([]);
    expect(selectedGrants(undefined, [])).toEqual([]);
  });
});
