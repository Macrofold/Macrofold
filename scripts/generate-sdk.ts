import { mkdir, readFile, writeFile } from 'node:fs/promises';
const specification = JSON.parse(await readFile('docs/api/openapi.json', 'utf8'));
const routes: Record<string, { method: string; path: string }> = {};
for (const [path, methods] of Object.entries(specification.paths))
  for (const [method, operation] of Object.entries(methods as Record<string, { operationId?: string }>))
    if (operation.operationId) routes[operation.operationId] = { method: method.toUpperCase(), path };
await mkdir('sdk/typescript/src', { recursive: true });
await writeFile(
  'sdk/typescript/src/routes.ts',
  `// Generated from docs/api/openapi.json. Run pnpm sdk:generate after contract changes.\nexport const routes = ${JSON.stringify(routes, null, 2)} as const;\n`,
);
await writeFile('sdk/typescript/src/schema.d.ts', await readFile('packages/contracts/api.d.ts', 'utf8'));
await mkdir('sdk/python/macrofold', { recursive: true });
await writeFile('sdk/python/macrofold/routes.json', JSON.stringify(routes, null, 2) + '\n');
