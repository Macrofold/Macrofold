import AxeBuilder from '@axe-core/playwright';
import { test, expect, fixtureOrigin } from '../fixtures/browser';
import { headline, subtitle, pillars, scenarios } from '../../apps/web/components/landing/content';
import { examples } from '../../apps/web/components/landing/examples';

// Public presentation only: no account, database fixture, or provider execution.
test('the final homepage exposes clear onboarding, six benefits, code, and integration links', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Assertions below wait for the interactive UI; unchanged artwork downloads
  // are outside this copy/control check.
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(headline);
  await expect(page.locator('.mf-subtitle')).toHaveText(subtitle);
  await expect(page.locator('.mf-subtitle img')).toHaveCount(0);
  for (const brand of ['.mf-nav', '.mf-footer']) {
    const logo = page.locator(`${brand} .mf-brand img`);
    await expect(logo).toHaveAttribute('src', '/brands/macrofold/lockup.svg');
    await expect(logo).toHaveAttribute('alt', 'Macrofold');
    await expect.poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.locator('.mf-nav')).toHaveCSS('position', 'sticky');
  const hero = page.getByRole('region', { name: 'Introduction' });
  await expect(hero.getByRole('link', { name: 'Start building' })).toHaveAttribute('href', '/register');
  await expect(hero.getByRole('link', { name: 'View docs' })).toHaveAttribute('href', '/docs');
  expect(
    await hero
      .locator('.mf-source-links a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') || node.textContent)),
  ).toEqual(['GitHub repository', 'Star on GitHub', 'View contributor guide.']);
  await expect(page.locator('.mf-benefit-grid article')).toHaveCount(6);
  await expect(
    page.getByRole('heading', { name: 'Everything you need to go live.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'BYOK or Use Credits' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The conversation changes. Their information stays.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Build this customer experience' })).toHaveAttribute('href', '/docs/customer-agents');
  const productCopy = page.locator('.mf-product > .mf-section-heading > p');
  await expect(productCopy).toHaveText(
    'Everything agents can do on your computer available in your product or internal tool, with thousands of available app connectors.',
  );
  await expect(productCopy.locator('br, span, a')).toHaveCount(0);
  await expect(
    page.getByText(
      /A NEW UNIT OF POSSIBILITY|AI DEVELOPER INFRASTRUCTURE|BUILT TO FIT INTO YOUR SYSTEM|YOUR STACK, CONNECTED/i,
    ),
  ).toHaveCount(0);
  for (const name of ['Claude Code', 'Codex', 'OpenCode'])
    await expect(
      page.locator('.mf-integration-groups').getByRole('link', { name, exact: true }).locator('img'),
    ).toHaveCount(1);
  const snippet = page.getByRole('tabpanel');
  await expect(snippet).toContainText("import { Macrofold } from 'macrofold'");
  await expect(snippet).toContainText("harness: 'codex'");
  await expect(snippet).toContainText("model: 'gpt-5.4-mini'");
  await expect(snippet).not.toContainText('session_id');
  await page.getByRole('tab', { name: 'Python', exact: true }).click();
  await expect(snippet).toContainText('from macrofold import Macrofold');
  await expect(snippet).not.toContainText('session_id');
  await page.getByRole('tab', { name: 'CLI', exact: true }).click();
  await expect(snippet).toContainText('macrofold run');
  await expect(snippet).not.toContainText('--session');
  await page.getByRole('tab', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('client.Runs.Stream');
  await page.getByRole('tab', { name: 'Go', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Rust', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'TypeScript', exact: true }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    await page.getByRole('button', { name: 'Copy code example' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(examples.TypeScript);
  } finally {
    await context.clearPermissions();
  }
  const h1 = page.getByRole('heading', { level: 1 });
  await h1.hover();
  const strength = () =>
    h1.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--mf-gleam-strength')));
  await expect.poll(strength).toBe(1);
  await expect(h1).toHaveCSS(
    'transition-property',
    '--mf-gleam-strength, --mf-gleam-x, --mf-gleam-y, --mf-light-angle',
  );
  await expect(h1).toHaveCSS('transition-duration', '0.38s, 0.1s, 0.1s, 0.22s');
  const previousX = await h1.evaluate((el) =>
    parseFloat(getComputedStyle(el).getPropertyValue('--mf-gleam-x')),
  );
  const box = (await h1.boundingBox())!;
  await page.mouse.move(box.x + box.width - 30, box.y + 20);
  await expect
    .poll(() => h1.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--mf-gleam-x'))))
    .toBeGreaterThan(previousX + 30);
  await page.mouse.move(10, 10);
  await expect.poll(strength).toBe(0);
  await page.screenshot({ path: test.info().outputPath('hero.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
});

test('system motion settings do not pause playback and desktop diagrams pin at the viewport center', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/site');
  await expect(page.getByRole('button', { name: 'Pause animations', exact: true })).toBeVisible();
  await expect(page.locator('.mf-site')).toHaveAttribute('data-hero-visible', 'true');
  const heading = page.getByRole('heading', { level: 1 });
  await page.mouse.move(5, 5);
  const unlit = await heading.screenshot({ path: test.info().outputPath('sheen-off.png') });
  await heading.hover({ position: { x: 110, y: 50 } });
  await expect
    .poll(() =>
      heading.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--mf-gleam-strength'))),
    )
    .toBe(1);
  const lit = await heading.screenshot({
    path: test.info().outputPath('sheen-left.png'),
    animations: 'disabled',
  });
  expect(lit.equals(unlit)).toBe(false);
  await heading.hover({ position: { x: 250, y: 100 } });
  const moved = await heading.screenshot({
    path: test.info().outputPath('sheen-right.png'),
    animations: 'disabled',
  });
  expect(moved.equals(lit)).toBe(false);
  await page.mouse.move(5, 5);
  await expect
    .poll(() =>
      heading.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--mf-gleam-strength'))),
    )
    .toBe(0);
  await expect(page.locator('.mf-site')).toHaveAttribute('data-motion-override', 'playing');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  expect(
    await page.locator('.mf-diagram').evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    const center = () =>
      page.locator('.mf-diagram').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.top + box.height / 2;
      });
    await expect.poll(center).toBeCloseTo(size.height / 2, 0);
    const text = page.locator('.mf-story-chapter').first();
    const textY = (await text.boundingBox())!.y;
    const header = page.getByRole('heading', { name: 'An entire agent harness as one unit of execution.' });
    const headerY = (await header.boundingBox())!.y;
    await page.mouse.wheel(0, 150);
    await expect.poll(async () => textY - (await text.boundingBox())!.y).toBeGreaterThan(140);
    expect(headerY - (await header.boundingBox())!.y).toBeGreaterThan(140);
    await expect.poll(center).toBeCloseTo(size.height / 2, 0);
    for (const pillar of pillars.slice(1)) {
      await page.getByRole('button', { name: pillar.label, exact: true }).click();
      await expect.poll(center).toBeCloseTo(size.height / 2, 0);
      expect(
        await page.locator('.mf-unit').evaluateAll((units) =>
          units
            .filter((unit) => getComputedStyle(unit).opacity === '1')
            .every((unit) => {
              const card = unit.getBoundingClientRect();
              return [...unit.querySelectorAll('.mf-files, .mf-agent-prompt')].every((content) => {
                const box = content.getBoundingClientRect();
                return box.top >= card.top && box.bottom <= card.bottom;
              });
            }),
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`centered-${size.height}.png`) });
  }
});

test('native scrolling preserves agent identity and centers the diagram; case changes replay the current step', async ({
  page,
}) => {
  await page.goto('/site');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  const diagram = page.locator('.mf-diagram');
  await expect(diagram.locator('.mf-agent-shell').first()).toHaveCSS('opacity', '1');
  await expect(diagram.locator('.mf-agent-heading').first()).toContainText('Codex');
  for (const file of scenarios[0]!.files)
    await expect(diagram.locator('.mf-unit[data-agent="0"] .mf-files')).toContainText(file);
  const initialArt = (await page.locator('.mf-story-art').boundingBox())!;
  const initialPicker = (await page.locator('.mf-case-picker').boundingBox())!;
  expect(initialArt.y - initialPicker.y - initialPicker.height).toBeGreaterThanOrEqual(70);
  expect(initialArt.y - initialPicker.y - initialPicker.height).toBeLessThan(140);
  const firstAgent = await diagram.locator('.mf-unit[data-agent="0"]').elementHandle();
  for (const [index, pillar] of pillars.entries()) {
    await page.getByRole('button', { name: pillar.label, exact: true }).click();
    await expect(page.locator('.mf-story-viewport')).toHaveAttribute('data-current-step', String(index));
    await expect(diagram).toHaveAttribute('data-stage', String(index));
    expect(await firstAgent!.evaluate((el) => el.isConnected)).toBe(true);
    const box = await diagram.boundingBox();
    const picker = await page.locator('.mf-case-picker').boundingBox();
    const nav = (await page.locator('.mf-nav').boundingBox())!;
    expect(nav.y).toBe(0);
    expect(picker!.y - nav.height).toBeGreaterThanOrEqual(10);
    expect(picker!.y - nav.height).toBeLessThan(20);
    expect(box!.y).toBeGreaterThan(picker!.y + picker!.height);
    expect(box!.y + box!.height).toBeLessThan(1000);
    if (index === 2) await expect(diagram.locator('.mf-main')).toHaveCSS('opacity', '1');
    if (index === 4) {
      await expect(diagram.locator('.mf-orbit img')).toHaveCount(10);
      const orbit = await diagram.locator('.mf-orbit').boundingBox();
      expect(Math.abs(orbit!.width - orbit!.height)).toBeLessThan(2);
    }
    await page.screenshot({ path: test.info().outputPath(`step-${index}.png`), animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click();
  const movingCopy = page.locator('.mf-story-chapter').nth(1).getByRole('heading');
  const before = (await movingCopy.boundingBox())!.y;
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => before - (await movingCopy.boundingBox())!.y).toBeGreaterThan(80);
  await expect(diagram).toHaveAttribute('data-stage', '1');
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click();
  const scroll = await page.evaluate(() => scrollY);
  for (const scenario of scenarios.slice(1)) {
    await page.getByRole('button', { name: scenario.label, exact: true }).click();
    await expect(diagram).toHaveAttribute('data-case', scenario.id);
    await expect(page.locator('.mf-story-viewport')).toHaveAttribute('data-current-step', '1');
    await expect(diagram).toHaveAttribute('data-stage', '1');
    expect(Math.abs((await page.evaluate(() => scrollY)) - scroll)).toBeLessThan(2);
    for (let i = 0; i < 3; i++)
      await expect(diagram.locator(`.mf-unit[data-agent="${i}"] .mf-typed-prompt`)).toHaveText(
        scenario.prompts[i]!,
      );
  }
  // Real wheel scrolling, not only the chapter jump buttons, updates the scene.
  const next = await page.locator('.mf-story-chapter').nth(2).boundingBox();
  const scene = await page.locator('.mf-story-viewport').boundingBox();
  await page.mouse.wheel(0, next!.y + next!.height / 2 - scene!.y - scene!.height / 2);
  await expect(page.locator('.mf-story-viewport')).toHaveAttribute('data-current-step', '2');
});

test('mobile, keyboard, pause, and reduced motion keep the story readable and accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/site');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: test.info().outputPath('mobile-hero.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'API, CLI, UI', exact: true }).click();
  await expect(page.locator('.mf-diagram')).toHaveAttribute('data-stage', '3');
  await expect(page.locator('.mf-interface')).toHaveCount(4);
  const cards = await page
    .locator('.mf-unit')
    .evaluateAll((nodes) =>
      nodes.map((el) => ({ y: el.getBoundingClientRect().y, bottom: el.getBoundingClientRect().bottom })),
    );
  await expect
    .poll(async () =>
      page
        .locator('.mf-unit')
        .evaluateAll((nodes) => nodes.every((el) => el.getBoundingClientRect().bottom <= innerHeight)),
    )
    .toBe(true);
  expect(cards).toHaveLength(4);
  const mobileCopy = page.locator('.mf-mobile-copy');
  const copyTop = (await mobileCopy.boundingBox())!.y;
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => copyTop - (await mobileCopy.boundingBox())!.y).toBeGreaterThan(3);
  await expect(page.locator('.mf-diagram')).toHaveAttribute('data-stage', '3');
  await page.getByRole('button', { name: 'API, CLI, UI', exact: true }).click();
  await page.getByRole('button', { name: 'Personal Agent', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.mf-diagram')).toHaveAttribute('data-case', 'personal');
  await expect(page.locator('.mf-diagram')).toHaveAttribute('data-stage', '3');
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  await expect(page.locator('.mf-site')).toHaveAttribute('data-motion', 'paused');
  await page.screenshot({ path: test.info().outputPath('mobile-interfaces.png'), animations: 'disabled' });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
    })),
  ).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.mf-site').evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await expect(page.locator('.mf-diagram')).toHaveAttribute('data-stage', '4');
  await page.screenshot({ path: test.info().outputPath('mobile-connectors.png') });
});

