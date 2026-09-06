import type { Tx } from '../../db';
import type { Principal } from './auth';
import type { components } from '../../contracts/api';
export type Context = {
  tx: Tx;
  p: Principal;
  request: Request;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  bytes: Buffer;
  operationId: string;
  idempotencyKey: string;
  headers: Headers;
  requestId: string;
};
export type Handler = (context: Context) => Promise<unknown>;
export const input = <K extends keyof components['schemas']>(context: Context) =>
  context.body as components['schemas'][K];
