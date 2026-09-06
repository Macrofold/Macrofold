import { describe, it, expect, vi } from 'vitest';
import { dashboardRunEvents } from '../../apps/web/lib/run-events';
import { authReturnPath } from '../../apps/web/lib/auth-return';

describe('dashboard client boundaries', () => {
  it('normalizes same-origin auth destinations and survives malformed or external links', () => {
    const origin = 'https://agents.example.test';
    expect(authReturnPath('/projects?view=active#ignored', origin)).toBe('/projects?view=active');
    expect(authReturnPath(origin + '/account', origin)).toBe('/account');
    for (const unsafe of [
      'http://[',
      '//elsewhere.test/account',
      'javascript:alert(1)',
      'https://elsewhere.test',
    ])
      expect(authReturnPath(unsafe, origin)).toBe('/');
  });

  it('streams with cookies and durable cursors without putting a bearer key in the browser', async () => {
    const cursors: string[] = [];
    const frames = (sequence: string, type: string) =>
      `data: ${JSON.stringify({ id: sequence, run_id: 'run', sequence, type, data: {} })}\r\n\r\n`;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('same-origin');
      expect(init?.redirect).toBe('error');
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.get('X-Client-Type')).toBe('dashboard');
      if (String(url).includes('/stream')) {
        cursors.push(headers.get('Last-Event-ID')!);
        return new Response(
          cursors.length === 1
            ? frames('1', 'tool.started')
            : frames('1', 'tool.started') + frames('2', 'run.succeeded'),
        );
      }
      return Response.json({ status: 'running' });
    });
    const events = [];
    for await (const event of dashboardRunEvents('https://agents.example.test', 'run', {
      signal: new AbortController().signal,
      connected: vi.fn(),
      fetch: fetcher,
    }))
      events.push(event);
    expect(cursors).toEqual(['0', '1']);
    expect(events.map((event) => event.sequence)).toEqual(['1', '2']);
  });

  it('stops after permanent authorization failures instead of opening another stream', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { message: 'Access revoked' } }, { status: 403 }),
    );
    const events = dashboardRunEvents('https://agents.example.test', 'run', {
      signal: new AbortController().signal,
      connected: vi.fn(),
      fetch: fetcher,
    });
    await expect(events.next()).rejects.toThrow('Access revoked');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
