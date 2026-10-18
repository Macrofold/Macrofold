import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';
import { fixturePeerCpus } from './performance/fixture-affinity';

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return String(value);
}

// This profiles the real serving path, not a paid provider. The shared fixture
// wrapper also checks the unpaid local profile before it creates any resources.
const calls = integer('PROFILE_INFERENCE_CALLS', 20, 1, 10000);
const warmups = integer('PROFILE_INFERENCE_WARMUPS', 2, 0, 200);
fixturePeerCpus();
const rate = integer('PROFILE_INFERENCE_RATE', 0, 0, 100);
const contextBytes = integer('PROFILE_INFERENCE_CONTEXT_BYTES', 1_494_000, 0, 1_900_000);
const model = process.env.PROFILE_INFERENCE_MODEL ?? 'jev';
if (!['jev', 'anthropic', 'openrouter-chat'].includes(model))
  throw new Error('PROFILE_INFERENCE_MODEL must be jev, anthropic, or openrouter-chat.');
const observer = process.env.PROFILE_INFERENCE_OBSERVER ?? 'light';
if (!['off', 'light', 'cpu'].includes(observer))
  throw new Error('PROFILE_INFERENCE_OBSERVER must be off, light, or cpu.');
const sampleRate = Number(process.env.PROFILE_INFERENCE_SAMPLE_RATE ?? 1);
if (
  process.env.PROFILE_INFERENCE_SAMPLE_RATE?.trim() === '' ||
  !Number.isFinite(sampleRate) ||
  sampleRate < 0 ||
  sampleRate > 1
)
  throw new Error('PROFILE_INFERENCE_SAMPLE_RATE must be between 0 and 1.');
const parent = path.resolve('.data/inference-profile');
await mkdir(parent, { recursive: true, mode: 0o700 });
const output = process.env.PROFILE_INFERENCE_OUTPUT
  ? path.resolve(process.env.PROFILE_INFERENCE_OUTPUT)
  : await mkdtemp(path.join(parent, 'run-'));
if (process.env.PROFILE_INFERENCE_OUTPUT) await mkdir(output, { mode: 0o700 });
await withFixtureDatabase((env) =>
  command(['exec', 'tsx', 'scripts/performance/inference-profile.ts'], {
    ...env,
    INFERENCE_PROFILE_CHILD: '1',
    OPENROUTER_API_KEY: 'synthetic-inference-profile',
    ANTHROPIC_API_KEY: 'synthetic-inference-profile',
    PROFILE_INFERENCE_MODEL: model,
    PROFILE_INFERENCE_CALLS: calls,
    PROFILE_INFERENCE_WARMUPS: warmups,
    PROFILE_INFERENCE_RATE: rate,
    PROFILE_INFERENCE_CONTEXT_BYTES: contextBytes,
    PROFILE_INFERENCE_OUTPUT: output,
    PROFILE_INFERENCE_OBSERVER: observer,
    PROFILE_INFERENCE_SAMPLE_RATE: String(sampleRate),
    // Ordinary fixtures reset optional observations; this explicit experiment
    // may compare the operator-selected policies instead.
    REQUEST_ANALYTICS_ENABLED: process.env.REQUEST_ANALYTICS_ENABLED ?? 'true',
    API_PRODUCT_EVENTS_ENABLED: process.env.API_PRODUCT_EVENTS_ENABLED ?? 'true',
  }),
);
console.log(`Private inference profile: ${output}`);
