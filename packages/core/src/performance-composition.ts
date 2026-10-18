import { pool, authPool, credentialPool } from '../../db';
import { observeDatabasePools } from '../../db/diagnostics';
import { PerformanceJsonlSink, privatePerformanceFile } from '../../providers/src/performance-jsonl';
import { isLocal } from './config';
import { capturePerformanceTicket, configurePerformance, profilingConfiguration } from './performance';
let initialized = false;

/** Called at Node process composition, after config's existing env loader.
 * Invalid optional diagnostics must never make serving unavailable. */
export function initializePerformance() {
  if (initialized) return;
  initialized = true;
  try {
    const configuration = profilingConfiguration(process.env);
    if (!configuration) return;
    const directory = process.env.PERF_PROFILING_OUTPUT_DIR;
    if (directory && !isLocal()) throw new Error('Hosted file profiling is unsupported.');
    const destination = directory ? privatePerformanceFile(directory) : process.stdout;
    const collector = configurePerformance({
      ...configuration,
      sink: new PerformanceJsonlSink(destination, !!directory),
    });
    const detach = observeDatabasePools(
      [
        [pool, 'domain'],
        [authPool, 'identity'],
        [credentialPool, 'credential'],
      ],
      capturePerformanceTicket,
      collector.unattributed,
    );
    collector.onClose(detach);
    if (destination instanceof Promise)
      void destination.catch(() => {
        console.warn(JSON.stringify({ code: 'performance_profile_configuration_invalid' }));
        return collector.close();
      });
  } catch {
    console.warn(JSON.stringify({ code: 'performance_profile_configuration_invalid' }));
  }
}
