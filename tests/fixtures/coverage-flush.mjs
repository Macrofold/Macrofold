// Test processes only. Snapshots drain V8's counters; the merger unions source locations.
import { takeCoverage, stopCoverage } from 'node:v8';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
if (process.env.NODE_V8_COVERAGE) {
  // Keep the actual image's artifacts, not a possibly different host rebuild.
  if (existsSync('/opt/platform/entry.mjs')) {
    const artifacts = Object.fromEntries(
      readdirSync('/opt/platform')
        .filter((name) => name.endsWith('.mjs') && existsSync('/opt/platform/' + name + '.map'))
        .map((name) => [
          'file:///opt/platform/' + name,
          {
            source: readFileSync('/opt/platform/' + name, 'utf8'),
            sourceMap: JSON.parse(readFileSync('/opt/platform/' + name + '.map', 'utf8')),
          },
        ]),
    );
    const destination = path.join(process.env.NODE_V8_COVERAGE, 'runtime-sources.json');
    try {
      writeFileSync(destination, JSON.stringify(artifacts), { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  setInterval(takeCoverage, 10000).unref();
  process.once('SIGTERM', () => {
    takeCoverage();
    stopCoverage();
    process.exit(0);
  });
}
