import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Schema } from '../../apps/web/lib/client';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

async function createWorkspace(page: Page, name: string, archived = false) {
  const response = await page.request.post('/v1/workspaces', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: { name, persistence: 'persistent' },
  });
  expect(response.ok()).toBe(true);
  const workspace: Schema['Workspace'] = await response.json();
  expect(workspace.name).toBe(name);
  if (archived) {
    const updated = await page.request.patch(`/v1/workspaces/${workspace.id}`, {
      headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
      data: { archived: true },
    });
    expect(updated.ok()).toBe(true);
    const persisted = await page.request.get(`/v1/workspaces/${workspace.id}`);
    expect(persisted.ok()).toBe(true);
    expect((await persisted.json()).archived).toBe(true);
  }
  return workspace;
}

function workspaceLink(page: Page, name: string) {
  return page.getByRole('main').getByRole('link').filter({ hasText: name });
}

async function chooseStatus(page: Page, status: 'active' | 'archived') {
  await page.getByRole('combobox', { name: 'Workspace status', exact: true }).click();
  await page
    .getByRole('option', {
      name: status === 'active' ? 'Active workspaces' : 'Archived & pending deletion',
      exact: true,
    })
    .click();
}

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.failureSummary),
    })),
  ).toEqual([]);
}

test('workspaces start in list view and remember grid/list choices through real workspace navigation and refresh', async ({
  page,
}) => {
  await signIn(page);
  const workspace = await createWorkspace(page, `Layout preference ${randomUUID()}`);
  await page.goto('/workspaces');
  const list = page.getByRole('region', { name: 'Workspace list', exact: true });
  const layouts = page.getByRole('group', { name: 'Workspace layout', exact: true });
  const listButton = layouts.getByRole('button', { name: 'List view', exact: true });
  const gridButton = layouts.getByRole('button', { name: 'Grid view', exact: true });
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
  await expect(list).toBeVisible();
  await page.getByRole('textbox', { name: 'Search workspaces', exact: true }).fill(workspace.name);
  await expect(workspaceLink(page, workspace.name)).toBeVisible();
  await expect(workspaceLink(page, workspace.name)).toContainText('Active');

  await gridButton.focus();
  await gridButton.press('Space');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('heading', { name: workspace.name, exact: true })).toBeVisible();
  await workspaceLink(page, workspace.name).click();
  await expect(page).toHaveURL(`/workspaces/${workspace.id}`);
  await expect(page.getByRole('heading', { name: workspace.name, exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'All workspaces', exact: true }).click();
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toHaveCount(0);

  await listButton.click();
  await expect(list).toBeVisible();
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(list).toBeVisible();
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Search workspaces', exact: true }).fill(workspace.name);
  await workspaceLink(page, workspace.name).click();
  await expect(page.getByRole('heading', { name: workspace.name, exact: true, level: 1 })).toBeVisible();
});

for (const layout of ['list', 'grid'] as const) {
  test(`${layout} workspaces search and status filters show actual server results, useful empty feedback, and accessible mobile layout`, async ({
    page,
  }) => {
    await signIn(page);
    const prefix = `Layout filter ${randomUUID()}`;
    const active = await createWorkspace(page, `${prefix} Active`);
    const archived = await createWorkspace(page, `${prefix} Archived`, true);
    await page.goto('/workspaces');
    await expect(page.getByRole('region', { name: 'Workspace list', exact: true })).toBeVisible();
    const layoutButton = page.getByRole('button', {
      name: layout === 'list' ? 'List view' : 'Grid view',
      exact: true,
    });
    await layoutButton.click();
    const search = page.getByRole('textbox', { name: 'Search workspaces', exact: true });
    await search.fill(prefix);
    await expect(workspaceLink(page, active.name)).toBeVisible();
    await expect(workspaceLink(page, archived.name)).toHaveCount(0);
    await expect(layoutButton).toHaveAttribute('aria-pressed', 'true');
    await audit(page);

    await chooseStatus(page, 'archived');
    await expect(workspaceLink(page, archived.name)).toBeVisible();
    await expect(workspaceLink(page, archived.name)).toContainText('Archived');
    await expect(workspaceLink(page, active.name)).toHaveCount(0);
    await expect(search).toHaveValue(prefix);
    await expect(layoutButton).toHaveAttribute('aria-pressed', 'true');

    await search.fill(`No such workspace ${randomUUID()}`);
    await expect(page.getByRole('heading', { name: 'No matching workspaces', exact: true })).toBeVisible();
    await expect(workspaceLink(page, active.name)).toHaveCount(0);
    await expect(workspaceLink(page, archived.name)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New workspace', exact: true })).toBeEnabled();
    await audit(page);

    await search.fill(prefix);
    await chooseStatus(page, 'active');
    await expect(workspaceLink(page, active.name)).toBeVisible();
    await expect(workspaceLink(page, archived.name)).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(workspaceLink(page, active.name)).toBeVisible();
    await expect(layoutButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await audit(page);
    await workspaceLink(page, active.name).click();
    await expect(page.getByRole('heading', { name: active.name, exact: true, level: 1 })).toBeVisible();
  });
}

test('workspace layout ignores malformed storage and remains switchable when preference writes are denied', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) {
      return key === 'macrofold.workspaces.layout' ? 'unknown layout' : read.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'macrofold.workspaces.layout') throw new DOMException('Storage disabled', 'SecurityError');
      write.call(this, key, value);
    };
  });
  await signIn(page);
  await page.goto('/workspaces');
  const list = page.getByRole('region', { name: 'Workspace list', exact: true });
  await expect(list).toBeVisible();
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(list).toHaveCount(0);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(list).toBeVisible();
});
