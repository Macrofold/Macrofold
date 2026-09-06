"""Validate local documentation links and implementation-evidence paths without network calls."""
import csv
import pathlib
import re
import sys
from urllib.parse import unquote

root = pathlib.Path(__file__).resolve().parent.parent
failures = []
files = list((root / 'docs').rglob('*.md')) + list(root.glob('*.md'))
for source in files:
    for target in re.findall(r'\]\(([^\s)]+)(?:\s+[^)]*)?\)', source.read_text()):
        if target.startswith(('#', 'http:', 'https:', 'mailto:')):
            continue
        clean = unquote(target.split('#', 1)[0]).strip('<>')
        if clean and not (source.parent / clean).exists():
            failures.append(f'{source.relative_to(root)}: {target}')
rows = list(csv.DictReader((root / 'docs/requirements.csv').open()))
assert len(rows) == 53 and {r['requirement_id'] for r in rows} == {f'R{i:02}' for i in range(1, 54)}
for row in rows:
    if not row['status'] or not row['operator_steps_or_tradeoffs']:
        failures.append(row['requirement_id'] + ': missing status or tradeoff')
    for target in row['implementation_evidence'].split(';'):
        if not (root / target).exists():
            failures.append(row['requirement_id'] + ': ' + target)
if failures:
    print('\n'.join(failures))
    sys.exit(1)
print(f'{len(files)} Markdown files and {len(rows)} requirement evidence mappings have valid local targets.')
