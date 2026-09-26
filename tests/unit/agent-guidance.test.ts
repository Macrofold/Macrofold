import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkGuidance } from '../../scripts/check-agent-guidance';

const fixtures: string[] = [];
function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'macrofold-guidance-'));
  fixtures.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  put(root, 'AGENTS.md', '# Instructions\n[Rules](.agents/rules/README.md)\n');
  put(root, 'CLAUDE.md', '@AGENTS.md\n');
  put(root, '.agents/rules/README.md', '# Rules\n[Do work](../skills/work/SKILL.md)\n');
  put(
    root,
    '.agents/skills/work/SKILL.md',
    '---\nname: work\ndescription: >-\n  Perform bounded work.\n---\n# Work\nFollow the task.\n',
  );
  return root;
}
function documentationFixture(root: string) {
  put(
    root,
    'scripts/check-docs.py',
    readFileSync(new URL('../../scripts/check-docs.py', import.meta.url), 'utf8'),
  );
  put(root, 'docs/README.md', '# Docs\n');
  put(root, 'docs/navigation.json', '[]');
  put(root, 'packages/cli/README.md', '# CLI\n');
  put(root, '.github/pull_request_template.md', '# Pull request\n');
  put(
    root,
    'docs/requirements.csv',
    [
      'requirement_id,status,operator_steps_or_tradeoffs,implementation_evidence,design_documents',
      ...Array.from(
        { length: 54 },
        (_, i) => `R${String(i + 1).padStart(2, '0')},done,none,AGENTS.md,README.md`,
      ),
    ].join('\n'),
  );
}
function checkDocs(root: string) {
  return spawnSync('python3', [join(root, 'scripts/check-docs.py')], { encoding: 'utf8', timeout: 10000 });
}
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('guidance validation on disposable repositories', () => {
  it.each([
    ['backtick fence', '```md\n[Example](missing.md)\n```'],
    ['tilde fence', '~~~md\n[Example](missing.md)\n~~~'],
    ['longer fence', '````md\n```\n[Example](missing.md)\n```\n````'],
    ['comment', '<!--\n[Example](missing.md)\n-->'],
    ['inline code', '`[Example](missing.md)`'],
    ['multi-backtick code', '`` `[Example](missing.md)` ``'],
  ])('both checkers ignore a %s but reject a real broken link', (_, example) => {
    const root = fixture();
    documentationFixture(root);
    const path = '.agents/skills/work/SKILL.md';
    const body = `---\nname: work\ndescription: Work safely.\n---\n# Work\n${example}\n`;
    put(root, path, body);
    expect(checkGuidance(root).errors).toEqual([]);
    const valid = checkDocs(root);
    expect(valid.error).toBeUndefined();
    expect(valid.status, valid.stdout + valid.stderr).toBe(0);

    put(root, path, body + '\n[Broken](missing.md)\n');
    expect(checkGuidance(root).errors.join('\n')).toContain('target missing.md');
    const invalid = checkDocs(root);
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain(`${path}: missing.md`);
  });
  it('ignores example headings while preserving real anchors containing inline code', () => {
    const root = fixture();
    documentationFixture(root);
    put(
      root,
      'docs/README.md',
      '# Docs\n~~~md\n## Example\n~~~\n<!--\n## Hidden\n-->\n## Actual `code`\n[Valid](#actual-code)\n',
    );
    const valid = checkDocs(root);
    expect(valid.status, valid.stdout + valid.stderr).toBe(0);
    put(
      root,
      '.agents/README.md',
      '[Bad example anchor](../docs/README.md#example)\n[Bad comment anchor](../docs/README.md#hidden)\n',
    );
    const invalid = checkDocs(root);
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain('missing heading ../docs/README.md#example');
    expect(invalid.stdout).toContain('missing heading ../docs/README.md#hidden');
  });
  it('accepts unstaged instructions, block YAML and transitive operational routes', () => {
    const root = fixture();
    const result = checkGuidance(root);
    expect(result.errors).toEqual([]);
    expect(result.skills).toBe(1);
    expect(result.rootBytes).toBeGreaterThan(0);
    expect(result.discoveryBytes).toBeGreaterThan(0);
  });
  it('accepts scoped entrypoints and quoted metadata with additional fields', () => {
    const root = fixture();
    put(root, '.agents/rules/README.md', '# Rules\n');
    put(root, 'packages/new/AGENTS.md', '# Scope\n[Work](../../.agents/skills/work/SKILL.md)\n');
    put(
      root,
      '.agents/skills/work/SKILL.md',
      '---\nname: "work"\ndescription: "Work: safely"\nmetadata:\n  owner: engineering\n---\n# Work\nDo the task.\n',
    );
    expect(checkGuidance(root).errors).toEqual([]);
  });
  it.each([
    'name: work\nname: other\ndescription: Work',
    'name: wrong\ndescription: Work',
    'name: work\ndescription: [Work]',
    'name: work\ndescription: ',
  ])('rejects invalid metadata: %s', (metadata) => {
    const root = fixture();
    put(root, '.agents/skills/work/SKILL.md', `---\n${metadata}\n---\n# Work\nDo it.\n`);
    expect(checkGuidance(root).errors.join('\n')).toMatch(/metadata|name|description/);
  });
  it('rejects an empty skill body and a noncanonical Claude entrypoint', () => {
    const root = fixture();
    put(root, '.agents/skills/work/SKILL.md', '---\nname: work\ndescription: Work\n---\n');
    put(root, 'CLAUDE.md', '@AGENTS.md\nAlternative policy.\n');
    expect(checkGuidance(root).errors.join('\n')).toMatch(/empty skill body/);
    expect(checkGuidance(root).errors.join('\n')).toMatch(/CLAUDE.md/);
  });
  it('does not count examples, comments, optional references or orphan cycles as routes', () => {
    const root = fixture();
    put(
      root,
      '.agents/rules/README.md',
      '# Rules\n[Research](../references/research.md)\n~~~md\n[Example](../skills/work/SKILL.md)\n~~~\n<!-- [Hidden](../skills/work/SKILL.md) -->\n`[Code](../skills/work/SKILL.md)`\n',
    );
    put(root, '.agents/references/research.md', '# Research\n[Work](../skills/work/SKILL.md)\n');
    put(
      root,
      '.agents/skills/work/SKILL.md',
      '---\nname: work\ndescription: Work\n---\n# Work\n[Self](SKILL.md)\n',
    );
    expect(checkGuidance(root).errors).toContain(
      '.agents/skills/work/SKILL.md: no operational route from root/scoped AGENTS.',
    );
  });
  it('rejects ignored, escaping, malformed and symlinked link targets', () => {
    const root = fixture();
    put(root, '.gitignore', 'private.md\n');
    put(root, 'private.md', 'Private.');
    symlinkSync(join(root, 'private.md'), join(root, 'alias.md'));
    put(
      root,
      '.agents/README.md',
      '# Guide\n[Private](../private.md)\n[Escape](../../outside.md)\n[Malformed](%ZZ)\n[Alias](../alias.md)\n',
    );
    expect(checkGuidance(root).errors.filter((error) => error.startsWith('.agents/README.md:'))).toHaveLength(
      4,
    );
  });
  it('does not read guidance through symlinked parents', () => {
    const root = fixture();
    put(root, 'actual/AGENTS.md', '# Actual\n');
    put(root, '.agents/AGENTS.md', '# Target\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    rmSync(join(root, 'actual'), { recursive: true });
    symlinkSync(join(root, '.agents'), join(root, 'actual'));
    expect(checkGuidance(root).errors.join('\n')).toMatch(
      /actual\/AGENTS.md: missing or symlinked guidance source/,
    );
  });
  it('permits removal of tracked guidance after its incoming route is removed', () => {
    const root = fixture();
    execFileSync('git', ['add', '.'], { cwd: root });
    rmSync(join(root, '.agents/skills/work/SKILL.md'));
    put(root, '.agents/rules/README.md', '# Rules\n');
    expect(checkGuidance(root).errors).toEqual([]);
  });
});
