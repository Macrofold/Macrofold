import { test, expect, fixtureOrigin } from '../fixtures/browser';

// Run against the marketing media preview: stage assets, then set MARKETING_MEDIA_BASE_URL.
test.skip(
  !process.env.MARKETING_MEDIA_BASE_URL,
  'Requires the explicitly staged media preview; ordinary app fixtures leave the hero background clear.',
);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: Object.assign(new EventTarget(), { saveData: false, effectiveType: '4g', downlink: 50 }),
    });
  });
});

test('signed-out homepage includes the working playlist', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'playing');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Run Agent Harnesses in the Cloud');
});

test('hero advances through all studies at 1.3x with only one playing decoder', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requested = new Set<string>();
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) requested.add(request.url());
  });
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'playing');
  const playing = () =>
    page.locator('.mf-swarm video').evaluateAll((elements) =>
      elements
        .filter((el) => !(el as HTMLVideoElement).paused)
        .map((el) => ({
          src: (el as HTMLVideoElement).currentSrc,
          rate: (el as HTMLVideoElement).playbackRate,
        })),
    );
  await expect.poll(playing).toEqual([{ src: expect.stringContaining('druse-1440.h264.mp4'), rate: 1.3 }]);
  await expect.poll(() => requested.size).toBe(2);
  for (const name of [
    'thalassa',
    'tetrarch',
    'viscera',
    'aperiodic',
    'plexus',
    'maelstrom',
    'hypercell',
    'chitin',
    'coronet',
    'alveoli',
    'druse',
  ]) {
    await page.locator('.mf-swarm video').evaluateAll((elements) => {
      const current = elements.find((el) => !(el as HTMLVideoElement).paused) as HTMLVideoElement | undefined;
      if (current) current.currentTime = current.duration - 0.15;
    });
    await expect
      .poll(playing)
      .toEqual([{ src: expect.stringContaining(`${name}-1440.h264.mp4`), rate: 1.3 }]);
  }
  expect(errors).toEqual([]);
});

test('global Pause persists across scrolling and Play resumes the current video', async ({ page }) => {
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  const allPaused = () =>
    page
      .locator('.mf-swarm video')
      .evaluateAll((elements) => elements.every((el) => (el as HTMLVideoElement).paused));
  await expect.poll(allPaused).toBe(true);
  await page.locator('#code').scrollIntoViewIfNeeded();
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
  expect(await allPaused()).toBe(true);
  await page.getByRole('button', { name: 'Play animations', exact: true }).click();
  await expect.poll(allPaused).toBe(false);
  await page.locator('.mf-footer').scrollIntoViewIfNeeded();
  await expect.poll(allPaused).toBe(true);
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
  await expect.poll(allPaused).toBe(false);
});

test('mobile video autoplays even with reduced motion enabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requested: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) requested.push(request.url());
  });
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'playing');
  expect(requested[0]).toContain('druse-960.h264.mp4');
  await expect(page.locator('.mf-swarm button')).toHaveCount(0);
});

test('failed desktop media falls back to mobile and an unavailable collection leaves the background clear', async ({
  page,
}) => {
  await page.route('**/*-1440.h264.mp4', (route) => route.fulfill({ status: 404 }));
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'playing');
  await expect
    .poll(() =>
      page
        .locator('.mf-swarm video')
        .evaluateAll((nodes) =>
          nodes.some(
            (el) =>
              !(el as HTMLVideoElement).paused &&
              (el as HTMLVideoElement).currentSrc.includes('-960.h264.mp4'),
          ),
        ),
    )
    .toBe(true);
  await page.route('**/*.mp4', (route) => route.fulfill({ status: 404 }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'unavailable');
  await expect(page.locator('.mf-swarm button')).toHaveCount(0);
  await expect(page.locator('.mf-hero-art img')).toHaveCount(0);
  await expect(page.locator('.mf-swarm video').first()).toHaveCSS('opacity', '0');
  await expect(page.locator('.mf-swarm video').last()).toHaveCSS('opacity', '0');
});

test('browser autoplay refusal leaves the background clear without a play prompt', async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let blocked = true;
    HTMLMediaElement.prototype.play = function () {
      if (blocked) {
        blocked = false;
        return Promise.reject(new DOMException('Test autoplay refusal', 'NotAllowedError'));
      }
      return play.call(this);
    };
  });
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'blocked');
  await expect(page.locator('.mf-hero-art img')).toHaveCount(0);
  await expect(page.locator('.mf-swarm video').first()).toHaveCSS('opacity', '0');
  await expect(page.locator('.mf-swarm video').last()).toHaveCSS('opacity', '0');
  await expect(page.locator('.mf-swarm button')).toHaveCount(0);
});

test('data saving autoplays the smaller video without consent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: Object.assign(new EventTarget(), { saveData: true, effectiveType: '4g', downlink: 50 }),
    });
  });
  const requested: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) requested.push(request.url());
  });
  await page.goto('/site', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'playing');
  expect(requested[0]).toContain('-960.h264.mp4');
  await expect(page.locator('.mf-swarm button')).toHaveCount(0);
});

test('without JavaScript the hero stays clear and homepage links remain usable', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('.mp4')) requested.push(request.url());
    });
    await page.goto(`${fixtureOrigin}/site`);
    await expect(page.locator('.mf-hero-art img')).toHaveCount(0);
    await expect(page.locator('.mf-swarm video').first()).toHaveCSS('opacity', '0');
    await expect(page.getByRole('link', { name: 'Start building', exact: true }).first()).toBeVisible();
    expect(requested).toEqual([]);
  } finally {
    await context.close();
  }
});

test('slow video startup never renders or requests the archived hero image', async ({ page }) => {
  const images: string[] = [];
  page.on('request', (request) => {
    if (decodeURIComponent(request.url()).includes('/concepts/swarm.png')) images.push(request.url());
  });
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*.mp4', async (route) => {
    await ready;
    await route.continue();
  });
  try {
    const requested = page.waitForRequest('**/*.mp4');
    await page.goto('/site', { waitUntil: 'domcontentloaded' });
    await requested;
    await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'idle');
    await expect(page.locator('.mf-hero-art img')).toHaveCount(0);
    await expect(page.locator('.mf-swarm video').first()).toHaveCSS('opacity', '0');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(images).toEqual([]);
    release();
    await expect(page.locator('.mf-swarm')).toHaveAttribute('data-status', 'playing');
    expect(images).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
