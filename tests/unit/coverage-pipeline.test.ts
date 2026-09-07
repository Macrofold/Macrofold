import { describe, it, expect } from 'vitest';
import { convert } from 'ast-v8-to-istanbul';
import { AnyMap, encodedMap } from '@jridgewell/trace-mapping';
import { transform } from 'esbuild';
import { parseAstAsync } from 'vitest/node';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pack } from '../../scripts/coverage/pack';
import libCoverage, { type FileCoverageData } from 'istanbul-lib-coverage';
import {
  sourcePath,
  overlay,
  checkGates,
  sameSources,
  currentSourceManifest,
  mappedSourcePath,
} from '../../scripts/coverage/maps';

describe('coverage evidence is a union of identical source locations', () => {
  it.each([
    '/build/packages/runtime/src/entry.ts',
    'webpack://app/../../packages/runtime/src/entry.ts',
    'file:///home/runner/work/repo/packages/runtime/src/entry.ts',
  ])('normalizes %s', (file) => {
    expect(sourcePath(file, process.cwd())).toBe('packages/runtime/src/entry.ts');
  });
  it.each(['../src/restore.ts', 'file:///opt/src/restore.ts'])(
    'resolves native map source %s before remapping',
    (source) => {
      expect(mappedSourcePath(source, 'file:///opt/platform/restore.mjs', process.cwd(), true)).toBe(
        'packages/runtime/src/restore.ts',
      );
    },
  );
  it.each([
    'node_modules/lib/index.ts',
    'packages/core/src/../secret.ts',
    'sdk/typescript/src/routes.ts',
    'packages/core/src/types.d.ts',
    'https://evil.invalid/not-application.js',
  ])('rejects %s', (file) => {
    expect(sourcePath(file, process.cwd())).toBeUndefined();
  });
  it('merges actual source-mapped V8 ranges without increasing the source denominator', async () => {
    const file = '/build/packages/core/src/fixture.ts';
    const { code, map } = await transform(
      'globalThis.coverageFixture = (n: number) => { if (n > 2) return "high"; return "low"; };',
      { sourcefile: file, sourcemap: 'external', loader: 'ts', target: 'es2022' },
    );
    // A child owns the inspector; this test must not reset Vitest's own V8 counters.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { Session } from 'node:inspector/promises';
      import { runInThisContext } from 'node:vm';
      const session = new Session(); session.connect();
      await session.post('Profiler.enable');
      await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      runInThisContext(process.argv[1], { filename: 'file:///coverage-fixture.js' });
      const values = [globalThis.coverageFixture(3)];
      const first = (await session.post('Profiler.takePreciseCoverage')).result.find(e => e.url === 'file:///coverage-fixture.js');
      values.push(globalThis.coverageFixture(1));
      const second = (await session.post('Profiler.takePreciseCoverage')).result.find(e => e.url === 'file:///coverage-fixture.js');
      await session.post('Profiler.stopPreciseCoverage'); session.disconnect();
      console.log(JSON.stringify({ first, second, values }));
    `,
        code,
      ],
      { env: { ...process.env, NODE_V8_COVERAGE: '' } },
    );
    const { first, second, values } = JSON.parse(stdout);
    expect(values).toEqual(['high', 'low']);
    const sourceMap = encodedMap(
      AnyMap(
        { version: 3, sections: [{ offset: { line: 0, column: 0 }, map: JSON.parse(map) }] },
        'file:///coverage-fixture.js',
      ),
    );
    const a = Object.values(await convert({ code, sourceMap, ast: parseAstAsync(code), coverage: first }))[0];
    const b = Object.values(
      await convert({ code, sourceMap, ast: parseAstAsync(code), coverage: second }),
    )[0];
    const count = libCoverage.createFileCoverage(a).toSummary().branches.total;
    expect(libCoverage.createFileCoverage(a).toSummary().branches.pct).toBeLessThan(100);
    expect(overlay(a, b).matched).toBeGreaterThan(0);
    expect(libCoverage.createFileCoverage(a).toSummary().branches).toMatchObject({ total: count, pct: 100 });
    const once = structuredClone(a);
    overlay(a, b);
    overlay(a, b);
    expect(a).toEqual(once);
  });
  it('retains untouched statements and refuses unmatched compiler branches', () => {
    const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } };
    const a: FileCoverageData = {
      path: '/fixture.ts',
      statementMap: { 0: loc },
      s: { 0: 0 },
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    };
    overlay(a, { ...a, statementMap: { 0: { ...loc, end: { line: 1, column: 11 } } }, s: { 0: 10 } });
    expect(a.s).toEqual({ 0: 0 });
    expect(libCoverage.createFileCoverage(a).toSummary().lines).toMatchObject({ total: 1, covered: 0 });
    // Compilers may map several nodes onto one source location; a later zero must not erase a hit.
    overlay(a, { ...a, statementMap: { 0: loc, 1: loc }, s: { 0: 1, 1: 0 } });
    expect(libCoverage.createFileCoverage(a).toSummary().lines).toMatchObject({ total: 1, covered: 1 });
  });
  it('fails missing critical modules even when the remaining source has 100% coverage', () => {
    expect(checkGates({}, process.cwd())).toContain('Missing gated module: packages/core/src/ledger.ts');
  });
});

it('rejects changed or incomplete build provenance and accepts reordered keys', () => {
  expect(sameSources({ a: 'sha-a', b: 'sha-b' }, { b: 'sha-b', a: 'sha-a' })).toBe(true);
  expect(sameSources({ a: 'sha-a', b: 'sha-b' }, { a: 'sha-a' })).toBe(false);
  expect(sameSources({ a: 'sha-a' }, { a: 'older-build' })).toBe(false);
});

it('includes hidden OAuth discovery routes and untouched application files in provenance', async () => {
  const files = await currentSourceManifest(process.cwd());
  expect(files['apps/web/app/.well-known/oauth-authorization-server/auth/route.ts']).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(files['apps/web/app/auth/.well-known/openid-configuration/route.ts']).toMatch(/^[a-f0-9]{64}$/);
  expect(files['packages/core/src/ledger.ts']).toMatch(/^[a-f0-9]{64}$/);
  expect(files['sdk/typescript/src/routes.ts']).toBeUndefined();
});

it('packs actual image sources once across flushes without depending on host artifacts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'coverage-artifacts-'));
  try {
    const url = 'file:///opt/platform/fixture.mjs';
    const artifact = {
      source: 'const fixture = 1;',
      sourceMap: { version: 3, sources: ['fixture.ts'], mappings: '' },
    };
    await writeFile(path.join(directory, 'runtime-sources.json'), JSON.stringify({ [url]: artifact }));
    const sample = {
      scriptId: '1',
      url,
      functions: [
        { functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 18, count: 1 }] },
      ],
    };
    for (const name of ['coverage-first.json', 'coverage-second.json'])
      await writeFile(path.join(directory, name), JSON.stringify({ result: [sample] }));
    await pack(directory, true);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const packed = JSON.parse(await readFile(path.join(directory, files[0]), 'utf8'));
    expect(packed.result).toHaveLength(1);
    expect(packed.result[0]).toMatchObject({ ...artifact, url });
    expect(packed.result[0].functions[0].ranges[0].count).toBe(2);
    // A resumed cleanup with no raw inputs must preserve the completed portable artifact.
    await pack(directory, true);
    expect(JSON.parse(await readFile(path.join(directory, files[0]), 'utf8'))).toEqual(packed);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
