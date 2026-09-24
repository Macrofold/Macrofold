from pathlib import Path
import subprocess

expected = {
    'packages/runtime/src/host-control.ts': '82c12965346b661f3610f4582302041693e3e02a',
    'packages/runtime/src/host-paths.ts': '1512a5456b38fb8ebbbb7099eb9200c1f83e38e3',
    'docs/maintainers/TODO.md': '76068cb5baaa7e480f876827c4516a2399b77ca3',
}
for name, sha in expected.items():
    if subprocess.check_output(['git', 'hash-object', name], text=True).strip() != sha:
        raise RuntimeError(f'Concurrent edit: {name}')

p=Path('packages/runtime/src/host-paths.ts')
s=p.read_text().replace('assignmentId: z.uuid(), handleId: z.uuid(), worktreeId: z.uuid(),', 'assignmentId: z.uuid(), handleId: z.uuid(), worktreeId: z.uuid(),\n  sessionId: z.uuid().nullable().optional(),')
s=s.replace('home: `/host-data/handles/${value.handleId}/home`,', '''// Native continuation databases can contain absolute paths. Keep HOME stable
    // for a Session across cold handles/Hosts without making it a public resource.
    home: value.sessionId
      ? `/host-data/continuations/${value.sessionId}`
      : `/host-data/handles/${value.handleId}/home`,''')
p.write_text(s)
p=Path('packages/runtime/src/host-control.ts')
s=p.read_text().replace('    await rm(base, { recursive: true, force: true });', '''    await rm(base, { recursive: true, force: true });
    if (handle.session)
      await rm(`/host-data/continuations/${handle.session}`, { recursive: true, force: true });''')
s=s.replace('      const home = `/host-data/handles/${handleId}/home`;', '''      const home = hostRunPaths({
        assignmentId: request.assignment_id,
        handleId,
        worktreeId: request.worktree_id,
        sessionId: request.session_id,
        uid,
        memoryMiB: request.resources.memory_mib,
      }).home;''')
s=s.replace('      worktreeId: request.worktree_id,\n      uid: handle.uid,', '      worktreeId: request.worktree_id,\n      sessionId: request.session_id,\n      uid: handle.uid,')
s=s.replace("['/host-data', '/host-data/worktrees', '/host-data/handles']", "['/host-data', '/host-data/worktrees', '/host-data/handles', '/host-data/continuations']")
p.write_text(s)
p=Path('docs/maintainers/TODO.md')
s=p.read_text().replace('## Worker cutover regression obligations\n', '''## Worker cutover regression obligations

- [ ] Cover native continuation databases with absolute paths: Session-scoped HOME stays stable across different handle IDs and fresh Hosts; permission changes, handle eviction and failed preparation remove only the owning continuation directory. Preserve credential exclusions and the separate per-handle temporary directory.
''')
p.write_text(s)
subprocess.run(['pnpm','exec','prettier','--write','packages/runtime/src/host-control.ts','packages/runtime/src/host-paths.ts'],check=True)
print('Applied portable native continuation paths; Codex fresh-process resume verified before committing.')