test('short screens use readable chapters and recover when resized to a full viewport', async ({ page }) => {
  await page.goto('/site');
  // A short phone or landscape window gets normal-flow chapters, so no card
  // remains permanently below a pinned viewport.
  await page.setViewportSize({ width: 390, height: 667 });
  await expect(page.locator('.mf-short-story>article')).toHaveCount(5);
  await expect(page.locator('.mf-story-track')).toHaveCount(0);
  await page.getByRole('button', { name: 'Shared Team Agents', exact: true }).click();
  await expect(page.locator('.mf-short-story')).toContainText('product-repo/');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.locator('.mf-short-story .mf-diagram').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('short-screen.png') });
  await expect(page.locator('.mf-short-story .mf-story-copy').first()).toHaveCSS('opacity', '1');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.mf-story-track')).toHaveCount(1);
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await expect(page.locator('.mf-diagram')).toHaveAttribute('data-stage', '4');
});

test('the signed-out index uses the final site; old libraries and no-JavaScript reading remain available', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(headline);
  for (const [url, selector] of [
    ['/journeys', '.jl-gallery-grid>article'],
    ['/homepages', '.hp-gallery-card'],
    ['/concepts', '.concept-gallery-card'],
  ]) {
    // These preserved galleries are checked for availability and navigation.
    // Their own suites cover artwork; unrelated image downloads must not gate this check.
    await page.goto(url!, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(selector!)).toHaveCount(10);
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto(`${fixtureOrigin}/site`, { waitUntil: 'domcontentloaded' });
    await expect(staticPage.getByRole('heading', { level: 1 })).toHaveText(headline);
    await expect(staticPage.getByRole('tabpanel')).toContainText('macrofold.runs.create(');
    for (const scenario of scenarios)
      await expect(staticPage.locator('.mf-static-story')).toContainText(scenario.prompts[0]);
  } finally {
    await context.close();
  }
});

