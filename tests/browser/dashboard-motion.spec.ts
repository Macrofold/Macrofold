import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import type { Schema } from '../../apps/web/lib/client';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

/** Capture the transition created by an actual input event, before a short fade can
 * finish between Playwright calls. Seeking that browser-owned transition makes
 * intermediate painted values deterministic without replacing the application's CSS. */
async function expectFade(target: Locator, properties: string[], interact: () => Promise<unknown>) {
  const capture = await target.evaluateHandle((element, wanted) => {
    const transitions = new Map<string, CSSTransition>();
    const read = () =>
      Object.fromEntries(
        wanted.map((property) => [property, getComputedStyle(element).getPropertyValue(property)]),
      );
    const before = read();
    const listener = (event: Event) => {
      if (
        !(event instanceof TransitionEvent) ||
        event.target !== element ||
        !wanted.includes(event.propertyName)
      )
        return;
      const transition = element
        .getAnimations()
        .find(
          (animation): animation is CSSTransition =>
            animation instanceof CSSTransition && animation.transitionProperty === event.propertyName,
        );
      if (transition && !transitions.has(event.propertyName)) {
        transition.pause();
        transitions.set(event.propertyName, transition);
      }
    };
    element.addEventListener('transitionrun', listener);
    return {
      before,
      transitions,
      read,
      close: () => {
        element.removeEventListener('transitionrun', listener);
        for (const transition of transitions.values()) transition.finish();
      },
    };
  }, properties);
  try {
    await interact();
    await expect
      .poll(() => capture.evaluate((state) => [...state.transitions.keys()].sort()), {
        message: `Actual ${properties.join(', ')} transitions should start after the interaction`,
        timeout: 3000,
      })
      .toEqual([...properties].sort());
    const result = await capture.evaluate((state) => {
      const durations = [...state.transitions.values()].map((transition) => {
        const timing = transition.effect?.getComputedTiming();
        if (!timing || typeof timing.duration !== 'number')
          throw new Error('Expected a finite CSS transition');
        return timing.duration;
      });
      const frames = [0, 0.35, 1].map((fraction) => {
        for (const transition of state.transitions.values()) {
          const timing = transition.effect?.getComputedTiming();
          if (!timing || typeof timing.duration !== 'number') throw new Error('Expected transition timing');
          transition.currentTime = (timing.delay ?? 0) + timing.duration * fraction;
        }
        return state.read();
      });
      state.close();
      return { before: state.before, frames, after: state.read(), durations };
    });
    for (const property of properties) {
      expect(result.frames[0][property], `${property} must have distinct endpoints`).not.toBe(
        result.frames[2][property],
      );
      expect(result.frames[1][property], `${property} must leave its initial value gradually`).not.toBe(
        result.frames[0][property],
      );
      expect(result.frames[1][property], `${property} must not jump directly to its final value`).not.toBe(
        result.frames[2][property],
      );
    }
    for (const duration of result.durations) {
      expect(duration, 'Feedback should last long enough to fade visibly').toBeGreaterThanOrEqual(60);
      expect(duration, 'Ordinary feedback should remain brief').toBeLessThanOrEqual(350);
    }
    return result;
  } finally {
    await capture.evaluate((state) => state.close());
    await capture.dispose();
  }
}

async function settle(target: Locator) {
  await target.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    );
  });
}

async function leaveHover(page: Page) {
  await page.mouse.move(0, 0);
}

