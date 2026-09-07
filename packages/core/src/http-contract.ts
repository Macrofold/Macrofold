import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import spec from '../../../docs/api/openapi.json';
import { assert } from './errors';
type JSONSchema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
};
export type Operation = {
  operationId: string;
  parameters?: { $ref?: string; name?: string; in?: string; required?: boolean; schema?: JSONSchema }[];
  requestBody?: { required?: boolean; content: Record<string, { schema: JSONSchema }> };
  responses: Record<string, { content?: Record<string, { schema: JSONSchema }> }>;
  security?: Record<string, string[]>[];
};
export const apiSpec = spec;
const root = spec as unknown as {
  components: { parameters: Record<string, unknown>; schemas: Record<string, JSONSchema> };
  paths: Record<string, Record<string, Operation>>;
};
const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: false });
addFormats(ajv);
ajv.addSchema({ $id: 'platform', components: root.components });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function validate(schema: JSONSchema, data: unknown, label: string) {
  const key = JSON.stringify(schema);
  let check = validators.get(key);
  if (!check) {
    check = ajv.compile({ ...schema, components: root.components });
    validators.set(key, check);
  }
  assert(check(data), 400, 'invalid_request', `${label} is invalid.`, {
    issues: check.errors?.map((e) => ({ path: e.instancePath, message: e.message })).slice(0, 10),
  });
}
export const routes = Object.entries(root.paths).flatMap(([path, methods]) =>
  Object.entries(methods)
    .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
    .map(([method, operation]) => ({
      path,
      method: method.toUpperCase(),
      operation,
      names: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
      pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, '([^/]+)')}/?$`),
    })),
);
export function matchRoute(request: Request) {
  const path = new URL(request.url).pathname;
  const route = routes.find((r) => r.method === request.method && r.pattern.test(path));
  assert(route, 404, 'not_found', 'API endpoint not found.');
  const matches = path.match(route.pattern)!;
  try {
    return {
      ...route,
      params: Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(matches[i + 1])])),
    };
  } catch {
    assert(false, 400, 'invalid_request', 'Path parameters must use valid URL encoding.');
  }
}
export function validateParameters(operation: Operation, request: Request, params: Record<string, string>) {
  const url = new URL(request.url);
  for (const ref of operation.parameters || []) {
    const parameter = (ref.$ref ? root.components.parameters[ref.$ref.split('/').pop()!] : ref) as {
      name: string;
      in: string;
      required?: boolean;
      schema: JSONSchema;
    };
    const value =
      parameter.in === 'path'
        ? params[parameter.name]
        : parameter.in === 'query'
          ? url.searchParams.get(parameter.name)
          : request.headers.get(parameter.name);
    if (value === null || value === undefined) {
      assert(!parameter.required, 400, 'missing_parameter', `${parameter.name} is required.`);
      continue;
    }
    const parsed =
      parameter.schema.type === 'integer'
        ? Number(value)
        : parameter.schema.type === 'boolean'
          ? value === 'true'
            ? true
            : value === 'false'
              ? false
              : value
          : value;
    validate(parameter.schema, parsed, parameter.name);
  }
}
export function validateBody(operation: Operation, value: unknown, binary: boolean) {
  if (operation.requestBody && !binary) {
    const schema = operation.requestBody.content['application/json']?.schema;
    if (schema) validate(schema, value, 'Request body');
  }
}
function resolve(schema: JSONSchema): JSONSchema {
  return schema.$ref ? root.components.schemas[schema.$ref.split('/').pop()!] || schema : schema;
}
/** Public responses are projected from the contract; encrypted/internal fields never reach callers. */
export function projectResponse(value: unknown, schema: JSONSchema): unknown {
  schema = resolve(schema);
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => (schema.items ? projectResponse(v, schema.items) : v));
  if (typeof value === 'object' && !(value instanceof Date) && schema.properties) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([key]) => record[key] !== undefined)
        .map(([key, child]) => [key, projectResponse(record[key], child)]),
    );
  }
  return value;
}
export function responseFor(operation: Operation, value: unknown) {
  const [code, result] = Object.entries(operation.responses).find(([code]) => code.startsWith('2'))!;
  const schema = result.content?.['application/json']?.schema;
  return { status: Number(code), body: schema ? projectResponse(value, schema) : value };
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}