test('pricing retains the dark cyan surface, plan details, and accessible signup actions', async ({
  page,
}) => {
  await page.goto('/site');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Pricing' })
    .click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator('.mf-nav .mf-brand img')).toHaveAttribute('src', '/brands/macrofold/lockup.svg');
  await expect(page.locator('.mf-pricing')).toHaveCSS('background-color', 'rgb(6, 11, 14)');
  await expect(
    page.getByRole('heading', { name: 'Know what you’re paying for.', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('in plain language')).toHaveCount(0);
  for (const plan of ['Starter', 'Pro', 'Scale']) {
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: plan, exact: true }) });
    await expect(card.getByRole('link', { name: `Choose ${plan}` })).toHaveAttribute('href', '/register');
    await expect(card.getByRole('listitem')).toHaveCount(5);
  }
  await expect(
    page
      .locator('.mp-assisted')
      .filter({ has: page.getByRole('heading', { name: 'Business', exact: true }) }),
  ).toContainText('$1,000');
  await expect(page.getByRole('heading', { name: 'Enterprise', exact: true })).toBeVisible();
  const heading = page.getByRole('heading', { level: 1 });
  await heading.hover();
  await expect
    .poll(() =>
      heading.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--mf-gleam-strength'))),
    )
    .toBe(1);
  await page.screenshot({ path: test.info().outputPath('pricing-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  expect((await page.locator('.mp-plan').nth(1).boundingBox())!.y).toBeGreaterThan(
    (await page.locator('.mp-plan').first().boundingBox())!.y,
  );
  await page.screenshot({ path: test.info().outputPath('pricing-mobile.png'), animations: 'disabled' });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
});