for (const theme of ['light', 'dark'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`${theme} ${reducedMotion}: fields and hover feedback interpolate`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion });
      await page.goto('/login');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const projectName = `Motion project ${randomUUID()}`;
      const created = await page.request.post('/v1/projects', {
        headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
        data: { name: projectName, persistence: 'persistent' },
      });
      expect(created.ok()).toBe(true);
      const project: Schema['Project'] = await created.json();
      const keyName = `Motion table ${randomUUID()}`;
      const createdKey = await page.request.post('/v1/api-keys', {
        headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
        data: { name: keyName, scopes: ['projects:read'], project_id: project.id },
      });
      expect(createdKey.ok()).toBe(true);
      const key: Schema['NewApiKey'] = await createdKey.json();

      try {
        await test.step(`${reducedMotion}: hover surfaces and nested label`, async () => {
          await page.emulateMedia({ reducedMotion });
          await page.goto('/');
          const setup = page
            .getByRole('region', { name: 'Getting started' })
            .getByRole('link', { name: /Create a project/ });
          await expect(setup).toBeVisible();
          await leaveHover(page);
          const setupLabel = setup.getByText('Create a project', { exact: true });
          await expectFade(setupLabel, ['color'], () => setup.hover());
          await expectFade(setupLabel, ['color'], () => leaveHover(page));

          const projectsNav = page
            .getByRole('navigation', { name: 'Main navigation' })
            .getByRole('link', { name: 'Projects', exact: true });
          await expectFade(projectsNav, ['background-color'], () => projectsNav.hover());
          if (
            reducedMotion === 'reduce' &&
            (await page.locator('html').getAttribute('data-dashboard-motion')) !== 'playing'
          ) {
            const icon = projectsNav.locator('svg');
            expect(await icon.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
            await expect(icon).toHaveCSS('transform', 'none');
          }
          await expectFade(projectsNav, ['background-color'], () => leaveHover(page));
          await projectsNav.click();
          const list = page.getByRole('region', { name: 'Project list', exact: true });
          await page.getByRole('button', { name: 'List view', exact: true }).click();
          await expect(list).toBeVisible();
          const search = page.getByRole('textbox', { name: 'Search projects', exact: true });
          await search.fill(projectName);
          const projectLink = page.getByRole('main').getByRole('link').filter({ hasText: projectName });
          await expect(projectLink).toBeVisible();
          await leaveHover(page);
          await expectFade(projectLink, ['background-color'], () => projectLink.hover());
          await expectFade(projectLink, ['background-color'], () => leaveHover(page));

          const create = page.getByRole('button', { name: 'New project', exact: true });
          await expectFade(create, ['background-color'], () => create.hover());
          await expectFade(create, ['background-color'], () => leaveHover(page));

          await page.getByRole('button', { name: 'Grid view', exact: true }).click();
          await expect(list).toHaveCount(0);
          await leaveHover(page);
          await expectFade(projectLink, ['border-top-color'], () => projectLink.hover());
          await expectFade(projectLink, ['border-top-color'], () => leaveHover(page));

          const status = page.getByRole('combobox', { name: 'Project status', exact: true });
          await status.click();
          const menu = page.getByRole('listbox');
          await expect(menu).toBeVisible();
          await settle(menu);
          const option = page.getByRole('option', { name: 'Archived & pending deletion', exact: true });
          await expectFade(option, ['background-color', 'color'], () => option.hover());
          await expect(option).toBeFocused();
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
          await expect(status).toBeFocused();
        });

        await test.step(`${reducedMotion}: keyboard focus fades in and out without doubled indicators`, async () => {
          const search = page.getByRole('textbox', { name: 'Search projects', exact: true });
          const surface = page.locator('.input-surface').filter({ has: search });
          const status = page.getByRole('combobox', { name: 'Project status', exact: true });
          await expect(status).toBeFocused();
          await expectFade(surface, ['border-top-color', 'box-shadow'], () => status.press('Shift+Tab'));
          await expect(search).toBeFocused();
          await expect(search).toHaveCSS('outline-style', 'none');
          await expect(search).toHaveCSS('box-shadow', 'none');
          await expect(surface).toHaveCSS('outline-style', 'none');
          await expectFade(surface, ['border-top-color', 'box-shadow'], () => search.press('Tab'));
          await expect(status).toBeFocused();

          await page.getByRole('button', { name: 'New project', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Create a project', exact: true });
          const name = dialog.getByRole('textbox', { name: 'Project name', exact: true });
          const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
          await expect(name).toBeFocused();
          await settle(name);
          await name.press('Tab');
          await expect(cancel).toBeFocused();
          await settle(name);
          const focus = await expectFade(name, ['border-top-color', 'box-shadow'], () =>
            cancel.press('Shift+Tab'),
          );
          await expect(name).toBeFocused();
          await expect(name).toHaveCSS('outline-style', 'none');
          await expect(name).toHaveCSS('border-top-width', '1px');
          const appearance = await name.evaluate((element) => {
            const style = getComputedStyle(element);
            const context = document.createElement('canvas').getContext('2d');
            if (!context) throw new Error('Canvas color conversion is unavailable');
            const rgba = (color: string) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              return [...context.getImageData(0, 0, 1, 1).data];
            };
            const shadowColor = style.boxShadow.match(/^(?:rgba?\([^)]*\)|color\([^)]*\))/)?.[0];
            if (!shadowColor) throw new Error(`Expected a visible focus halo: ${style.boxShadow}`);
            const border = rgba(style.borderTopColor).slice(0, 3);
            return { chroma: Math.max(...border) - Math.min(...border), alpha: rgba(shadowColor)[3] / 255 };
          });
          expect(appearance.chroma, 'Focused border should remain muted').toBeLessThanOrEqual(80);
          expect(appearance.alpha, 'Halo should remain visible').toBeGreaterThan(0);
          expect(appearance.alpha, 'Halo should be very faint').toBeLessThanOrEqual(0.08);

          const blur = await expectFade(name, ['border-top-color', 'box-shadow'], () => name.press('Tab'));
          await expect(cancel).toBeFocused();
          expect(blur.after['border-top-color']).toBe(focus.before['border-top-color']);
          expect(blur.after['box-shadow']).toBe(focus.before['box-shadow']);
          await expect(cancel).not.toHaveCSS('outline-style', 'none');
          await cancel.press('Enter');
          await expect(dialog).toHaveCount(0);
        });

        await test.step(`${reducedMotion}: actual table row fades on hover`, async () => {
          await page.goto('/api-keys');
          const row = page.getByRole('row').filter({ hasText: keyName });
          await expect(row).toBeVisible();
          await leaveHover(page);
          await expectFade(row, ['background-color'], () => row.hover());
          await expectFade(row, ['background-color'], () => leaveHover(page));
        });
      } finally {
        const revoked = await page.request.delete(`/v1/api-keys/${key.id}`, {
          headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
        });
        expect(revoked.ok()).toBe(true);
      }
    });
  }
}

