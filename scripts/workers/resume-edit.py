from pathlib import Path
import json, subprocess
expected = {
 'packages/core/src/workers.ts':'806dee17da61569cd70760f93cd06e2968021adb',
 'packages/core/src/worker-types.ts':'0398069f26cec64483cca95159e9050c4af167c8',
 'packages/core/src/worker-policy.ts':'cd7986e2aa726e6d9944ea6e533432abc7b4bd83',
 'docs/api/openapi.json':'77c3a37fc20ccc1a2d1f9146188fda76a73461e0',
 'packages/cli/src/workers.ts':'625b9d2e3965730a0f8417a41fdfa8d9f7afe71b',
 'packages/cli/src/index.ts':'5045ca38bca780c67eb4804a56e1c98c6754b9b2',
 'docs/features/execution/workers.md':'5dd93b6e6ee13f2bba7b1f92cdbe3c69b0ab2e0a',
 'docs/maintainers/TODO.md':'fec1ff667b22df66e44919dcea2a33a9d3704ef4',
}
for name,sha in expected.items():
 if subprocess.check_output(['git','hash-object',name],text=True).strip()!=sha: raise RuntimeError(f'Concurrent edit: {name}')
p=Path('packages/core/src/workers.ts');s=p.read_text()
start=s.index('  const preferred = catalog.find(');end=s.index('  const limits = ',start)
s=s[:start]+'''  const candidates = catalog.filter(item => item.compute === (input.compute ?? 'sandbox') &&
    item.dedicated === (input.dedicated ?? false) && (!(input.isolate_runs ?? true) || item.isolate_runs));
  assert(candidates.length, 503, 'compute_unavailable', 'The requested economic and isolation offering is not enabled. Inspect worker-offerings.');
  const preferred = candidates.find(item => (!input.region || input.region === item.region) &&
    (!input.runtime || input.runtime === item.runtime) && (!input.size || input.size === item.size));
  assert(preferred, 400, 'worker_configuration_unavailable', 'No enabled offering matches this size, runtime, region and isolation combination.');
'''+s[end:]
start=s.index('  const lowest = offerings.reduce(');end=s.index('type WorkerObservation',start)
s=s[:start]+'''  validateBaseline(settings, offerings);
  return { settings, offerings };
}
function validateBaseline(settings: WorkerSettings, offerings: readonly HostOffering[]) {
  const lowest = offerings.reduce<bigint | null>((value, item) => {
    const rate = workerHourlyExposure(item.price, item.resources);
    return value === null || rate < value ? rate : value;
  }, null);
  assert(lowest !== null && lowest * BigInt(Math.max(1, settings.min_instances)) <= BigInt(settings.max_hourly_compute_cost_micro_usd),
    400, 'worker_cost_limit', 'The spending ceiling cannot fund one matching allocation and the requested baseline.');
}
'''+s[end:]
s=s.replace("  authorizeWorker(p, 'workers:write');\n  await lock(tx, `workers:${p.organizationId}`);\n  const name =", "  authorizeWorker(p, 'workers:write');\n  assert(!p.workerIds?.length, 403, 'worker_management_forbidden', 'Creating Workers requires a credential without Worker restrictions.');\n  await lock(tx, `workers:${p.organizationId}`);\n  const name =",1)
s=s.replace("  assert(row.desired_state !== 'destroyed', 409, 'worker_destroyed', 'A destroyed Worker cannot be changed.');", "  assert(row.desired_state !== 'destroyed', 409, 'worker_destroyed', 'A destroyed Worker cannot be changed.');\n  assert(row.settings.expires_at_ms === null || row.settings.expires_at_ms > Date.now(),\n    409, 'worker_expired', 'An expired Worker cannot be changed. Create a new Worker.');")
s=s.replace('  if (!input.dedicated) { delete input.min_instances; delete input.max_instances; }', '''  if (!input.dedicated) {
    assert(patch.min_instances === undefined && patch.max_instances === undefined,
      400, 'worker_instances_require_dedicated', 'Instance limits apply only to dedicated Workers.');
    delete input.min_instances;
    delete input.max_instances;
  }''')
s=s.replace('  assert(BigInt(settings.max_hourly_compute_cost_micro_usd)', '  validateBaseline(settings, offerings);\n  assert(BigInt(settings.max_hourly_compute_cost_micro_usd)')
p.write_text(s)
p=Path('packages/core/src/worker-types.ts');p.write_text(p.read_text().replace('  size?: string;', '  size?: string | null;'))
p=Path('packages/core/src/worker-policy.ts');p.write_text(p.read_text().replace("size: input.size === undefined ? null : selector(input.size, 'size'),", "size: input.size == null ? null : selector(input.size, 'size'),"))
p=Path('docs/api/openapi.json');spec=json.loads(p.read_text())
for name in ['WorkerCreate','WorkerPatch']:
 v=spec['components']['schemas'][name]['properties']['size'];v['type']=['string','null'];v['description']='Fixed advertised shape, or null for automatic sizing. Omission preserves the current shape on PATCH.'
p.write_text(json.dumps(spec,indent=2)+'\n')
p=Path('packages/cli/src/workers.ts');p.write_text(p.read_text().replace("  if(flags['no-expiry'])", "  if(flags['auto-size'])value.size=null;\n  if(flags['no-expiry'])"))
p=Path('packages/cli/src/index.ts');p.write_text(p.read_text().replace('region: Flags.string(), runtime: Flags.string(), size: Flags.string(),', "region: Flags.string(), runtime: Flags.string(), size: Flags.string({ exclusive: ['auto-size'] }),\n  'auto-size': Flags.boolean({ exclusive: ['size'], description: 'Choose fitting accepted sizes automatically' }),"))
p=Path('docs/features/execution/workers.md');s=p.read_text().replace('Omit `size` to let Macrofold choose among the accepted compatible sizes.', 'Omit `size` on creation, or set `size: null`, to let Macrofold choose among the accepted compatible sizes. A PATCH with `size: null` restores automatic sizing; omitting it preserves the existing choice. The CLI equivalent is `--auto-size`.')
s=s.replace('Use `expires_at` only when you want the Worker itself to expire.', 'Use `expires_at` only when you want the Worker itself to expire. Extend or remove that expiration before it passes; an already expired Worker cannot be resumed or reconfigured.')
s=s.replace('Worker-ID restrictions on API keys are independent from Workspace restrictions.', 'Worker-ID restrictions on API keys are independent from Workspace restrictions. Creating a new Worker requires a key without Worker restrictions; restricted administrative keys can manage only their authorized existing Workers.')
p.write_text(s)
p=Path('docs/maintainers/TODO.md');p.write_text(p.read_text().replace('## Worker cutover regression obligations\n','''## Worker cutover regression obligations

- [ ] Cover Worker creation with an otherwise administrative Worker-restricted key, immutable expired targets, explicit pooled instance settings on PATCH, and baseline affordability after raising `min_instances`. Default resolution must honor requested runtime/size before choosing region and rates. Cover `size: null` and CLI `--auto-size` returning to automatic sizing without weakening revision or pause requirements.
'''))
subprocess.run(['pnpm','exec','prettier','--write','packages/core/src/workers.ts','packages/core/src/worker-types.ts','packages/core/src/worker-policy.ts','packages/cli/src/workers.ts','packages/cli/src/index.ts'],check=True)