test('the prompt docks into a worker, files type together, and saved work converges on Git', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/site');
  const diagram = page.locator('.mf-diagram');
  const letterCount = (index: number) =>
    diagram
      .locator(`.mf-unit[data-agent="${index}"] .mf-letter`)
      .evaluateAll((nodes) => nodes.filter((el) => getComputedStyle(el).opacity === '1').length);
  // Inspect actual rendered CSS effects at fixed timeline positions. Wall-clock
  // sampling can miss a short typing phase when the local machine is busy.
  const seek = (time: number) =>
    diagram.evaluate((el, milliseconds) => {
      for (const animation of el.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = milliseconds;
      }
    }, time);
  // Offscreen content is complete and idle. Entering the scene starts a fresh
  // reveal instead of consuming its animation before the reader gets there.
  await expect(diagram).toHaveAttribute('data-animated', 'false');
  expect(await letterCount(0)).toBe(scenarios[0]!.prompts[0].length);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(diagram).toHaveAttribute('data-animated', 'true');
  await seek(0);
  expect(await letterCount(0)).toBe(0);
  await seek(700);
  const earlyLetters = await letterCount(0);
  expect(earlyLetters).toBeGreaterThan(0);
  expect(earlyLetters).toBeLessThan(scenarios[0]!.prompts[0].length);
  const prompt = diagram.locator('.mf-agent-prompt').first();
  const initialWidth = (await prompt.boundingBox())!.width;
  await page.screenshot({ path: test.info().outputPath('prompt-typing.png') });
  await seek(1500);
  expect(await letterCount(0)).toBeGreaterThan(earlyLetters);
  await seek(3750);
  const names = diagram.locator('.mf-unit[data-agent="0"] .mf-file-name');
  expect(
    await names.evaluateAll((nodes) =>
      nodes.every((el) => {
        const remaining = parseFloat(getComputedStyle(el).clipPath.split(' ')[1] || '0');
        return remaining > 0 && remaining < 100;
      }),
    ),
  ).toBe(true);
  await page.screenshot({ path: test.info().outputPath('files-typing-together.png') });
  await seek(4600);
  await expect(names.first()).toHaveCSS('clip-path', 'inset(0px 0% 0px 0px)');
  expect((await prompt.boundingBox())!.width).toBeLessThan(initialWidth * 0.6);
  await expect(diagram.locator('.mf-file-lines path').first()).toHaveCSS('stroke-dashoffset', '0px');
  await expect(diagram.locator('.mf-file-lines path').first()).toHaveCSS('stroke-dasharray', 'none');
  await page.screenshot({ path: test.info().outputPath('prompt-docked.png') });
  expect(await page.locator('.mf-story-nav button').allTextContents()).toEqual([
    '01',
    '02',
    '03',
    '04',
    '05',
  ]);
  const firstAgent = await diagram.locator('.mf-unit[data-agent="0"]').elementHandle();
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click();
  // Chapter buttons scroll first; the next animation frame commits the stage.
  // Wait for its CSS effects before seeking, rather than seeking the old chapter.
  await expect(diagram).toHaveAttribute('data-stage', '1');
  await seek(850);
  expect(await letterCount(1)).toBeGreaterThan(0);
  expect(await letterCount(1)).toBeLessThan(scenarios[0]!.prompts[1].length);
  await seek(4200);
  await expect(diagram.locator('.mf-unit[data-agent="2"] .mf-file-name').first()).toHaveCSS(
    'clip-path',
    'inset(0px 0% 0px 0px)',
  );
  expect(await firstAgent!.evaluate((el) => el.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Checkpoints and Git Sync', exact: true }).click();
  await expect(diagram).toHaveAttribute('data-stage', '2');
  await seek(3800);
  await expect(diagram.locator('.mf-sync-path')).toHaveCSS('stroke-dashoffset', '0px');
  await expect(diagram.locator('.mf-main')).toHaveCSS('opacity', '1');
  await expect(diagram.locator('.mf-checkpoint').first()).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('saved-and-synced.png') });
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  expect(
    await diagram.evaluate((el) =>
      el
        .getAnimations({ subtree: true })
        .every((animation) => animation.playState === 'paused' || animation.playState === 'finished'),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Personal Agent', exact: true }).click();
  await expect(diagram).toHaveAttribute('data-case', 'personal');
  await expect(diagram).toHaveAttribute('data-stage', '2');
  expect(await letterCount(0)).toBe(scenarios[3]!.prompts[0].length);
  await expect(diagram.locator('.mf-agent-shell').first()).toHaveCSS('opacity', '1');
});

test('cyan reflections respond in two dimensions and drift at rest without lifting primary actions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  // The section observer runs after the delegated pointer listener is attached.
  // Hovering server-rendered markup before hydration would lose that mouse event.
  await expect(page.locator('.mf-site')).toHaveAttribute('data-hero-visible', 'true');
  const hero = page.getByRole('region', { name: 'Introduction' });
  const cta = hero.getByRole('link', { name: 'Start building' });
  const heading = page.getByRole('heading', { level: 1 });
  for (const surface of [heading, cta]) {
    const original = (await surface.boundingBox())!;
    await surface.hover({ position: { x: 20, y: 15 } });
    await expect
      .poll(() =>
        surface.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--mf-gleam-strength'))),
      )
      .toBe(1);
    await surface.hover({ position: { x: original.width - 20, y: original.height - 15 } });
    await expect
      .poll(() => surface.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--mf-gleam-x'))))
      .toBeGreaterThan(((original.width - 25) / original.width) * 100);
    await expect
      .poll(() => surface.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--mf-gleam-y'))))
      .toBeGreaterThan(((original.height - 20) / original.height) * 100);
    expect((await surface.boundingBox())!.y).toBe(original.y);
    await expect(surface).toHaveCSS('transform', 'none');
    // Seek the actual material animation while the cursor is stationary. Both
    // hovered and idle light must change, without moving the element itself.
    const sample = (time: number) =>
      surface.evaluate((el, milliseconds) => {
        const effect = el
          .getAnimations()
          .find((a) => a instanceof CSSAnimation && a.animationName === 'mf-material-light');
        if (!effect) throw new Error('Missing material animation');
        effect.pause();
        effect.currentTime = milliseconds;
        return getComputedStyle(el).backgroundImage;
      }, time);
    const hovered = await sample(1000);
    expect(hovered).toContain('linear-gradient');
    expect(hovered).not.toContain('radial-gradient');
    expect(await sample(5000)).not.toBe(hovered);
    const litPixels = await surface.screenshot({
      path: test.info().outputPath(surface === cta ? 'cyan-button-hover.png' : 'cyan-heading-hover.png'),
    });
    await page.mouse.move(5, 5);
    await expect
      .poll(() =>
        surface.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--mf-gleam-strength'))),
      )
      .toBe(0);
    const idle = await sample(2000);
    expect(await sample(8000)).not.toBe(idle);
    const idlePixels = await surface.screenshot({
      path: test.info().outputPath(surface === cta ? 'cyan-button-idle.png' : 'cyan-heading-idle.png'),
    });
    if (surface === heading) {
      // Inspect actual rendered pixels: reflection changes must stay inside
      // the letters instead of painting a rectangle across the hero.
      const pixels = await page.evaluate(
        async ([lit, idle]) => {
          const decode = async (encoded: string) => {
            const image = new Image();
            image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, image.width, image.height).data;
          };
          const [a, b] = await Promise.all([decode(lit!), decode(idle!)]);
          let letters = 0,
            backdrop = 0;
          for (let i = 0; i < a.length; i += 4) {
            const difference = Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c]! - b[i + c]!)));
            if (difference <= 8) continue;
            if (Math.max(b[i]!, b[i + 1]!, b[i + 2]!) < 20) {
              // A dark antialiased edge can brighten with the glyph. Classify
              // only pixels away from that edge as untouched backdrop.
              const adjacentGlyph = [-4, 4].some((offset) =>
                [0, 1, 2].some((channel) => (b[i + offset + channel] || 0) >= 20),
              );
              if (!adjacentGlyph) backdrop++;
            } else if (Math.min(b[i]!, b[i + 1]!, b[i + 2]!) > 120) letters++;
          }
          return { letters, backdrop };
        },
        [litPixels.toString('base64'), idlePixels.toString('base64')],
      );
      expect(pixels.letters).toBeGreaterThan(500);
      expect(pixels.backdrop).toBe(0);
    }
  }
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  expect(
    await heading.evaluate((el) =>
      el.getAnimations().every((a) => a.playState === 'paused' || a.playState === 'finished'),
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await cta.evaluate((el) => el.getAnimations().length)).toBe(0);
});

