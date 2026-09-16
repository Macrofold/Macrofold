import { isLocal } from './config';

type Flow = 'dashboard' | 'customer';
export const connectionCookieName = (flow: Flow) =>
  `${isLocal() ? '' : '__Host-'}${flow === 'customer' ? 'customer-connect' : 'composio-state'}`;
export const connectionCookie = (flow: Flow, value = '', age = 0) =>
  `${connectionCookieName(flow)}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${isLocal() ? '' : '; Secure'}`;

/** Both journeys use the provider's one project-wide callback. Starting one invalidates the other browser cookie. */
export function startConnectionCookies(flow: Flow, state: string, initial: HeadersInit) {
  const headers = new Headers(initial);
  headers.append('set-cookie', connectionCookie(flow, state, 600));
  headers.append('set-cookie', connectionCookie(flow === 'customer' ? 'dashboard' : 'customer'));
  return headers;
}
