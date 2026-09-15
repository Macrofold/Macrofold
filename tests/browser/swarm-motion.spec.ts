import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

const studies = [
  /^01 Convergence/,
  /^02 Tidal field/,
  /^03 Deep orbit/,
  /^04 Filament flow/,
  /^05 Living volume/,
];

async function seekWithKeyboard(timeline: Locator, seconds: number) {
  await timeline.press('Home');
  const largeSteps = Math.floor(seconds / 1.5);
  const fineSteps = Math.round((seconds - largeSteps * 1.5) * 100);
  for (let index = 0; index < largeSteps; index++) await timeline.press('PageUp');
  for (let index = 0; index < fineSteps; index++) await timeline.press('ArrowRight');
  await expect(timeline).toHaveAttribute('aria-valuetext', `${seconds.toFixed(1)} of 15 seconds`);
}

async function captureField(page: Page, canvas: Locator, name: string) {
  // The next two display frames let the seek effect reach the GPU before capture.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const png = await canvas.screenshot({
    path: test.info().outputPath(`${name}.png`),
    style: '.swarm-stage > :not(.swarm-canvas) { visibility: hidden !important; }',
  });
  return page.evaluate(
    async (dataUrl) => {
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not decode the captured animation frame.'));
      });
      image.src = dataUrl;
      await loaded;
      const sample = document.createElement('canvas');
      sample.width = 160;
      sample.height = 90;
      const context = sample.getContext('2d');
      if (!context) throw new Error('Could not inspect the captured animation frame.');
      // Fractional canvas bounds can include the surrounding one-pixel stage
      // border in the screenshot. Sample the field interior before downscaling.
      const edge = 2;
      context.drawImage(
        image,
        edge,
        edge,
        image.width - edge * 2,
        image.height - edge * 2,
        0,
        0,
        sample.width,
        sample.height,
      );
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      const luminance: number[] = [];
      for (let y = 0; y < sample.height; y++) {
        for (let x = sample.width / 2; x < sample.width; x++) {
          const index = (y * sample.width + x) * 4;
          luminance.push(0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]);
        }
      }
      return {
        mean: luminance.reduce((sum, value) => sum + value, 0) / luminance.length,
        luminance,
      };
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
}

test('Swarm studies support selection, playback, scrubbing and comparison', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/concepts/swarm/motion');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Swarm, in motion.');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const preview = page.getByRole('figure', { name: 'Swarm animation preview' });
  await expect(preview.locator('.swarm-canvas')).toHaveAttribute('data-renderer', 'ready');

  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeEnabled();
  const timeline = page.getByRole('slider', { name: 'Animation time' });
  await timeline.press('Home');
  await timeline.press('PageUp');
  await expect(timeline).toHaveValue('1.5');
  await expect(timeline).toHaveAttribute('aria-valuetext', /1\.5/);
  // Observe several display frames: a paused timeline must remain at the selected time.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const observe = () => {
          frames++;
          if (frames === 12) resolve();
          else requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      }),
  );
  await expect(timeline).toHaveValue('1.5');

  for (const study of studies) {
    const tab = page.getByRole('tab', { name: study, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(preview.locator('.swarm-canvas')).toHaveAttribute('data-renderer', 'ready');
  }
  await page.getByRole('tab', { name: studies[0], exact: true }).focus();
  await page.getByRole('tab', { name: studies[0], exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: studies[1], exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const original = page.getByRole('button', { name: 'Show original', exact: true });
  await original.click();
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.locator('.swarm-canvas')).toHaveAttribute('data-original', 'true');
  await original.click();
  await expect(preview.locator('.swarm-canvas')).toHaveAttribute('data-original', 'false');
  const copy = page.getByRole('button', { name: 'Show hero copy', exact: true });
  await copy.click();
  await expect(copy).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toContainText(/A new kind of software\s*starts with you\./);
  await copy.click();
  await expect(copy).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Fullscreen preview', exact: true }).click();
  await expect.poll(() => preview.evaluate((element) => document.fullscreenElement === element)).toBe(true);
  await page.getByRole('button', { name: 'Fullscreen preview', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  const stoppedTime = Number(await timeline.inputValue());
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(stoppedTime);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  expect(errors).toEqual([]);
});

test('Swarm respects reduced motion and remains accessible on mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/concepts/swarm/motion');
  await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeEnabled();
  const timeline = page.getByRole('slider', { name: 'Animation time' });
  await expect(timeline).toHaveValue('0');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await page.getByRole('tab', { name: studies[4], exact: true }).click();
  await expect(page.getByRole('tab', { name: studies[4], exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(timeline).toHaveValue('0');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.failureSummary),
    })),
  ).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('swarm-motion-mobile.png'), fullPage: true });
});

test('Swarm builds its volume, keeps morphing, fades, and holds a black loop boundary', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/concepts/swarm/motion');
  const field = page.getByRole('figure', { name: 'Swarm animation preview' }).locator('.swarm-canvas');
  await expect(field).toHaveAttribute('data-renderer', 'ready');
  await expect(field).toHaveAttribute('data-original', 'false');
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  const timeline = page.getByRole('slider', { name: 'Animation time' });
  const canvas = field.locator('canvas');
  await expect(canvas).toHaveCSS('opacity', '1');

  await seekWithKeyboard(timeline, 1.5);
  const growing = await captureField(page, canvas, 'swarm-growing-1.5s');
  await seekWithKeyboard(timeline, 6);
  const formed = await captureField(page, canvas, 'swarm-formed-6s');
  await seekWithKeyboard(timeline, 9);
  const morphing = await captureField(page, canvas, 'swarm-morphing-9s');
  await seekWithKeyboard(timeline, 12);
  const fading = await captureField(page, canvas, 'swarm-fading-12s');
  await seekWithKeyboard(timeline, 14);
  const empty = await captureField(page, canvas, 'swarm-empty-14s');

  expect(formed.mean).toBeGreaterThan(1);
  expect(formed.mean).toBeGreaterThan(growing.mean * 1.75 + 0.5);
  const morphDifference =
    formed.luminance.reduce((sum, value, index) => sum + Math.abs(value - morphing.luminance[index]), 0) /
    formed.luminance.length;
  expect(morphDifference).toBeGreaterThan(0.5);
  expect(fading.mean).toBeLessThan(formed.mean * 0.5);
  expect(empty.mean).toBeLessThan(0.05);
  await test.info().attach('Animation phase measurements', {
    body: JSON.stringify(
      {
        growing: growing.mean,
        formed: formed.mean,
        morphing: morphing.mean,
        fading: fading.mean,
        empty: empty.mean,
        morphDifference,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('Swarm retains the original artwork when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, options?: unknown) {
        if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
        return getContext.call(this, kind, options);
      },
    });
  });
  await page.goto('/concepts/swarm/motion');
  const preview = page.getByRole('figure', { name: 'Swarm animation preview' });
  await expect(preview.locator('.swarm-canvas')).toHaveAttribute('data-renderer', 'fallback');
  await expect(preview.getByRole('status')).toContainText('Still preview');
  const poster = preview.getByRole('img');
  await expect(poster).toBeVisible();
  await expect
    .poll(() => poster.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test('Swarm artwork and study descriptions remain available without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(fixtureOrigin + '/concepts/swarm/motion');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Swarm, in motion.');
    const preview = page.getByRole('figure', { name: 'Swarm animation preview' });
    const poster = preview.getByRole('img');
    await expect(poster).toBeVisible();
    await expect
      .poll(() => poster.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(
      page.getByText('An ordered lattice funnels in from the left', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: studies[0], exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
