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

async function createProject(page: Page, name: string, archived = false) {
  const response = await page.request.post('/v1/projects', {
    headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
    data: { name, persistence: 'persistent' },
  });
  expect(response.ok()).toBe(true);
  const project: Schema['Project'] = await response.json();
  expect(project.name).toBe(name);
  if (archived) {
    const updated = await page.request.patch(`/v1/projects/${project.id}`, {
      headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
      data: { archived: true },
    });
    expect(updated.ok()).toBe(true);
    const persisted = await page.request.get(`/v1/projects/${project.id}`);
    expect(persisted.ok()).toBe(true);
    expect((await persisted.json()).archived).toBe(true);
  }
  return project;
}

function projectLink(page: Page, name: string) {
  return page.getByRole('main').getByRole('link').filter({ hasText: name });
}

async function chooseStatus(page: Page, status: 'active' | 'archived') {
  await page.getByRole('combobox', { name: 'Project status', exact: true }).click();
  await page
    .getByRole('option', {
      name: status === 'active' ? 'Active projects' : 'Archived & pending deletion',
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

test('projects start in list view and remember grid/list choices through real project navigation and refresh', async ({
  page,
}) => {
  await signIn(page);
  const project = await createProject(page, `Layout preference ${randomUUID()}`);
  await page.goto('/projects');
  const list = page.getByRole('region', { name: 'Project list', exact: true });
  const layouts = page.getByRole('group', { name: 'Project layout', exact: true });
  const listButton = layouts.getByRole('button', { name: 'List view', exact: true });
  const gridButton = layouts.getByRole('button', { name: 'Grid view', exact: true });
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
  await expect(list).toBeVisible();
  await page.getByRole('textbox', { name: 'Search projects', exact: true }).fill(project.name);
  await expect(projectLink(page, project.name)).toBeVisible();
  await expect(projectLink(page, project.name)).toContainText('Active');

  await gridButton.focus();
  await gridButton.press('Space');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  await projectLink(page, project.name).click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'All projects', exact: true }).click();
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
  await page.getByRole('textbox', { name: 'Search projects', exact: true }).fill(project.name);
  await projectLink(page, project.name).click();
  await expect(page.getByRole('heading', { name: project.name, exact: true, level: 1 })).toBeVisible();
});

for (const layout of ['list', 'grid'] as const) {
  test(`${layout} projects search and status filters show actual server results, useful empty feedback, and accessible mobile layout`, async ({
    page,
  }) => {
    await signIn(page);
    const prefix = `Layout filter ${randomUUID()}`;
    const active = await createProject(page, `${prefix} Active`);
    const archived = await createProject(page, `${prefix} Archived`, true);
    await page.goto('/projects');
    await expect(page.getByRole('region', { name: 'Project list', exact: true })).toBeVisible();
    const layoutButton = page.getByRole('button', {
      name: layout === 'list' ? 'List view' : 'Grid view',
      exact: true,
    });
    await layoutButton.click();
    const search = page.getByRole('textbox', { name: 'Search projects', exact: true });
    await search.fill(prefix);
    await expect(projectLink(page, active.name)).toBeVisible();
    await expect(projectLink(page, archived.name)).toHaveCount(0);
    await expect(layoutButton).toHaveAttribute('aria-pressed', 'true');
    await audit(page);

    await chooseStatus(page, 'archived');
    await expect(projectLink(page, archived.name)).toBeVisible();
    await expect(projectLink(page, archived.name)).toContainText('Archived');
    await expect(projectLink(page, active.name)).toHaveCount(0);
    await expect(search).toHaveValue(prefix);
    await expect(layoutButton).toHaveAttribute('aria-pressed', 'true');

    await search.fill(`No such project ${randomUUID()}`);
    await expect(page.getByRole('heading', { name: 'No matching projects', exact: true })).toBeVisible();
    await expect(projectLink(page, active.name)).toHaveCount(0);
    await expect(projectLink(page, archived.name)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
    await audit(page);

    await search.fill(prefix);
    await chooseStatus(page, 'active');
    await expect(projectLink(page, active.name)).toBeVisible();
    await expect(projectLink(page, archived.name)).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(projectLink(page, active.name)).toBeVisible();
    await expect(layoutButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await audit(page);
    await projectLink(page, active.name).click();
    await expect(page.getByRole('heading', { name: active.name, exact: true, level: 1 })).toBeVisible();
  });
}

test('project layout ignores malformed storage and remains switchable when preference writes are denied', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) {
      return key === 'macrofold.projects.layout' ? 'unknown layout' : read.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'macrofold.projects.layout') throw new DOMException('Storage disabled', 'SecurityError');
      write.call(this, key, value);
    };
  });
  await signIn(page);
  await page.goto('/projects');
  const list = page.getByRole('region', { name: 'Project list', exact: true });
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