test('chapter copy enters below the pinned diagram and fades away toward the top', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-experience')).toHaveAttribute('data-ready', 'true');
  const scene = page.locator('.mf-story-viewport');
  const copy = page.locator('.mf-story-chapter .mf-story-copy').first();
  await scene.evaluate((el) => {
    const box = el.getBoundingClientRect();
    window.scrollBy(0, box.top + box.height / 2 - innerHeight / 2);
  });
  const center = () =>
    scene.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    });
  await expect.poll(center).toBeCloseTo(500, 0);
  const opacity = () => copy.evaluate((el) => Number(getComputedStyle(el).opacity));
  await expect.poll(opacity).toBeLessThan(0.9);
  const initial = (await copy.boundingBox())!;
  expect(initial.y + initial.height / 2).toBeGreaterThan(650);
  const picker = (await page.locator('.mf-case-picker').boundingBox())!;
  expect((await scene.boundingBox())!.y - picker.y - picker.height).toBeGreaterThanOrEqual(70);
  await page.screenshot({ path: test.info().outputPath('chapter-entering.png'), animations: 'disabled' });
  // The sticky navigation changes the available scene height. Scroll the
  // actual chapter to the focal point rather than assuming a fixed distance.
  const chapterBox = (await page.locator('.mf-story-chapter').first().boundingBox())!;
  await page.mouse.wheel(0, chapterBox.y + chapterBox.height / 2 - 500);
  await expect.poll(opacity).toBe(1);
  await expect.poll(center).toBeCloseTo(500, 0);
  const aligned = (await copy.boundingBox())!;
  expect(Math.abs(aligned.y + aligned.height / 2 - 500)).toBeLessThan(30);
  await page.screenshot({ path: test.info().outputPath('chapter-in-focus.png'), animations: 'disabled' });
  // Pausing the diagram must not change the scroll-driven reading experience.
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  await page.mouse.wheel(0, 230);
  await expect.poll(opacity).toBeLessThan(0.5);
  await expect.poll(center).toBeCloseTo(500, 0);
  await page.screenshot({ path: test.info().outputPath('chapter-leaving.png'), animations: 'disabled' });
  // Every chapter has the same readable focal point, including after jumping.
  for (const [index, pillar] of pillars.entries()) {
    await page.getByRole('button', { name: pillar.label, exact: true }).click();
    await expect(page.locator('.mf-story-chapter .mf-story-copy').nth(index)).toHaveCSS('opacity', '1');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const lastCopy = page.locator('.mf-story-chapter .mf-story-copy').last();
  await page.mouse.wheel(0, 230);
  await expect.poll(() => lastCopy.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.5);
  // Let the scene leave its pinned track. Breathing room belongs below the
  // final canvas, before the next section's border, at either screen size.
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 390, height: 667 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('.mf-benefits').scrollIntoViewIfNeeded();
    const gap = await page.locator('.mf-product').evaluate((el) => {
      const story = el.querySelector('.mf-experience')!.getBoundingClientRect();
      return el.getBoundingClientRect().bottom - story.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(70);
    expect(gap).toBeLessThanOrEqual(130);
    await page.screenshot({
      path: test.info().outputPath(`benefits-spacing-${size.width}.png`),
      animations: 'disabled',
    });
  }
});

