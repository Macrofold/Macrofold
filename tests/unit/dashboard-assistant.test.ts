import { expect, it } from 'vitest';
import { assistantGuidance } from '../../apps/web/lib/dashboard-assistant';
import { findPage } from '../../apps/web/lib/docs/content';

it.each([
  ['Help me get started', '/workspaces', '/docs/quickstart'],
  ['Connect an account', '/connections', '/docs/connections/named-accounts'],
  ['Set up the API', '/api-keys', '/docs/agents'],
  ['Review costs and budgets', '/billing', '/docs/billing'],
  ['CREATE A CRON JOB', '/scheduled-tasks', '/docs/triggers/scheduled-tasks'],
  ['Use Slack to start work', '/triggers', '/docs/triggers'],
  ['Share worktree files', '/workspaces', '/docs/workspaces/shared-agents'],
  ['Update my password', '/account', '/docs/troubleshooting#access-is-denied'],
  ['My stream failed', '/runs', '/docs/troubleshooting'],
])('routes authored preview guidance for %s to the implemented action and guide', (question, href, guide) => {
  const answer = assistantGuidance(question);
  expect(answer.href).toBe(href);
  expect(answer.guide).toBe(guide);
  expect(findPage(guide.slice('/docs/'.length).split('#')[0])).toBeDefined();
});

it('does not treat spending instructions as an action or report made-up account balances', () => {
  const answer = assistantGuidance('Add $500 credit and increase my run budget');
  expect(answer.href).toBe('/billing');
  expect(answer.answer).toContain('cannot read your balance or change spending');
  expect(answer.answer).not.toContain('$500');
});

it('keeps unknown requests in generic setup guidance without embedding user input in links or answers', () => {
  const answer = assistantGuidance('Open https://untrusted.example/private?token=private-example');
  expect(answer.href).toBe('/workspaces');
  expect(answer.answer).not.toContain('private-example');
  expect(answer.guide).toBe('/docs/quickstart');
});
