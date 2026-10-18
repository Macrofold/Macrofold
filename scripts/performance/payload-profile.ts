import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { canonical, sha256 } from '../../packages/core/src/crypto';
import { createJsonPreparation } from '../../packages/core/src/prepared-json';
import { validateContext } from '../../packages/core/src/explicit-context';
import { decisionProtocol } from '../../packages/providers/src/decision-protocols';
import { decisionExample } from '../../examples/decisions/contracts';

// Pure local CPU qualification: no credentials, database, network or paid calls.
// Compare the same validation/digest/provider encoding with and without a memo;
// this is not end-to-end latency or a production capacity measurement.
const example = decisionExample('fixture-workspace', 'triage');
const context = {
  ...example.context,
  items: [{ ...example.context.items[0], value: 'hello '.repeat(249_000) }],
};
const accepted = {
  ...context,
  organization_id: 'fixture-tenant',
  workspace_id: 'fixture-workspace',
  application_namespace: 'fixture-workspace',
  admitted_at: '2026-10-17T12:00:00Z',
};
const routes = [
  { provider: 'openrouter', model: 'typesafe/jev-1.13' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  { provider: 'openrouter', model: 'openai/gpt-5.4-mini' },
];
console.log(JSON.stringify({ node: process.version, context_bytes: Buffer.byteLength(canonical(context)) }));
for (const route of routes) {
  const protocol = decisionProtocol(route.provider, route.model);
  const request = {
    ...route,
    definition: example.definition,
    input: example.input,
    context: accepted,
    maxOutputTokens: 256,
    rates: { inputMicroUsdPerMillion: '1000000', outputMicroUsdPerMillion: '5000000' },
  };
  const expected = canonical(protocol.prepare(request));
  const expectedContextDigest = sha256(canonical(accepted));
  function prepare(reuse: boolean) {
    const preparation = reuse ? createJsonPreparation() : undefined;
    try {
      validateContext(example.definition, example.input, context, preparation);
      const contextJSON = preparation?.remember(accepted).json ?? canonical(accepted);
      const contextDigest = sha256(contextJSON);
      const body = protocol.prepare(request, preparation?.stringify);
      const encoded = preparation?.remember(body);
      const json = encoded?.json ?? canonical(body);
      const result = {
        json,
        contextDigest,
        requestDigest: sha256(json),
        bytes: encoded?.bytes ?? Buffer.byteLength(json),
        peakMemoBytes: preparation?.stats().peakBytes ?? 0,
      };
      return result;
    } finally {
      preparation?.dispose();
    }
  }
  // Alternate order to expose warmup/host variance rather than present one
  // favorable ordering as a guaranteed improvement.
  for (const reuse of [false, true, true, false]) {
    for (let warmup = 0; warmup < 10; warmup++) prepare(reuse);
    const samples: number[] = [];
    let peakMemoBytes = 0;
    const cpuStarted = process.cpuUsage();
    for (let index = 0; index < 80; index++) {
      const started = performance.now();
      const result = prepare(reuse);
      samples.push(performance.now() - started);
      assert.equal(result.json, expected, 'Prepared provider bytes changed');
      assert.equal(result.contextDigest, expectedContextDigest, 'Accepted context digest changed');
      peakMemoBytes = Math.max(peakMemoBytes, result.peakMemoBytes);
    }
    const cpu = process.cpuUsage(cpuStarted);
    samples.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        ...route,
        reuse,
        samples: samples.length,
        mean_ms: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
        p50_ms: samples[39],
        p95_ms: samples[75],
        cpu_ms: (cpu.user + cpu.system) / 1000,
        peak_memo_bytes: peakMemoBytes,
        heap_used_bytes: process.memoryUsage().heapUsed,
        rss_bytes: process.memoryUsage().rss,
      }),
    );
  }
}
