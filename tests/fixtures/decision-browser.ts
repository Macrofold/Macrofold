import { fixtureAccount } from './account';
import { transaction } from '../../packages/db';
import { config, isLocal } from '../../packages/core/src/config';
import { credit } from '../../packages/core/src/ledger';
import { createKey } from '../../packages/core/src/keys';
import * as resources from '../../packages/core/src/resources';
import { createTask, prepareTaskWake } from '../../packages/core/src/decision-tasks';
import { advanceTask } from '../../packages/core/src/decision-task-engine';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { decisionExample } from '../../examples/decisions/contracts';
import type { Principal } from '../../packages/core/src/auth';

/** Seed a real, completed local decision task for presentation acceptance.
 * Only this process uses fixture transport; the preview and worker remain unpaid. */
export async function decisionBrowserFixture() {
  if (!isLocal() || config.allowPaid)
    throw new Error('Decision browser fixture requires isolated unpaid local configuration');
  const account = await fixtureAccount('Decision browser fixture');
  const p = account.p;
  const originalFetch = globalThis.fetch,
    originalKey = process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = async (url) => {
    if (String(url) !== 'https://api.anthropic.com/v1/messages')
      throw new Error('Unexpected fixture request');
    return Response.json({
      content: [{ type: 'text', text: '"investigate"' }],
      usage: { input_tokens: 100, output_tokens: 10 },
    });
  };
  config.allowPaid = true;
  process.env.ANTHROPIC_API_KEY = 'synthetic-browser';
  try {
    const { app, body, task } = await transaction(p.organizationId, async (tx) => {
      await credit(tx, p.organizationId, 1000000n, 'decision-browser');
      const workspace = await resources.create(tx, 'workspaces', p.organizationId, {
        name: 'Decision browser workspace',
      });
      const key = await createKey(tx, p, {
        name: 'Application',
        workspace_id: workspace.id,
        scopes: ['runs:read', 'runs:write', 'files:read', 'files:write'],
      });
      const app: Principal = {
        ...p,
        id: key.id,
        kind: 'api_key',
        workspaceIds: [workspace.id],
        scopes: key.scopes,
      };
      const body = decisionExample(workspace.id, 'triage');
      const task = await createTask(tx, app, {
        workspace_id: workspace.id,
        objective: 'Review a customer exception',
        decide: { definition: body.definition, model_binding: body.model_binding },
        max_cost_micro_usd: '40000',
        max_runs: 2,
        evidence_horizon_seconds: 3600,
      });
      return { app, body, task };
    });
    const preparation = await prepareTaskWake(app, task.id, {
      event_id: 'case-7',
      input: body.input,
      context: body.context,
    });
    const awakened = await transaction(p.organizationId, (tx) => preparation.commit(tx, app));
    await preparation.dispose();
    const runId = awakened.runs[0].run_id;
    for (let i = 0; i < 5; i++) if ((await advanceInference(p.organizationId, runId)).done) break;
    await advanceTask(p.organizationId, task.id);
    return { email: p.email!, password: 'local-fixture-password-2026', runId, taskId: task.id };
  } finally {
    globalThis.fetch = originalFetch;
    config.allowPaid = false;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
}