test('forced colors keeps a system outline on standalone and composite fields', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.goto('/projects');
  const search = page.getByRole('textbox', { name: 'Search projects', exact: true });
  await expect(search).toBeVisible();
  const status = page.getByRole('combobox', { name: 'Project status', exact: true });
  await status.focus();
  await status.press('Shift+Tab');
  await expect(search).toBeFocused();
  const surface = page.locator('.input-surface').filter({ has: search });
  // Resolve the browser's own system palette instead of assuming a particular OS color.
  const highlight = await page.evaluate(() => {
    const reference = document.createElement('span');
    reference.style.outline = '2px solid Highlight';
    document.body.append(reference);
    const color = getComputedStyle(reference).outlineColor;
    reference.remove();
    return color;
  });
  await expect(surface).toHaveCSS('outline-style', 'solid');
  await expect(surface).toHaveCSS('outline-width', '2px');
  await expect(surface).toHaveCSS('outline-color', highlight);
  await expect(search).toHaveCSS('outline-style', 'none');
  await expect(search).toHaveCSS('box-shadow', 'none');

  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Project name', exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveCSS('outline-style', 'solid');
  await expect(name).toHaveCSS('outline-width', '2px');
  await expect(name).toHaveCSS('outline-color', highlight);
  await name.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('playing motion visibly rotates the composer border and shines loading text from left to right', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const composer = page.locator('.welcome-composer');
  const rotation = await composer.evaluate((element) => {
    const animation = element
      .getAnimations()
      .find((item) => item instanceof CSSAnimation && item.animationName === 'welcome-border-drift');
    if (!animation) throw new Error('Composer animation is absent');
    animation.pause();
    const timing = animation.effect!.getTiming();
    const duration = Number(timing.duration);
    const angles = [0, 0.5].map((position) => {
      animation.currentTime = duration * position;
      return parseFloat(getComputedStyle(element).getPropertyValue('--welcome-border-angle'));
    });
    animation.play();
    return { duration, angles };
  });
  expect(rotation.duration).toBeGreaterThanOrEqual(20000);
  expect(rotation.angles[1] - rotation.angles[0]).toBeCloseTo(180);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/projects?*', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Projects', exact: true })
      .click();
    const loading = page.getByRole('status').filter({ hasText: /^Loading…$/ });
    await expect(loading).toBeVisible();
    await expect(loading.locator('svg')).toHaveCount(0);
    const positions = await loading.locator('.waiting-text').evaluate((element) => {
      const animation = element.getAnimations()[0];
      if (!animation) throw new Error('Loading sheen is absent');
      animation.pause();
      const duration = Number(animation.effect!.getTiming().duration);
      return [0.1, 0.6].map((part) => {
        animation.currentTime = duration * part;
        return parseFloat(getComputedStyle(element).backgroundPositionX);
      });
    });
    // For an oversized background, decreasing its position moves the light band rightward.
    expect(positions[0]).toBeGreaterThan(positions[1]);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  const status = page.getByRole('combobox', { name: 'Project status' });
  const search = page.getByRole('textbox', { name: 'Search projects' });
  const a = (await search.boundingBox())!,
    b = (await status.boundingBox())!;
  expect(b.x - a.x - a.width).toBeLessThan(50);
  const heading = (await page.getByRole('heading', { name: 'Projects', exact: true }).boundingBox())!;
  await status.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  // Install the observer before clicking; an unawaited locator evaluation can
  // resolve its element only after the very short exit has already started.
  const closing = await page.getByRole('listbox').evaluateHandle((element) => ({
    fill: new Promise<string>((resolve) => {
      const observer = new MutationObserver(() => {
        if (element.getAttribute('data-state') !== 'closed') return;
        observer.disconnect();
        resolve(getComputedStyle(element).animationFillMode);
      });
      observer.observe(element, { attributes: true, attributeFilter: ['data-state'] });
    }),
  }));
  // Radix hides the background from the accessibility tree while its listbox is open.
  await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
  expect(await closing.evaluate((state) => state.fill)).toBe('both');
  await closing.dispose();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});
