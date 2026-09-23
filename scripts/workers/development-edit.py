"""One-shot reviewed edits; the branch workflow removes this file after applying it."""
from pathlib import Path


def replace(path, before, after):
    target = Path(path)
    source = target.read_text()
    if source.count(before) != 1:
        raise RuntimeError(f'Expected one unchanged anchor in {path}')
    target.write_text(source.replace(before, after))


replace('packages/runtime/src/manifest.ts',
        "import { isHiddenSnapshotPath } from './snapshot-paths';\n", '')
replace('packages/runtime/src/manifest.ts',
        'if (isHiddenSnapshotPath(relative) || isNativeAuthPath(namespace, relative)) continue;',
        'if (isNativeAuthPath(namespace, relative)) continue;')
replace('packages/core/src/cloud-engine.ts',
        "import { isHiddenSnapshotPath } from '../../runtime/src/snapshot-paths';\n", '')
replace('packages/core/src/cloud-engine.ts',
        'if (isHiddenSnapshotPath(entry.path) || isNativeAuthPath(entry.namespace, entry.path)) continue;',
        'if (isNativeAuthPath(entry.namespace, entry.path)) continue;')
replace('tests/unit/manifest.test.ts',
        "    expect(await readFile(path.join(restored.home, 'session.json'), 'utf8')).toBe('native history');\n",
        "    expect(await readFile(path.join(restored.home, 'session.json'), 'utf8')).toBe('native history');\n"
        "    expect(await readFile(path.join(restored.workspace, '.git', 'HEAD'), 'utf8')).toBe(\n"
        "      'ref: refs/heads/main\\n',\n"
        "    );\n")
Path('packages/runtime/src/snapshot-paths.ts').unlink()
