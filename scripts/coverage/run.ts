import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

/** Collect privately, then replace the saved report (including failed-run diagnostics).
 * Publication is serialized; collectors never write into or delete another active run.
 */
export async function withCoverageRun(destination: string, collect: (directory: string) => Promise<void>) {
  destination = path.resolve(destination);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(destination), '.coverage-run-'));
  const directory = path.join(temporary, 'results');
  await mkdir(directory);
  let status = 'failed';
  try {
    await collect(directory);
    status = 'passed';
  } finally {
    await writeFile(
      path.join(directory, 'run.json'),
      JSON.stringify({ status, completed_at: new Date().toISOString() }),
    );
    // Lock only publication, not test execution. An interrupted publisher leaves the lock
    // for explicit inspection rather than risking deletion of another process's results.
    const lock = destination + '.publish-lock';
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') || attempt >= 300)
          throw error;
        await setTimeout(100);
      }
    }
    try {
      const previous = path.join(temporary, 'previous');
      try {
        await rename(destination, previous);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      try {
        await rename(directory, destination);
      } catch (error) {
        await rename(previous, destination).catch((restoreError: unknown) => {
          if (!(restoreError instanceof Error && 'code' in restoreError && restoreError.code === 'ENOENT'))
            throw new AggregateError([error, restoreError], 'Coverage publication and rollback failed');
        });
        throw error;
      }
    } finally {
      await rm(lock, { recursive: true });
    }
    await rm(temporary, { recursive: true, force: true });
    console.log(`Coverage results (${status}): ${destination}`);
  }
}

/** Keep builds inside the repository for package resolution, but outside the preview's .next. */
export async function withCoverageBuild(webRoot: string, use: (directory: string) => Promise<void>) {
  const parent = path.join(webRoot, '.coverage.builds');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'coverage-build-'));
  const nextEnv = path.join(webRoot, 'next-env.d.ts');
  const previousEnv = await readFile(nextEnv, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  try {
    await use(directory);
  } finally {
    try {
      // Next rewrites this shared generated file even with a custom tsconfig. Restore
      // only our own reference; a concurrent preview/build's rewrite takes precedence.
      const current = await readFile(nextEnv, 'utf8').catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
        throw error;
      });
      if (current.includes(path.relative(webRoot, directory) + '/dist/types/')) {
        if (previousEnv === undefined) await rm(nextEnv, { force: true });
        else await writeFile(nextEnv, previousEnv);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
