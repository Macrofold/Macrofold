import { fileAccess, questionsAllowed } from '../../contracts/permissions';
import type { HarnessAdapter, HarnessContext } from './types';
import { NativeBridge } from './native-bridge';
import { permissionAdapters } from '../../contracts/permission-adapters';

class HermesAdapter implements HarnessAdapter {
  private bridge = new NativeBridge();
  close() {
    this.bridge.close();
  }
  run(context: HarnessContext) {
    const c = context.configuration;
    const guarded = permissionAdapters.hermes.translate(c.permissions || []).mode === 'guarded';
    if (guarded && fileAccess(c.permissions || []).read && !context.fileTools)
      throw new Error('Checked file service unavailable.');
    return this.bridge.run(
      'Hermes',
      '/opt/hermes/.venv/bin/python',
      ['/opt/platform/hermes-bridge.py'],
      {
        cwd: c.workspace,
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          HOME: c.stateHome,
          LANG: 'C.UTF-8',
          HERMES_HOME: `${c.stateHome}/.hermes`,
          // Dependencies are pinned in the image. Provider discovery otherwise
          // attempts optional pip installs on every cold home (even for Bedrock,
          // which is not our gateway route). See runtime.md#native-home-persistence.
          HERMES_DISABLE_LAZY_INSTALLS: '1',
          HERMES_YOLO_MODE: '1',
          TERMINAL_ENV: 'local',
          TERMINAL_CWD: c.workspace,
          PYTHONPATH: '/opt/hermes',
          // Deny-all has no file service, but must still disable native tools.
          PLATFORM_GUARDED: guarded ? '1' : '0',
          PLATFORM_QUESTIONS: questionsAllowed(c.permissions || []) ? '1' : '0',
          ...(context.fileTools
            ? {
                PLATFORM_FILE_TOOL_URL: context.fileTools.url,
                PLATFORM_FILE_TOOL_TOKEN: context.fileTools.token,
              }
            : {}),
        },
      },
      context,
    );
  }
}

export async function createAdapter(): Promise<HarnessAdapter> {
  return new HermesAdapter();
}
