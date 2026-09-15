import type { HarnessAdapter, HarnessContext } from './types';
import { runNativeBridge } from './native-bridge';
import { permissionAdapters } from '../../contracts/permission-adapters';

export class HermesAdapter implements HarnessAdapter {
  run(context: HarnessContext) {
    const c = context.configuration;
    const guarded = permissionAdapters.hermes.translate(c.permissions || []).mode === 'guarded';
    if (guarded && !context.fileTools) throw new Error('Checked file service unavailable.');
    return runNativeBridge(
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
          HERMES_YOLO_MODE: '1',
          TERMINAL_ENV: 'local',
          TERMINAL_CWD: c.workspace,
          PYTHONPATH: '/opt/hermes',
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
