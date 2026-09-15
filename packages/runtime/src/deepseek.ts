import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { HarnessAdapter, HarnessContext, NativeResult } from './types';
import { runNativeBridge } from './native-bridge';
import { permissionAdapters } from '../../contracts/permission-adapters';
import { deepSeekPermissionSettings } from './permission-settings';

export class DeepSeekAdapter implements HarnessAdapter {
  async run(context: HarnessContext): Promise<NativeResult> {
    const { configuration: c, signal } = context;
    const guarded = permissionAdapters.deepseek.translate(c.permissions || []).mode === 'guarded';
    if (guarded && !context.fileTools) throw new Error('Checked file service unavailable.');
    signal.throwIfAborted();
    const home = path.join(c.stateHome, '.runtime-transient/dsh');
    const sessions = path.join(c.stateHome, '.dsh/sessions');
    const resumeId = c.resumeId || `session-${randomUUID().replaceAll('-', '')}`;
    if (!/^session-[a-f0-9]{32}$/.test(resumeId)) throw new Error('Invalid DeepSeek session');
    await mkdir(home, { recursive: true });
    await mkdir(sessions, { recursive: true });
    // The supervisor fixes cwd at /workspace. This is the pinned SDK's project directory.
    if (c.resumeId) await access(path.join(sessions, '--workspace--', resumeId, 'session.v3.jsonl'));
    const patch = path.join(home, 'runtime.json');
    await writeFile(
      patch,
      JSON.stringify([
        { id: 'llm-deepseek', disabled: true },
        { id: 'sdk-jsonrpc-server', disabled: true },
        ...(guarded ? deepSeekPermissionSettings() : []),
        { insert: [{ id: 'platform-driver', name: '/opt/platform/deepseek-bridge.mjs' }] },
        { id: 'sessions', config: { root: sessions, compression: 'none' } },
        {
          id: 'system-prompt',
          config: {
            includeHarnessIdentity: false,
            includeRuntimeContext: false,
            personaPrefix: ['You are a coding agent. Work in the current project.', c.instructions]
              .filter(Boolean)
              .join('\n'),
          },
        },
        {
          insert: [
            ...(context.fileTools
              ? [
                  {
                    id: 'worktree-tools',
                    name: '@deepseek-ai/dsh-mcp-client',
                    config: {
                      serverName: 'worktree',
                      transport: 'streamable-http',
                      url: context.fileTools.url,
                      headers: { Authorization: `Bearer ${context.fileTools.token}` },
                      failOnStartupError: true,
                    },
                  },
                ]
              : []),
            {
              id: 'platform-model',
              name: '@deepseek-ai/dsh-llm-pi-ai',
              config: {
                providers: {
                  platform: {
                    api: 'openai-completions',
                    baseURL: `${c.gatewayURL}/v1`,
                    apiKeyEnv: 'PLATFORM_MODEL_TOKEN',
                    models: [
                      {
                        id: c.model,
                        name: c.model,
                        contextWindow: 128000,
                        maxTokens: 8192,
                        reasoningEfforts: false,
                      },
                    ],
                    retryPolicy: { mode: 'normal', maxRetries: 0 },
                    compat: { supportsStore: false, maxTokensField: 'max_completion_tokens' },
                  },
                },
              },
            },
            ...(c.toolGrants
              ? [
                  {
                    id: 'platform-tools',
                    name: '@deepseek-ai/dsh-mcp-client',
                    config: {
                      serverName: 'platform',
                      transport: 'streamable-http',
                      url: c.toolURL,
                      headers: { Authorization: `Bearer ${c.token}` },
                      failOnStartupError: true,
                    },
                  },
                ]
              : []),
          ],
        },
      ]),
      { mode: 0o600 },
    );
    const bin = fileURLToPath(new URL('lib/bin.js', import.meta.resolve('@deepseek-ai/dsh/package.json')));
    return runNativeBridge(
      'DeepSeek',
      process.execPath,
      [bin, '--profile', 'sdk-minimal', '--patch', patch],
      {
        cwd: c.workspace,
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          HOME: c.stateHome,
          LANG: 'C.UTF-8',
          DSH_HOME: home,
          PLATFORM_MODEL_TOKEN: c.token,
          PLATFORM_SESSION_ID: resumeId,
        },
      },
      context,
    );
  }
}