test('scrolling away and back replays the scene until the visitor explicitly pauses', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  const surface = page.locator('.mf-site');
  const diagram = page.locator('.mf-diagram');
  await expect(surface).toHaveAttribute('data-hero-visible', 'true');
  await expect(page.getByRole('button', { name: 'Pause animations', exact: true })).toBeVisible();
  expect(
    await page.locator('.mf-hero-art').evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await expect(diagram).toHaveAttribute('data-animated', 'true');
  const orbit = diagram.locator('.mf-orbit');
  const playing = () => orbit.evaluate((el) => el.getAnimations().some((a) => a.playState === 'running'));
  await expect.poll(playing).toBe(true);
  // Scrolling out suspends only unseen work. Coming back starts this chapter
  // again without a page reload or requiring the visitor to press Play.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(diagram).toHaveAttribute('data-animated', 'false');
  await expect(surface).toHaveAttribute('data-motion-override', 'playing');
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await expect.poll(playing).toBe(true);
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  await expect.poll(playing).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await expect(surface).toHaveAttribute('data-motion-override', 'paused');
  await expect.poll(playing).toBe(false);
  await expect(diagram.locator('.mf-agent-shell').first()).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Play animations', exact: true }).click();
  await expect.poll(playing).toBe(true);
});

test('pricing estimates managed and BYOK costs, rejects invalid amounts, and keeps navigation reachable', async ({
  page,
}) => {
  await page.goto('/pricing');
  await page.getByRole('link', { name: 'Estimate your monthly cost' }).click();
  const estimate = page.getByRole('region', { name: 'Monthly cost estimate' });
  await expect(estimate.getByTestId('estimate-total')).toContainText('$68.00');
  await page.getByRole('radio', { name: 'Pro $29/mo', exact: true }).check();
  await expect(estimate.getByTestId('estimate-total')).toContainText('$87.00');
  await page.getByRole('spinbutton', { name: 'Total execution time' }).fill('1');
  await expect(estimate.getByTestId('estimate-total')).toContainText('$39.48');
  await page.getByRole('radio', { name: 'Bring your own key' }).check();
  await expect(estimate.getByTestId('estimate-total')).toContainText('$49.00');
  await expect(estimate.getByTestId('estimate-platform')).toHaveText('$29.00');
  await expect(estimate).toContainText('Paid to your model provider');
  await page.getByRole('spinbutton', { name: 'Estimated model spend' }).fill('');
  await expect(estimate.getByRole('alert')).toBeVisible();
  await expect(estimate.getByTestId('estimate-total')).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Estimated model spend' }).fill('0.10');
  await expect(estimate.getByTestId('estimate-total')).toContainText('$29.10');
  await expect(page.locator('.mp-memory')).toContainText('4 GB memory');
  await expect(page.locator('.mp-memory input')).toHaveCount(0);
  const nav = (await page.locator('.mf-nav').boundingBox())!;
  expect(nav.y).toBe(0);
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(icon).toBe('/brands/macrofold/mark.svg');
  // Match Chromium's localhost-to-IPv4 resolver rule for this public asset check.
  const logoResponse = await page.request.get(
    new URL(icon!, fixtureOrigin.replace('://localhost', '://127.0.0.1')).href,
  );
  expect(logoResponse.ok()).toBe(true);
  expect(await logoResponse.text()).toContain('<svg');
  await page.screenshot({ path: test.info().outputPath('calculator-desktop.png'), animations: 'disabled' });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mp-calculator').scrollIntoViewIfNeeded();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: test.info().outputPath('calculator-mobile.png'), animations: 'disabled' });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Docs', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs$/);
});
