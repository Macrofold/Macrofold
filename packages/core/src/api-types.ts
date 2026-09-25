import type { Tx } from '../../db';
import type { Principal } from './auth';
import type { components, operations } from '../../contracts/api';
export type ApiOperation = keyof operations;
type Content<T> = T extends { content: infer C }
  ? C extends { 'application/json': infer J }
    ? J
    : C[keyof C]
  : undefined;
type Responses<K extends ApiOperation> = operations[K]['responses'];
export type ApiResult<K extends ApiOperation> = Content<
  Responses<K>[Extract<keyof Responses<K>, 200 | 201 | 202 | 204>]
>;
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
/** Each operation's result is checked against the generated public contract. */
export type HandlerMap = {
  [K in ApiOperation]?: (
    context: Context,
  ) => Promise<(ApiResult<K> extends undefined ? void : ApiResult<K>) | Response>;
};
export type RequestContext = Omit<Context, 'tx'>;
export type PreparedHandler<K extends ApiOperation = ApiOperation> = (context: RequestContext) => Promise<{
  commit(tx: Tx, principal: Principal): Promise<ApiResult<K>>;
  dispose(): Promise<void>;
}>;
export type PreparationMap = { [K in ApiOperation]?: PreparedHandler<K> };
export const input = <K extends keyof components['schemas']>(context: Pick<Context, 'body'>) =>
  context.body as components['schemas'][K];
