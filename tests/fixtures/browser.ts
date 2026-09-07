import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export { expect };
export const fixtureOrigin = process.env.APP_ORIGIN || 'http://localhost:3210';

/** Instrument all pages, including explicit second tabs, before their first navigation.
 * Capture before close and before fixture teardown; never call an external source-map URL. */
export const test = base.extend<{ coverage: void }>({
  coverage: [
    async ({ browser, context }, use) => {
      if (!process.env.BROWSER_COVERAGE_DIR) return use();
      const directory = process.env.BROWSER_COVERAGE_DIR;
      await mkdir(directory, { recursive: true });
      const collectors = new Map<Page, () => Promise<void>>();
      const restorers: (() => void)[] = [];
      async function instrument(page: Page) {
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        let stopped = false;
        const close = page.close.bind(page);
        const capture = async () => {
          if (stopped) return;
          stopped = true;
          const entries = await page.coverage.stopJSCoverage();
          const result = [];
          for (const entry of entries) {
            if (!entry.source || !entry.url.startsWith(fixtureOrigin + '/')) continue;
            const link = entry.source.match(/\/\/[#@] sourceMappingURL=([^\s]+)/)?.[1];
            if (!link) continue;
            const url = new URL(link, entry.url);
            if (
              url.origin !== new URL(fixtureOrigin).origin ||
              !url.pathname.startsWith('/_next/static/') ||
              decodeURIComponent(url.pathname).split('/').includes('..')
            )
              throw new Error('Non-fixture coverage source map');
            const localMaps = process.env.BROWSER_SOURCE_MAP_ROOT;
            const sourceMap = localMaps
              ? JSON.parse(
                  await readFile(path.join(localMaps, url.pathname.replace('/_next/static/', '')), 'utf8'),
                )
              : await page.request.get(url.href, { timeout: 10000 }).then(async (response) => {
                  if (!response.ok()) throw new Error(`Missing browser source map: ${url.pathname}`);
                  return response.json();
                });
            if (
              sourceMap.sources?.some(
                (source: string | null) =>
                  source &&
                  /(?:packages\/[^/]+\/src|sdk\/typescript\/src|apps\/web\/(?:app|components|lib|workflows))\//.test(
                    source,
                  ),
              )
            )
              result.push({ ...entry, sourceMap });
          }
          await writeFile(path.join(directory, randomUUID() + '.json'), JSON.stringify({ result }));
        };
        collectors.set(page, capture);
        page.close = async (options) => {
          try {
            await capture();
          } finally {
            await close(options);
          }
        };
      }
      function instrumentContext(value: BrowserContext) {
        const newPage = value.newPage.bind(value),
          close = value.close.bind(value);
        value.newPage = async () => {
          const page = await newPage();
          await instrument(page);
          return page;
        };
        value.close = async (options) => {
          try {
            for (const page of value.pages()) await collectors.get(page)?.();
          } finally {
            await close(options);
          }
        };
        restorers.push(() => {
          value.newPage = newPage;
          value.close = close;
        });
      }
      instrumentContext(context);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const value = await newContext(options);
        // Chromium disables the debugger when scripts are disabled; there is no client execution to collect.
        if (options?.javaScriptEnabled !== false) instrumentContext(value);
        return value;
      };
      try {
        await use();
      } finally {
        try {
          const captures = await Promise.allSettled([...collectors.values()].map((capture) => capture()));
          const failed = captures.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
          if (failed.length)
            throw new AggregateError(
              failed.map((result) => result.reason),
              'Browser coverage capture failed',
            );
        } finally {
          browser.newContext = newContext;
          for (const restore of restorers) restore();
        }
      }
    },
    { auto: true },
  ],
});
