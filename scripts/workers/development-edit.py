"""Reviewed one-shot branch edit; the development workflow removes this file after applying it."""
from pathlib import Path

def replace(file, old, new):
    p = Path(file)
    content = p.read_text()
    if old not in content:
        raise RuntimeError(f'Expected source changed: {file}: {old[:90]}')
    p.write_text(content.replace(old, new, 1))

replace('packages/db/043_workers.sql', " settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),", " settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),\n offerings jsonb NOT NULL CHECK(jsonb_typeof(offerings)='array'),")
replace('packages/core/src/runs.ts', "  sandbox_id?: string;", "  worker_id?: string;\n  worker_resources?: { memory_mib: number; cpu_millis: number };\n  sandbox_id?: string;")
p = Path('scripts/migrate.ts')
s = p.read_text()
needle = 'await client.query('
# Add the catalog restriction at the end of the existing owner transaction, after grants.
pos = s.rfind("await client.query('COMMIT')")
if pos < 0:
    pos = s.rfind('await client.query("COMMIT")')
if pos >= 0:
    s = s[:pos] + "await client.query('REVOKE INSERT, UPDATE, DELETE ON worker_offerings FROM platform_app');\n    " + s[pos:]
else:
    # Do not guess a role/transaction structure. The follow-up inspection supplies the exact owner.
    print('CATALOG_GRANT_REQUIRES_OWNER_EDIT')
p.write_text(s)
