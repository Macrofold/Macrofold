import { test, expect } from '../fixtures/browser';
import { harnesses } from '../../packages/contracts/harnesses';

const harnessMarks: Record<string, string> = {
  codex: '/brands/codex.svg',
  'claude-code': '/brands/claude.svg',
  opencode: '/brands/opencode.svg',
  hermes: '/brands/hermes.png',
  deepseek: '/brands/deepseek.svg',
  pi: '/brands/pi.svg',
};

for (const surface of ['run', 'preset']) {
  test(`${surface} selectors retain company marks in options and selected values`, async ({ page }) => {
    // Metadata only. No synthetic model is submitted to an execution endpoint.
    const models = [
      { id: 'gpt-logo-fixture', provider: 'openai', mark: '/brands/openai-mark.svg' },
      { id: 'claude-logo-fixture', provider: 'anthropic', mark: '/brands/claude.svg' },
      { id: 'deepseek/logo-fixture', provider: 'openrouter', mark: '/brands/deepseek.svg' },
    ];
    await page.route('**/v1/models*', (route) =>
      route.fulfill({
        json: {
          data: models.map(({ id, provider }) => ({
            id,
            name: id,
            provider,
            harnesses: harnesses.map(({ id }) => id),
            input_micro_usd_per_million: '0',
            output_micro_usd_per_million: '0',
            enabled: true,
          })),
          next_cursor: null,
        },
      }),
    );
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/v1\/(runs|agents)$/.test(new URL(request.url()).pathname))
        writes.push(request.url());
    });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: surface === 'run' ? 'Runs' : 'Agent presets', exact: true }).click();
    await page
      .getByRole('button', { name: surface === 'run' ? 'New run' : 'New preset', exact: true })
      .click();
    const harness = page.getByRole('combobox', { name: 'Harness', exact: true });
    for (const item of harnesses) {
      await harness.click();
      const option = page.getByRole('option', { name: item.name, exact: true });
      await expect(option.locator('img')).toHaveAttribute('src', harnessMarks[item.id]);
      await option.click();
      await expect(harness.locator('img')).toHaveAttribute('src', harnessMarks[item.id]);
      await expect
        .poll(() => harness.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth > 0))
        .toBe(true);
    }
    const model = page.getByRole('combobox', { name: 'Model', exact: true });
    for (const item of models) {
      await model.click();
      const option = page.getByRole('option', { name: item.id, exact: true });
      await expect(option.locator('img')).toHaveAttribute('src', item.mark);
      await option.click();
      await expect(model.locator('img')).toHaveAttribute('src', item.mark);
    }
    // Closing content restores focus asynchronously; Home also defers option focus in Radix.
    await expect(page.locator('.select-content')).toHaveCount(0);
    await expect(model).toBeFocused();
    await harness.focus();
    await expect(harness).toBeFocused();
    await harness.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(page.getByRole('option', { name: 'Pi', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('option', { name: 'Codex', exact: true })).toBeFocused();
    await page.screenshot({
      path: test.info().outputPath('harness-company-marks.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Enter');
    await expect(page.locator('.select-content')).toHaveCount(0);
    await expect(harness).toBeFocused();
    await expect(harness).toContainText('Codex');
    await expect(harness.locator('img')).toHaveAttribute('src', '/brands/codex.svg');
    await expect(page.locator('img[src="/brands/openai.svg"], img[src="/brands/composio.svg"]')).toHaveCount(
      0,
    );
    expect(writes).toEqual([]);
  });
}

test('subscription choices identify Claude and Codex without collecting unsupported Codex credentials', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/v1\/(connections|runs|agents)/.test(new URL(request.url()).pathname)
    )
      writes.push(request.url());
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const claude = dialog.getByRole('button', { name: 'Claude subscription', exact: true });
  await expect(claude.locator('img')).toHaveAttribute('src', '/brands/claude.svg');
  await claude.click();
  await expect(dialog.locator('.connector-logo-tile img')).toHaveAttribute('src', '/brands/claude.svg');
  const codex = dialog.getByRole('button', { name: 'Codex subscription', exact: true });
  await expect(codex.locator('img')).toHaveAttribute('src', '/brands/codex.svg');
  await codex.click();
  await expect(dialog.locator('.connector-logo-tile img')).toHaveAttribute('src', '/brands/codex.svg');
  await expect(dialog).toContainText('Codex subscriptions are not available in Macrofold yet');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.locator('input[type="password"], form')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add connection', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Use an OpenAI API key', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Provider', exact: true })).toContainText('OpenAI');
  await expect(dialog.getByLabel('Provider API key')).toBeVisible();
  expect(writes).toEqual([]);
});
