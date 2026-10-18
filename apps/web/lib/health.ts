import { pool } from '@platform/db';
import { isLocal, isSimulated, readinessErrors } from '@platform/core/config';
export async function healthResponse() {
  try {
    await pool.query('SELECT 1');
    const issues = readinessErrors();
    // Self-hosted readiness includes the REST host composition/validators; Vercel
    // routes may run in separate processes. Never invoke an API/model request.
    if (!issues.length && process.env.VERCEL !== '1') {
      const { initializeRestApi } = await import('./rest-api');
      initializeRestApi();
    }
    return Response.json(
      {
        status: issues.length ? 'not_ready' : 'ok',
        mode: isSimulated() ? 'local_simulation' : isLocal() ? 'local_docker' : 'production',
        configuration_ready: !issues.length,
      },
      { status: issues.length ? 503 : 200 },
    );
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
