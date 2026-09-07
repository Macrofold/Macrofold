import { readFile } from 'node:fs/promises';
import { checkGates } from './maps';
import { thresholds, combinedThresholds } from './policy';
const data = JSON.parse(await readFile(process.argv[2] || 'coverage/domain/coverage-final.json', 'utf8'));
const failures = checkGates(
  data,
  process.cwd(),
  process.argv.includes('--combined') ? combinedThresholds : thresholds,
);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Global and critical-module coverage gates passed.');
