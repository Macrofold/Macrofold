from pathlib import Path
edits={}
def read(p): return edits.get(p,Path(p).read_text())
def replace(p,a,b,count=1):
 s=read(p)
 if s.count(a)!=count:raise RuntimeError(f'{p}: stale anchor {a[:80]} ({s.count(a)}/{count})')
 edits[p]=s.replace(a,b)
replace('scripts/workers/stress.ts', "{ query: { worker_id: worker.id } }", "{ query: { worker_id: worker.id, from: new Date(Date.now() - 3600000).toISOString(), to: new Date().toISOString() } }")
replace('packages/core/src/automatic-machines.ts', "checkpoint_id: demand.worktree?.revision || null,", "checkpoint_id: demand.worktree?.revision === 'empty' ? null : demand.worktree?.revision || null,")
replace('apps/web/components/dashboard.tsx', "const WorkersView", "const WorkersView", count=0) if 'const WorkersView' in read('apps/web/components/dashboard.tsx') else None
replace('apps/web/components/dashboard.tsx', "const WorkspacesView = dynamic", "const WorkersView = dynamic(() => import('./workers').then((m) => m.WorkersView), { loading });\nconst WorkspacesView = dynamic")
replace('apps/web/components/dashboard.tsx', "  else if (route === 'connections')", "  else if (route === 'workers') content = <WorkersView />;\n  else if (route === 'connections')")
replace('apps/web/components/shell.tsx', "  CalendarClock,", "  CalendarClock,\n  Cpu,")
replace('apps/web/components/shell.tsx', "  { href: '/runs', label: 'Runs', icon: Activity },", "  { href: '/runs', label: 'Runs', icon: Activity },\n  { href: '/workers', label: 'Workers', icon: Cpu },")
replace('apps/web/components/run-composer.tsx', "import { RunAttachments, type PendingAttachment } from './run-attachments';", "import { RunAttachments, type PendingAttachment } from './run-attachments';\nimport { WorkerSelection, type WorkerPlacement } from './worker-selection';")
replace('apps/web/components/run-composer.tsx', "    [advanced, setAdvanced] = useState(false),", "    [advanced, setAdvanced] = useState(false),\n    [placement, setPlacement] = useState<WorkerPlacement>({}),")
replace('apps/web/components/run-composer.tsx', "            const body: Schema['RunCreate'] = {\n              prompt,", "            const body: Schema['RunCreate'] = {\n              ...placement,\n              prompt,")
replace('apps/web/components/run-composer.tsx', '          <div className="advanced-fields" id="run-settings">', '          <div className="advanced-fields" id="run-settings">\n            <WorkerSelection value={placement} onChange={setPlacement} />')
replace('apps/web/components/run-composer.tsx', "              : 'Spending is capped by your budget'", "              : placement.worker_id ? 'Run budget excludes separately billed Worker compute' : 'Spending is capped by your budget'")
replace('apps/web/components/workers.tsx', 'maxLength={160}', 'maxLength={100}')
replace('apps/web/components/workers.tsx', 'aria-label={worker.name}', "aria-label={worker.name || worker.id}")
replace('apps/web/components/workers.tsx', '<h2>{worker.name}</h2>', '<h2>{worker.name || worker.id}</h2>')
replace('docs/maintainers/TODO.md', '## Worker cutover regression obligations\n', '''## Worker cutover regression obligations

- [ ] Cover dashboard Worker lifecycle confirmation, revision-conflict preservation, exact USD conversion, paginated selectors, disabled unsupported offerings, and placement on both new and continuing Runs. A Run's budget label must not imply it pays for the entire explicit Worker.
''')
for p,s in edits.items():Path(p).write_text(s)
print('APPLIED_SOURCE_FILES',', '.join(edits))
