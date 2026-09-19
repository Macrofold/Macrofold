import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import spec from '../../../docs/api/openapi.json';
import { assert } from './errors';
export type JSONSchema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
};
export type Operation = {
  operationId: keyof import('../../contracts/api').operations;
  summary?: string;
  description?: string;
  parameters?: { $ref?: string; name?: string; in?: string; required?: boolean; schema?: JSONSchema }[];
  requestBody?: { required?: boolean; content: Record<string, { schema: JSONSchema }> };
  responses: Record<string, { content?: Record<string, { schema: JSONSchema }> }>;
  security?: Record<string, string[]>[];
  'x-required-scopes'?: string[];
};
/** Scope policy is independent of the supported authentication mechanisms. */
export function operationScopes(operation: Operation): string[] {
  return (
    operation['x-required-scopes'] ??
    operation.security?.find((s) => s.OperatorOAuth)?.OperatorOAuth ??
    operation.security?.find((s) => s.CustomerOAuth)?.CustomerOAuth ??
    []
  );
}
export type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema: JSONSchema;
  description?: string;
};
export function operationParameters(operation: Operation): Parameter[] {
  return (operation.parameters || []).map(
    (parameter) =>
      (parameter.$ref
        ? root.components.parameters[parameter.$ref.split('/').pop()!]
        : parameter) as Parameter,
  );
}
export const apiSchemas = spec.components.schemas as Record<string, JSONSchema>;
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
  for (const parameter of operationParameters(operation)) {
    if (parameter.in === 'query')
      assert(
        url.searchParams.getAll(parameter.name).length <= 1,
        400,
        'invalid_request',
        `${parameter.name} must appear once.`,
      );
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
export function workspaceResponse(value: unknown, schema: JSONSchema): unknown {
  schema = resolve(schema);
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => (schema.items ? workspaceResponse(v, schema.items) : v));
  if (typeof value === 'object' && !(value instanceof Date) && schema.properties) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties;
    return Object.fromEntries(
      Object.entries(record)
        .filter(
          ([key, child]) =>
            child !== undefined && (Object.hasOwn(properties, key) || schema.additionalProperties === true),
        )
        .map(([key, child]) => [
          key,
          Object.hasOwn(properties, key) ? workspaceResponse(child, properties[key]) : child,
        ]),
    );
  }
  return value;
}
export function responseFor(operation: Operation, value: unknown) {
  const [code, result] = Object.entries(operation.responses).find(([code]) => code.startsWith('2'))!;
  const schema = result.content?.['application/json']?.schema;
  return { status: Number(code), body: schema ? workspaceResponse(value, schema) : value };
}
