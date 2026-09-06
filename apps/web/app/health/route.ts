import { pool } from '@platform/db';
import { isLocal, readinessErrors } from '@platform/core/config';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await pool.query('SELECT 1');
    const issues = readinessErrors();
    return Response.json(
      {
        status: issues.length ? 'not_ready' : 'ok',
        mode: isLocal() ? 'local_simulation' : 'production',
        configuration_ready: !issues.length,
      },
      { status: issues.length ? 503 : 200 },
    );
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
