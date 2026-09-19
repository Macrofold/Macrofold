import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { Macrofold } from '../../sdk/typescript/src/index';
import { AgentStore } from '../../examples/personal-agent/store';
import { PersonalAgents } from '../../examples/personal-agent/service';
import { exampleServer, demoAuth } from '../../examples/personal-agent/server';

test('Alice creates Milo, corrects memory, chats, connects, schedules, pauses and deletes while Bob stays separate', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  const keyResponse = await page.request.post('/v1/api-keys', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: {
      name: `Personal reference ${randomUUID()}`,
      scopes: [
        'identity:read',
        'workspaces:read',
        'workspaces:write',
        'workspaces:delete',
        'files:read',
        'files:write',
        'runs:read',
        'runs:write',
        'connections:read',
        'connections:write',
        'triggers:read',
        'triggers:write',
      ],
    },
  });
  expect(keyResponse.ok(), await keyResponse.text()).toBe(true);
  const key = await keyResponse.json();
  const client = new Macrofold({ baseURL: fixtureOrigin, apiKey: key.secret });
  expect((await client.models.list()).data.some((model) => model.id === 'fixture-model')).toBe(true);
  const dir = await mkdtemp(path.join(tmpdir(), 'browser-personal-'));
  const store = new AgentStore(path.join(dir, 'app.sqlite'));
  const service = new PersonalAgents(store, client, {
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
    budgetMicroUsd: '2000000',
  });
  const server = exampleServer(service, demoAuth, true).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server missing');
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Milo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open file', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Source', exact: true })
      .fill('# Profile\nQuiet hotels. Confirmed by Alice.');
    await page.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    await page.getByRole('textbox', { name: 'Your message' }).fill('Plan a quiet weekend away.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('succeeded · persistence: verified', { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await page.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('');
    await page.getByRole('textbox', { name: 'Your message' }).fill('Review next week in a new conversation.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('succeeded · persistence: verified', { exact: true })).toHaveCount(2, {
      timeout: 60000,
    });
    await page.getByRole('button', { name: 'Open file', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Source', exact: true })).toHaveValue(/Quiet hotels/);
    await page.getByText('Connect a search account', { exact: true }).click();
    await page.getByLabel('Exa API key', { exact: true }).fill('fixture-only-not-a-real-key');
    await page.getByRole('button', { name: 'Save account and allow search' }).click();
    await expect(
      page.getByText('Search account saved. Only this workspace and agent have access.'),
    ).toBeVisible();
    await page.getByText('Schedule a weekly review', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Timezone', exact: true }).fill('Invalid/Zone');
    await page.getByRole('button', { name: 'Enable weekly review' }).click();
    await expect(page.getByRole('status')).toContainText('valid IANA timezone');
    await page.getByRole('textbox', { name: 'Timezone', exact: true }).fill('America/New_York');
    await page.getByRole('button', { name: 'Enable weekly review' }).click();
    await expect(page.getByText(/^Enabled · America\/New_York/)).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText(/^Paused · America\/New_York/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: 'test-results/personal-agent-example.png', fullPage: true });
    await page.getByRole('combobox', { name: 'Demo customer' }).selectOption('bob');
    await expect(page.getByRole('heading', { name: 'Milo', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Agent name', exact: true }).fill('Basil');
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Basil', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open file', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Source', exact: true })).not.toHaveValue(/Quiet hotels/);
    await page.getByRole('combobox', { name: 'Demo customer' }).selectOption('alice');
    await expect(page.getByRole('heading', { name: 'Milo', exact: true })).toBeVisible();
    await page.getByText('Delete this agent', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Type the agent’s name' }).fill('Milo');
    await page.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Milo', exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Demo customer' }).selectOption('bob');
    await expect(page.getByRole('heading', { name: 'Basil', exact: true })).toBeVisible();
  } finally {
    await page.goto('about:blank');
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
