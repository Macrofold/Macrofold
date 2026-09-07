"""Validate local documentation links and implementation-evidence paths without network calls."""
import csv
import json
import pathlib
import re
import subprocess
import sys
from urllib.parse import unquote

root = pathlib.Path(__file__).resolve().parent.parent
failures = []
files = list((root / 'docs').rglob('*.md')) + list(root.glob('*.md')) + list((root / '.agents/rules').rglob('*.md'))
files += [root / 'packages/cli/README.md', *root.glob('sdk/*/README.md')]
# Git's inventory includes new instruction files without traversing dependencies, builds, or private artifacts.
instruction_paths = subprocess.run(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
     'AGENTS.md', '*/AGENTS.md', 'CLAUDE.md', '*/CLAUDE.md'],
    cwd=root, capture_output=True, text=True, check=True,
).stdout.split('\0')
files = list(dict.fromkeys(files + [root / p for p in instruction_paths if p]))

def headings(source):
    text = re.sub(r'^```[^\n]*\n[\s\S]*?^```\s*$', '', source.read_text(), flags=re.M)
    values, counts = set(), {}
    for heading in re.findall(r'^#{1,6} (.+)$', text, re.M):
        slug = re.sub(r'[^\w\s-]', '', heading.lower())
        slug = re.sub(r'\s', '-', slug)
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        values.add(slug + (f'-{count}' if count else ''))
    return values

anchors = {source: headings(source) for source in files}
links = {}
for source in files:
    links[source] = set()
    if source.name == 'CLAUDE.md':
        for target in re.findall(r'^@([^\s]+)$', source.read_text(), re.M):
            if not (source.parent / target).is_file():
                failures.append(f'{source.relative_to(root)}: missing instruction import {target}')
    for target in re.findall(r'\]\(([^\s)]+)(?:\s+[^)]*)?\)', source.read_text()):
        if target.startswith(('http:', 'https:', 'mailto:')):
            continue
        clean = unquote(target.split('#', 1)[0]).strip('<>')
        if clean and not (source.parent / clean).exists():
            failures.append(f'{source.relative_to(root)}: {target}')
        elif clean:
            links[source].add((source.parent / clean).resolve())
        destination = (source.parent / clean).resolve() if clean else source
        if '#' in target and destination in anchors:
            anchor = unquote(target.split('#', 1)[1])
            if anchor and anchor not in anchors[destination]:
                failures.append(f'{source.relative_to(root)}: missing heading {target}')
    # Provenance must be the last section, rather than interleaved progress notes.
    sections = re.findall(r'^## (.+)$', source.read_text(), re.M)
    if 'Changelog' in sections and sections[-1] != 'Changelog':
        failures.append(f'{source.relative_to(root)}: Changelog must be the final section')
reachable, pending = set(), [root / 'docs/README.md']
while pending:
    current = pending.pop()
    if current in reachable:
        continue
    reachable.add(current)
    pending.extend(links.get(current, set()) - reachable)
for source in (root / 'docs').rglob('*.md'):
    if source not in reachable:
        failures.append(f'{source.relative_to(root)}: not reachable from docs/README.md')
manifest = json.loads((root / 'docs/navigation.json').read_text())
for page in manifest:
    source = root / page['source']
    if not source.is_file() or source not in reachable:
        failures.append(page['source'] + ': published source is missing or unreachable')
        continue
    if re.search(r'/Users/|multiversalmike|\.data/launch|Live badges require|naming is provisional', source.read_text()):
        failures.append(page['source'] + ': private handoff or temporary release prose in public content')
    if not all(page.get(field) for field in ['title', 'description', 'section']):
        failures.append(page['source'] + ': incomplete publication metadata')
rows = list(csv.DictReader((root / 'docs/requirements.csv').open()))
assert len(rows) == 54 and {r['requirement_id'] for r in rows} == {f'R{i:02}' for i in range(1, 55)}
for row in rows:
    if not row['status'] or not row['operator_steps_or_tradeoffs']:
        failures.append(row['requirement_id'] + ': missing status or tradeoff')
    for target in row['implementation_evidence'].split(';'):
        if not (root / target).exists():
            failures.append(row['requirement_id'] + ': ' + target)
    for target in row['design_documents'].split(';'):
        if not (root / 'docs' / target).exists():
            failures.append(row['requirement_id'] + ': design document ' + target)
if failures:
    print('\n'.join(failures))
    sys.exit(1)
print(f'{len(files)} Markdown files and {len(rows)} requirement evidence mappings have valid local targets.')
