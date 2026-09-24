from pathlib import Path
edits = {}
def read(name): return edits[name] if name in edits else Path(name).read_text()
def replace(name, old, new):
    text = read(name)
    if old == new: return
    if old not in text:
        if new in text: return
        raise RuntimeError(f'{name}: reviewed anchor changed: {old[:100]}')
    if text.count(old) != 1: raise RuntimeError(f'{name}: ambiguous anchor')
    edits[name] = text.replace(old, new)

replace('packages/core/src/host-allocations.ts', "new Map<string, HostSnapshot['worktrees']>()", "new Map<string, Array<HostSnapshot['worktrees'][number]>>()")
p = 'scripts/build-runtime.ts'
edits[p] = ''.join(line for line in read(p).splitlines(True) if '/sandbox-control' not in line)
p = 'packages/core/src/worker-reconciler.ts'
if "import { type ComputeMeters }" in read(p):
    replace(p, "import { type ComputeMeters }", "import { workerHourlyExposure, type ComputeMeters }")
p = 'tests/unit/docker-machines.test.ts'
text = read(p)
legacy = "  it('transfers a full checkpoint chunk through reusable control"
if legacy in text:
    a = text.index(legacy)
    b = text.index("  it('passes only run capabilities", a)
    edits[p] = text[:a] + text[b:]
p = 'docs/maintainers/TODO.md'
text = read(p)
entry = '- [ ] Replace the removed legacy reusable-control chunk test with Host assignment/boot-scoped transport coverage for a full 4 MiB decoded checkpoint chunk, bounded encoded envelope, and stopped/replaced-generation rejection. The old method no longer exists; new tests remain deferred by request.'
if entry not in text: edits[p] = text + '\n' + entry + '\n'
for name, text in edits.items(): Path(name).write_text(text)
print('APPLIED_SOURCE_FILES', ', '.join(edits))
