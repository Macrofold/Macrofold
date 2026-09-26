import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMap, parseDocument } from 'yaml';

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const agent = (path: string) => /(^|\/)AGENTS\.md$/.test(path);
const skill = (path: string) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(path);
const operational = (path: string) => agent(path) || skill(path) || path.startsWith('.agents/rules/');
const portable = (path: string) => path.split(sep).join('/');

// Ignore examples and comments: they are not operational routing links.
function prose(text: string) {
  let fence = '';
  return text
    .replace(frontmatter, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!marker) return !fence;
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
      return false;
    })
    .join('\n')
    .replace(/(`+)[\s\S]*?\1(?!`)/g, '');
}

export function checkGuidance(directory: string) {
  const root = realpathSync(directory);
  const errors: string[] = [],
    warnings: string[] = [];
  const paths = new Set(
    execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10000,
    })
      .split('\0')
      .filter((path) => {
        if (!path) return false;
        try {
          lstatSync(resolve(root, path));
          return true;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
          throw error;
        }
      }),
  );
  const inventory = new Set(paths);
  for (const path of paths) {
    let parent = portable(dirname(path));
    while (parent !== '.') {
      inventory.add(parent);
      parent = portable(dirname(parent));
    }
  }
  inventory.add('');
  const safe = (path: string) => {
    if (!inventory.has(path)) return false;
    try {
      const absolute = resolve(root, path);
      return !lstatSync(absolute).isSymbolicLink() && realpathSync(absolute) === absolute;
    } catch {
      return false;
    }
  };
  const sources = new Map<string, string>();
  for (const path of paths) {
    if (/(^|\/)(AGENTS\.override\.md|CLAUDE\.local\.md)$/.test(path) || path.endsWith('/CLAUDE.md')) {
      warnings.push(`${path}: verify native loader precedence in a fresh session.`);
    }
    if (!(
      agent(path) ||
      /(^|\/)CLAUDE\.md$/.test(path) ||
      /^\.agents\/.*\.md$/.test(path) ||
      ['CONTRIBUTING.md', '.github/pull_request_template.md'].includes(path)
    ))
      continue;
    if (!safe(path)) {
      errors.push(`${path}: missing or symlinked guidance source.`);
      continue;
    }
    sources.set(path, readFileSync(resolve(root, path), 'utf8'));
  }
  if (!sources.get('AGENTS.md')?.trim()) errors.push('AGENTS.md: missing root instructions.');
  if (sources.get('CLAUDE.md')?.trim() !== '@AGENTS.md') errors.push('CLAUDE.md: expected only @AGENTS.md.');
  const links = new Map<string, Set<string>>(),
    names = new Set<string>();
  let discoveryBytes = 0;
  for (const [path, text] of sources) {
    const targets = new Set<string>();
    links.set(path, targets);
    if (path.startsWith('.agents/skills/') && path.endsWith('/SKILL.md')) {
      const match = text.match(frontmatter);
      if (!skill(path)) errors.push(`${path}: skills must be directly under .agents/skills/<name>/.`);
      if (!match) errors.push(`${path}: missing YAML frontmatter.`);
      else {
        const yaml = parseDocument(match[1], { uniqueKeys: true });
        if (yaml.errors.length || yaml.warnings.length || !isMap(yaml.contents))
          errors.push(`${path}: invalid YAML metadata.`);
        else {
          const name: unknown = yaml.get('name'),
            description: unknown = yaml.get('description');
          if (
            typeof name !== 'string' ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
            name.length > 64 ||
            name !== path.split('/')[2] ||
            names.has(name)
          )
            errors.push(`${path}: invalid, duplicate or directory-mismatched name.`);
          if (typeof name === 'string') names.add(name);
          if (typeof description !== 'string' || !description.trim() || description.length > 1024)
            errors.push(`${path}: description must be a nonempty string of at most 1024 characters.`);
          if (typeof name === 'string' && typeof description === 'string')
            discoveryBytes += Buffer.byteLength(`${name}\n${description}\n${path}`);
        }
        if (!text.slice(match[0].length).trim()) errors.push(`${path}: empty skill body.`);
      }
    }
    for (const match of prose(text).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
      let target: string;
      try {
        target = portable(
          relative(root, resolve(root, dirname(path), decodeURIComponent(href.split('#')[0]))),
        );
      } catch {
        errors.push(`${path}: malformed link ${href}`);
        continue;
      }
      if (isAbsolute(target) || target === '..' || target.startsWith('../') || !safe(target)) {
        errors.push(`${path}: missing, ignored, escaping or symlinked target ${href}`);
      } else if (operational(path) && operational(target)) targets.add(target);
    }
  }
  const agents = [...sources.keys()].filter(agent),
    reachable = new Set(agents),
    pending = [...agents];
  while (pending.length) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const target of links.get(current) ?? []) {
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
    }
  }
  for (const path of sources.keys()) {
    if (operational(path) && !reachable.has(path))
      errors.push(`${path}: no operational route from root/scoped AGENTS.`);
  }
  const bytes = (path: string) => Buffer.byteLength(sources.get(path) ?? '');
  const chainBytes = Math.max(
    0,
    ...agents.map((path) =>
      agents
        .filter(
          (ancestor) =>
            ancestor === 'AGENTS.md' || ancestor === path || path.startsWith(`${dirname(ancestor)}/`),
        )
        .reduce((sum, ancestor) => sum + bytes(ancestor), 0),
    ),
  );
  return {
    errors,
    warnings,
    files: sources.size,
    skills: names.size,
    rootBytes: bytes('AGENTS.md'),
    chainBytes,
    discoveryBytes,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkGuidance(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  for (const warning of result.warnings) console.warn(`Guidance warning: ${warning}`);
  for (const error of result.errors) console.error(`Guidance error: ${error}`);
  console.log(
    `Guidance: ${result.files} files, ${result.skills} skills; context bytes (not tokens): root ${result.rootBytes}, longest AGENTS ancestry ${result.chainBytes}, skill discovery ${result.discoveryBytes}. Excludes mandatory/topic bodies and harness overhead.`,
  );
  if (result.errors.length) process.exitCode = 1;
}
