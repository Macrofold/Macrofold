import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/browser';

test('assistant preview gives guidance without account mutations and restores keyboard focus', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const launcher = page.getByRole('button', { name: 'Ask Macrofold', exact: true });
  await expect(launcher).toBeVisible();
  const writes: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/v1/') && !['GET', 'HEAD'].includes(request.method()))
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await launcher.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Macrofold assistant Preview' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Sample guidance. No account changes or agent execution.');
  const question = dialog.getByRole('textbox', { name: 'Ask Macrofold a question' });
  await expect(question).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Send question' })).toBeDisabled();
  await question.fill('Add $500 credits to my account');
  await question.press('Enter');
  const conversation = dialog.getByRole('log', { name: 'Assistant conversation' });
  await expect(conversation).toContainText('This preview cannot read your balance or change spending.');
  await expect(conversation.getByRole('link', { name: 'Open billing' })).toHaveAttribute('href', '/billing');
  await expect(question).toHaveValue('');
  expect(writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test('assistant setup prompt uses this deployment and keeps a manual copy path', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask Macrofold', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Macrofold assistant Preview' });
  await dialog.getByRole('button', { name: 'Get setup prompt', exact: true }).click();
  const copy = dialog.getByRole('button', { name: 'Copy setup prompt', exact: true });
  await expect(copy).toBeVisible();
  await dialog.getByText('Read or copy manually', { exact: true }).click();
  const prompt = dialog.getByRole('textbox', { name: 'Coding-agent setup prompt' });
  const origin = new URL(page.url()).origin;
  await expect(prompt).toContainText(`Deployment: ${origin}`);
  await expect(prompt).toContainText(`${origin}/docs/raw/api/quickstart.md`);
  await expect(prompt).toContainText('never ask me to paste it into chat');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await copy.click();
  await expect(copy).toHaveAttribute('data-copy-state', 'copied');
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(await prompt.inputValue());
});

test('assistant help is keyboard accessible and fits a narrow screen', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ask Macrofold', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Macrofold assistant Preview' });
  const assistantTab = dialog.getByRole('tab', { name: 'Assistant', exact: true });
  await assistantTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: 'Help & resources' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('link', { name: /Documentation Quickstarts/ })).toHaveAttribute(
    'href',
    '/docs',
  );
  await expect(dialog.getByRole('link', { name: /Troubleshooting Access/ })).toHaveAttribute(
    'href',
    '/docs/troubleshooting',
  );
  await expect(dialog).toContainText('This preview does not send support requests.');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  const audit = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.failureSummary),
    })),
  ).toEqual([]);
  await dialog.getByRole('link', { name: /Troubleshooting Access/ }).click();
  await expect(page).toHaveURL(/\/docs\/troubleshooting$/);
  await expect(page.getByRole('heading', { name: 'Troubleshooting', exact: true })).toBeVisible();
});
