import { readFile } from 'node:fs/promises';
import type {
  OpenAPI3,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
  PathItemObject,
  MediaTypeObject,
} from 'openapi-typescript';

export const specification: OpenAPI3 = JSON.parse(await readFile('docs/api/openapi.json', 'utf8'));
export function resolve<T>(value: T | ReferenceObject): T {
  if (value && typeof value === 'object' && '$ref' in value) {
    let resolved: unknown = specification;
    for (const key of String(value.$ref).replace(/^#\//, '').split('/'))
      resolved = (resolved as Record<string, unknown>)[key];
    if (!resolved) throw new Error(`Unresolved SDK reference: ${value.$ref}`);
    return resolved as T;
  }
  return value as T;
}
export const pascal = (value: string) =>
  value.replace(/(^|[-_ ])(\w)/g, (_, _gap, char: string) => char.toUpperCase());
export const camel = (value: string) => {
  const name = pascal(value);
  return name[0].toLowerCase() + name.slice(1);
};
export const snake = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[- ]/g, '_')
    .toLowerCase();

export type Operation = {
  id: string;
  group: string;
  name: string;
  path: string;
  method: string;
  operation: OperationObject;
  parameters: ParameterObject[];
  body?: { schema: SchemaObject | ReferenceObject; required: boolean; binary: boolean; empty: boolean };
};
export const operations: Operation[] = [];
for (const [path, pathItem] of Object.entries(specification.paths || {})) {
  const item = resolve<PathItemObject>(pathItem);
  for (const [method, operation] of Object.entries(item || {})) {
    if (!operation || typeof operation !== 'object' || !('operationId' in operation)) continue;
    const op = operation as OperationObject;
    if (!op.operationId || !op.tags?.[0])
      throw new Error(`SDK operation requires an ID and resource: ${path}`);
    const group = camel(op.tags[0]);
    const plural = pascal(group),
      singular = plural.replace(/ies$/, 'y').replace(/s$/, '');
    const name =
      op.operationId === 'exportCheckpoint'
        ? 'exportArchive'
        : op.operationId === 'continueSession'
          ? 'continueRun'
          : group === 'me' && op.operationId === 'getIdentity'
            ? 'get'
            : op.operationId.replace(new RegExp(`${plural}|${singular}`), '');
    if (operations.some((o) => o.group === group && o.name === name))
      throw new Error(`Duplicate SDK method: ${group}.${name}`);
    const request = op.requestBody && resolve(op.requestBody);
    const media = request && Object.entries(request.content)[0];
    const mediaType = media && resolve<MediaTypeObject>(media[1]);
    const schema = mediaType?.schema && resolve<SchemaObject>(mediaType.schema);
    operations.push({
      id: op.operationId,
      group,
      name,
      path,
      method: method.toUpperCase(),
      operation: op,
      parameters: [...(item?.parameters || []), ...(op.parameters || [])].map((p) =>
        resolve<ParameterObject>(p),
      ),
      ...(mediaType?.schema
        ? {
            body: {
              schema: mediaType.schema,
              required: request?.required || false,
              binary: media![0] === 'application/octet-stream',
              empty:
                !!schema &&
                'properties' in schema &&
                Object.keys(schema.properties || {}).length === 0 &&
                schema.additionalProperties === false,
            },
          }
        : {}),
    });
  }
}
export const groups = [...new Set(operations.map((o) => o.group))];
export const dataParameters = (op: Operation) =>
  op.parameters.filter(
    (p) => p.in !== 'path' && !['Idempotency-Key', 'X-Organization-Id', 'Last-Event-ID'].includes(p.name),
  );

export function properties(value: SchemaObject | ReferenceObject) {
  const schema = resolve<SchemaObject>(value);
  return 'properties' in schema ? schema.properties || {} : {};
}
