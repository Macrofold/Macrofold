import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { components } from '../../packages/contracts/api';
import { test, expect, fixtureOrigin } from '../fixtures/browser';

type Schema = components['schemas'];
const deploymentId = '019e1700-0000-7000-8000-000000000021';
const revisionId = '019e1700-0000-7000-8000-000000000022';
const priorRevisionId = '019e1700-0000-7000-8000-000000000023';
const connectionId = '019e1700-0000-7000-8000-000000000024';
const workspaceId = '019e1700-0000-7000-8000-000000000025';
const apiKeyId = '019e1700-0000-7000-8000-000000000026';
const grantId = '019e1700-0000-7000-8000-000000000027';
const timestamp = '2026-10-22T12:00:00Z';
const capabilities: Schema['ModelDeploymentCapabilities'] = {
  protocol: 'openai_chat',
  input_modalities: ['text'],
  chat_completions: true,
  json_object: false,
  json_schema: false,
  tools: false,
  streaming: true,
  stream_usage: true,
  schema_keywords: [],
  accepted_parameters: ['temperature', 'max_tokens'],
  schema_dialect: null,
  context_window_tokens: 8192,
  max_output_tokens: 2048,
  max_concurrent_requests: 2,
};
function revision(id = revisionId): Schema['ModelDeploymentRevision'] {
  return {
    deployment_id: deploymentId,
    deployment_revision_id: id,
    created_at: timestamp,
    source: { kind: 'external', repository: null, revision: null, capabilities },
    runtime: { kind: 'external', engine: null, version: null },
    hosting: {
      kind: 'external_openai',
      endpoint_connection_id: connectionId,
      model_alias: 'fixture-model',
      lifecycle: 'external',
      external_hosting_acknowledged: true,
    },
    capabilities,
  };
}
function deployment(): Schema['ModelDeployment'] {
  return {
    id: deploymentId,
    deployment_id: deploymentId,
    name: 'Synthetic model service',
    can_manage: true,
    desired_state: 'stopped',
    desired_revision_id: revisionId,
    serving_revision_id: null,
    state: 'stopped',
    admission_open: false,
    capabilities: null,
    policy: { max_concurrent_requests: 2, stop_at: null },
    ready_replicas: null,
    observed_at: timestamp,
    cost_policy: { basis: 'deployment', request_charge_micro_usd: '0', infrastructure_cost_included: false },
    infrastructure_cost: {
      period_start: null,
      period_end: null,
      estimated_micro_usd: null,
      provider_reported_micro_usd: null,
      status: 'external_unknown',
      as_of: null,
      unresolved_liability: false,
    },
    failure_code: null,
    retired: false,
    created_at: timestamp,
    updated_at: timestamp,
  };
}
async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
}

test('shows exact owned cleanup resources and keeps recovery controls off recipient views', async ({
  page,
}) => {
  await signIn(page);
  let current: Schema['ModelDeployment'] = {
    ...deployment(),
    state: 'cleanup_pending',
    failure_code: 'provider_cleanup_unconfirmed',
    resources: [
      {
        resource_id: connectionId,
        provider_id: 'synthetic-owned-endpoint',
        attempt_id: grantId,
        deployment_revision_id: revisionId,
        state: 'cleanup_pending',
        created_at: timestamp,
        deleted_at: null,
      },
    ],
  };
  let administrativeReads = 0;
  await page.route('**/v1/model-deployments/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/revisions') || path.endsWith('/grants')) {
      administrativeReads++;
      return route.fulfill({ json: { data: [], next_cursor: null } });
    }
    if (path.endsWith(`/revisions/${revisionId}`)) {
      administrativeReads++;
      return route.fulfill({ json: revision() });
    }
    return route.fulfill({ json: current });
  });
  await page.goto(`/model-deployments/${deploymentId}`);
  const resources = page.getByRole('region', { name: 'Owned hosting resources', exact: true });
  await expect(resources).toContainText('stop or delete the identified resource there');
  await resources.locator('summary').click();
  await expect(resources).toContainText('synthetic-owned-endpoint');
  await expect(resources).toContainText(grantId);
  await expect(
    resources.getByRole('button', { name: 'Copy provider resource ID', exact: true }),
  ).toBeVisible();
  await expect(resources.getByRole('button', { name: 'Copy hosting attempt ID', exact: true })).toBeVisible();
  await expect.poll(() => administrativeReads).toBeGreaterThan(0);
  const beforeRecipient = administrativeReads;
  const { resources: _ownedResources, ...recipient } = current;
  current = { ...recipient, can_manage: false };
  await page.reload();
  await expect(page.getByRole('heading', { name: current.name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Owned hosting resources', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Model revisions', exact: true })).toHaveCount(0);
  expect(administrativeReads).toBe(beforeRecipient);
});

test('shows loading, empty and denied states with retry and prevents creating without management scope', async ({
  page,
}) => {
  await signIn(page);
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending: Promise<void>[] = [];
  await page.route('**/v1/model-deployments?**', (route) => {
    const handler = (async () => {
      await barrier;
      await route.fulfill({ json: { data: [], next_cursor: null } });
    })();
    pending.push(handler);
    return handler;
  });
  await page.goto('/model-deployments');
  try {
    await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible();
  } finally {
    release();
    await Promise.all(pending);
  }
  await expect(page.getByRole('heading', { name: 'No model deployments', exact: true })).toBeVisible();
  const create = page.getByRole('button', { name: 'Create deployment', exact: true });
  await expect(create).toBeEnabled();
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Create model deployment', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Create model deployment', exact: true })).toHaveCount(0);
  await expect(create).toBeFocused();
  await page.unroute('**/v1/model-deployments?**');
  await page.route('**/v1/model-deployments?**', (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'permission_denied',
          message: 'Deployment access denied.',
          request_id: 'fixture',
          retryable: false,
        },
      },
    }),
  );
  await page.route('**/v1/me', async (route) => {
    const response = await route.fetch();
    const identity = (await response.json()) as Schema['Identity'];
    await route.fulfill({
      json: {
        ...identity,
        effective_scopes: identity.effective_scopes.filter((scope) => scope !== 'model-deployments:write'),
      },
    });
  });
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Deployment access denied.');
  await expect(page.getByRole('button', { name: 'Create deployment', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('model-deployment-access-error.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({
    path: test.info().outputPath('model-deployment-access-error-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('applies revision rollback, preserves pending readiness, grants/revokes access and describes external stop honestly', async ({
  page,
}) => {
  await signIn(page);
  let current = deployment();
  let grants: Schema['ModelDeploymentGrant'][] = [];
  const serviceInputs: Schema['ModelDeploymentServiceInput'][] = [];
  const grantInputs: Schema['ModelDeploymentGrantInput'][] = [];
  await page.route('**/v1/model-deployments/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/revisions'))
      return route.fulfill({ json: { data: [revision(), revision(priorRevisionId)], next_cursor: null } });
    if (url.pathname.endsWith('/service')) {
      const input = route.request().postDataJSON() as Schema['ModelDeploymentServiceInput'];
      serviceInputs.push(input);
      current = {
        ...current,
        desired_state: input.desired_state,
        desired_revision_id: input.deployment_revision_id,
        policy: input.policy,
        state: input.desired_state === 'running' ? 'starting' : 'stopping',
        admission_open: false,
      };
      return route.fulfill({ status: 202, json: current });
    }
    if (url.pathname.endsWith(`/grants/${grantId}`)) {
      grants = grants.map((grant) => ({ ...grant, revoked_at: timestamp }));
      return route.fulfill({ json: grants[0] });
    }
    if (url.pathname.endsWith('/grants')) {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON() as Schema['ModelDeploymentGrantInput'];
        grantInputs.push(input);
        grants = [
          {
            ...input,
            grant_id: grantId,
            deployment_id: deploymentId,
            created_at: timestamp,
            revoked_at: null,
          },
        ];
        return route.fulfill({ status: 201, json: grants[0] });
      }
      return route.fulfill({ json: { data: grants, next_cursor: null } });
    }
    return route.fulfill({ json: current });
  });
  await page.route('**/v1/api-keys?**', (route) =>
    route.fulfill({
      json: { data: [{ id: apiKeyId, name: 'Game backend', revoked_at: null }], next_cursor: null },
    }),
  );
  await page.route('**/v1/workspaces?**', (route) =>
    route.fulfill({ json: { data: [{ id: workspaceId, name: 'Synthetic game' }], next_cursor: null } }),
  );
  await page.goto(`/model-deployments/${deploymentId}`);
  await expect(page.getByRole('heading', { name: 'Synthetic model service', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Infrastructure costs' })).toContainText('Estimate: Unknown');
  await page.getByRole('button', { name: 'Start service', exact: true }).click();
  const service = page.getByRole('dialog', { name: 'Operating policy and revision' });
  await service.getByRole('combobox', { name: 'Serving revision', exact: true }).click();
  await page.getByRole('option', { name: priorRevisionId, exact: true }).click();
  await service.getByLabel('Maximum concurrent requests', { exact: true }).fill('1');
  await service.getByRole('checkbox').check();
  await service.getByRole('button', { name: 'Apply and start service' }).click();
  await expect(service).toHaveCount(0);
  expect(serviceInputs).toEqual([
    {
      deployment_revision_id: priorRevisionId,
      desired_state: 'running',
      policy: { max_concurrent_requests: 1, stop_at: null },
    },
  ]);
  await expect(page.getByRole('region', { name: 'Service status' })).toContainText('starting');
  await expect(page.getByRole('region', { name: 'Service status' })).toContainText('New requests closed');

  const access = page.getByRole('region', { name: 'Application access', exact: true });
  await access.getByRole('combobox', { name: 'API key', exact: true }).click();
  await page.getByRole('option', { name: 'Game backend', exact: true }).click();
  await access.getByRole('checkbox', { name: 'Synthetic game', exact: true }).check();
  await access.getByRole('button', { name: 'Grant application access', exact: true }).click();
  await expect(access.getByRole('button', { name: `Revoke grant ${grantId}`, exact: true })).toBeVisible();
  expect(grantInputs).toEqual([
    {
      subject: { kind: 'api_key', api_key_id: apiKeyId },
      workspace_scope: { kind: 'selected', workspace_ids: [workspaceId] },
    },
  ]);
  await access.getByRole('button', { name: `Revoke grant ${grantId}`, exact: true }).click();
  await expect(access).toContainText('Revoked');

  await page.getByRole('button', { name: 'Stop service', exact: true }).click();
  const stop = page.getByRole('dialog', { name: 'Stop model service', exact: true });
  await expect(stop).toContainText(
    'You must stop externally operated infrastructure and its billing yourself.',
  );
  await stop.getByRole('button', { name: 'Confirm stop', exact: true }).click();
  await expect(stop).toHaveCount(0);
  expect(serviceInputs[1]).toEqual({
    deployment_revision_id: priorRevisionId,
    desired_state: 'stopped',
    policy: { max_concurrent_requests: 1, stop_at: null },
  });
  await expect(page.getByRole('region', { name: 'Service status' })).toContainText('stopping');
  await page.screenshot({ path: test.info().outputPath('model-deployment-status.png'), fullPage: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    audit.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.failureSummary) })),
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({
    path: test.info().outputPath('model-deployment-status-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('loads an older desired revision directly without scanning paginated history', async ({ page }) => {
  await signIn(page);
  const current = { ...deployment(), desired_revision_id: priorRevisionId };
  const recent = Array.from({ length: 25 }, (_, index) =>
    revision(`019e1700-0000-7000-8000-${String(index + 100).padStart(12, '0')}`),
  );
  const revisionReads: string[] = [];
  const serviceInputs: Schema['ModelDeploymentServiceInput'][] = [];
  await page.route('**/v1/model-deployments/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/revisions')) {
      revisionReads.push(url.pathname + url.search);
      return route.fulfill({ json: { data: recent, next_cursor: revisionId } });
    }
    if (url.pathname.endsWith(`/revisions/${priorRevisionId}`)) {
      revisionReads.push(url.pathname);
      return route.fulfill({ json: revision(priorRevisionId) });
    }
    if (url.pathname.endsWith('/service')) {
      serviceInputs.push(route.request().postDataJSON() as Schema['ModelDeploymentServiceInput']);
      return route.fulfill({ status: 202, json: current });
    }
    if (url.pathname.endsWith('/grants')) return route.fulfill({ json: { data: [], next_cursor: null } });
    return route.fulfill({ json: current });
  });
  await page.goto(`/model-deployments/${deploymentId}`);
  await expect(page.getByRole('button', { name: 'Create revision', exact: true })).toBeEnabled();
  expect(revisionReads).toEqual([
    `/v1/model-deployments/${deploymentId}/revisions?limit=25`,
    `/v1/model-deployments/${deploymentId}/revisions/${priorRevisionId}`,
  ]);
  await page.getByRole('button', { name: 'Start service', exact: true }).click();
  const service = page.getByRole('dialog', { name: 'Operating policy and revision' });
  await expect(service.getByRole('combobox', { name: 'Serving revision', exact: true })).toContainText(
    priorRevisionId,
  );
  await service.getByRole('checkbox').check();
  await service.getByRole('button', { name: 'Apply and start service' }).click();
  await expect(service).toHaveCount(0);
  expect(serviceInputs).toEqual([
    {
      deployment_revision_id: priorRevisionId,
      desired_state: 'running',
      policy: current.policy,
    },
  ]);
});

for (const protocol of ['openai_chat', 'systemone'] as const)
  test(`creates a stopped ${protocol} deployment and a revision through the actual application API`, async ({
    page,
  }) => {
    await signIn(page);
    const identityResponse = await page.request.get('/v1/me');
    const identity = (await identityResponse.json()) as Schema['Identity'];
    const connectionResponse = await page.request.post('/v1/connections', {
      headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
      data: {
        name: `Browser external ${randomUUID()}`,
        kind: 'external_model',
        provider: 'openai',
        auth_method: 'bearer',
        secret: 'synthetic-not-a-provider-secret',
        url: `${fixtureOrigin}/model-fixture/v1`,
      },
    });
    expect(connectionResponse.ok()).toBeTruthy();
    const connection = (await connectionResponse.json()) as Schema['Connection'];
    let createdId: string | undefined;
    try {
      await page.goto('/connections');
      const connectionCard = page
        .locator('.connection-card')
        .filter({ has: page.getByRole('heading', { name: connection.name, exact: true }) });
      await connectionCard.getByRole('button', { name: `Edit ${connection.name}`, exact: true }).click();
      const connectionSettings = page.getByRole('dialog', { name: 'Edit connection', exact: true });
      const replacement = connectionSettings.getByLabel('Replacement account or endpoint token (optional)', {
        exact: true,
      });
      await expect(replacement).toHaveAttribute('type', 'password');
      await replacement.fill('synthetic-rotated-endpoint-token');
      const rotation = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/v1/connections/${connection.id}`) &&
          response.request().method() === 'PATCH',
      );
      await connectionSettings.getByRole('button', { name: 'Save connection', exact: true }).click();
      expect((await rotation).ok()).toBeTruthy();
      await expect(connectionSettings).toHaveCount(0);
      await expect(connectionCard).not.toContainText('synthetic-rotated-endpoint-token');
      await page.goto('/model-deployments');
      await page.getByRole('button', { name: 'Create deployment', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Create model deployment', exact: true });
      const name = `Browser model ${randomUUID()}`;
      await form.getByLabel('Deployment name', { exact: true }).fill(name);
      await form.getByRole('combobox', { name: 'Hosting', exact: true }).click();
      await page.getByRole('option', { name: 'Use an existing model endpoint', exact: true }).click();
      if (protocol === 'systemone') {
        await form.getByRole('combobox', { name: 'Endpoint protocol', exact: true }).click();
        await page.getByRole('option', { name: 'SystemOne decisions (Kev / Jev)', exact: true }).click();
        await expect(form).toContainText('Send state and named questions');
        await expect(form.getByRole('checkbox', { name: 'Streaming', exact: true })).toHaveCount(0);
      }
      await form.getByRole('combobox', { name: 'External endpoint', exact: true }).click();
      await page.getByRole('option', { name: new RegExp(`^${connection.name} ·`) }).click();
      await form.getByLabel('Served model alias', { exact: true }).fill('fixture-model');
      await form.getByLabel('Context capacity (tokens)', { exact: true }).fill('16384');
      await form.getByLabel('Maximum output (tokens)', { exact: true }).fill('1024');
      await form.getByLabel('Runtime concurrency', { exact: true }).fill('3');
      await form.getByRole('checkbox', { name: /I operate and pay for this host separately/ }).check();
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/v1/model-deployments') && response.request().method() === 'POST',
      );
      await form.getByRole('button', { name: 'Create deployment', exact: true }).click();
      const response = await created;
      expect(response.status()).toBe(201);
      const result = (await response.json()) as Schema['ModelDeployment'];
      createdId = result.deployment_id;
      expect(result).toMatchObject({ state: 'stopped', desired_state: 'stopped', admission_open: false });
      expect(response.request().postDataJSON()).toMatchObject({
        hosting: { kind: protocol === 'systemone' ? 'external_systemone' : 'external_openai' },
        source: { capabilities: { protocol } },
      });
      await expect(form).toHaveCount(0);
      await page.goto(`/model-deployments/${createdId}`);
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Application access' })).toContainText(
        'No application grants',
      );
      await page.getByRole('button', { name: 'Create revision', exact: true }).click();
      const change = page.getByRole('dialog', { name: 'Create model revision', exact: true });
      await expect(change.getByRole('combobox', { name: 'Endpoint protocol', exact: true })).toContainText(
        protocol === 'systemone' ? 'SystemOne decisions (Kev / Jev)' : 'OpenAI-compatible chat',
      );
      await expect(change.getByLabel('Context capacity (tokens)', { exact: true })).toHaveValue('16384');
      await expect(change.getByLabel('Maximum output (tokens)', { exact: true })).toHaveValue('1024');
      await expect(change.getByLabel('Runtime concurrency', { exact: true })).toHaveValue('3');
      await change.getByLabel('Served model alias', { exact: true }).fill('fixture-model-updated');
      await change.getByRole('checkbox', { name: /I operate and pay for this host separately/ }).check();
      const revised = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/v1/model-deployments/${createdId}/revisions`) &&
          response.request().method() === 'POST',
      );
      await change.getByRole('button', { name: 'Create revision', exact: true }).click();
      const revisionResponse = await revised;
      expect(revisionResponse.status()).toBe(201);
      const savedRevision = (await revisionResponse.json()) as Schema['ModelDeploymentRevision'];
      expect(savedRevision.capabilities).toMatchObject({
        protocol,
        context_window_tokens: 16384,
        max_output_tokens: 1024,
        max_concurrent_requests: 3,
      });
      if (protocol === 'systemone')
        expect(savedRevision.capabilities).toMatchObject({
          chat_completions: false,
          streaming: false,
          tools: false,
          accepted_parameters: ['state', 'questions'],
        });
      await expect(change).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Model revisions' })).toContainText(
        'fixture-model-updated',
      );
      expect(identity.user_id).toBeTruthy();
    } finally {
      if (createdId)
        await page.request.delete(`/v1/model-deployments/${createdId}`, {
          headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
        });
      await page.request.delete(`/v1/connections/${connection.id}`, {
        headers: { Origin: fixtureOrigin, 'Idempotency-Key': randomUUID() },
      });
    }
  });

for (const task of ['decision', 'text_generation'] as const) {
  test(`inspects ${task} without stale findings and saves the selected immutable runtime`, async ({
    page,
  }) => {
    await signIn(page);
    const profileId = task === 'decision' ? 'kev-systemone-v1' : 'vllm-0.32.0-text';
    const identityResponse = await page.request.get('/v1/me');
    const identity = (await identityResponse.json()) as Schema['Identity'];
    const inputBodies: Schema['ModelDeploymentCreate'][] = [];
    let release: () => void = () => {};
    const firstInspection = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstCompleted: Promise<void> | undefined;
    let inspections = 0;
    await page.route('**/v1/connections?**', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: connectionId,
              name: 'Owner RunPod fixture',
              kind: 'runpod',
              owner_subject_id: identity.user_id,
              status: 'healthy',
            },
          ],
          next_cursor: null,
        },
      }),
    );
    await page.route('**/v1/model-deployments?**', (route) =>
      route.fulfill({ json: { data: [], next_cursor: null } }),
    );
    await page.route('**/v1/model-deployments/inspect', (route) => {
      inspections += 1;
      const body = route.request().postDataJSON() as Schema['ModelDeploymentInspectionInput'];
      expect(body.task).toBe(task);
      const result: Schema['ModelDeploymentInspection'] = {
        supported: true,
        findings: [],
        source: { ...body.source, revision: 'a'.repeat(40) },
        runtime_profiles: [
          {
            profile_id: profileId,
            image: `registry.example/model@sha256:${'b'.repeat(64)}`,
            parameters: { context_window_tokens: 8192, max_output_tokens: 2048, max_concurrent_requests: 1 },
            capabilities:
              task === 'decision'
                ? {
                    ...capabilities,
                    protocol: 'systemone',
                    chat_completions: false,
                    streaming: false,
                    stream_usage: false,
                    accepted_parameters: ['state', 'questions'],
                  }
                : capabilities,
          },
        ],
        hosting_options: [
          {
            gpu_pool_id: 'fixture-pool',
            name: 'Fixture GPU',
            memory_bytes: '24000000000',
            hourly_cost_micro_usd: '1000000',
            region_ids: [],
          },
        ],
        memory_estimate_bytes: '8000000000',
        license: 'apache-2.0',
        license_acknowledgement_required: true,
      };
      const pending = (async () => {
        if (inspections === 1) await firstInspection;
        await route.fulfill({ json: result });
      })();
      firstCompleted ??= pending;
      return pending;
    });
    await page.route('**/v1/model-deployments', (route) => {
      inputBodies.push(route.request().postDataJSON() as Schema['ModelDeploymentCreate']);
      return route.fulfill({ status: 201, json: deployment() });
    });
    await page.goto('/model-deployments');
    await page.getByRole('button', { name: 'Create deployment', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Create model deployment', exact: true });
    if (task === 'text_generation') {
      await form.getByRole('combobox', { name: 'Model task', exact: true }).click();
      await page.getByRole('option', { name: 'Chat generation', exact: true }).click();
    }
    await form.locator('summary').filter({ hasText: 'Model and runtime settings' }).click();
    await expect(form.getByLabel('Tool call parser (optional)', { exact: true })).toHaveCount(
      task === 'decision' ? 0 : 1,
    );
    await form.getByLabel('Deployment name', { exact: true }).fill('Managed fixture');
    await form.getByLabel('Hugging Face model', { exact: true }).fill('fixture/first');
    await form.getByRole('combobox', { name: 'RunPod account', exact: true }).click();
    await page.getByRole('option', { name: 'Owner RunPod fixture · healthy', exact: true }).click();
    try {
      await form.getByRole('button', { name: 'Inspect compatibility and hosting', exact: true }).click();
      await expect.poll(() => inspections).toBe(1);
      await form.getByLabel('Hugging Face model', { exact: true }).fill('fixture/reviewed');
    } finally {
      release();
      await firstCompleted;
    }
    await expect(
      form.getByRole('button', { name: 'Inspect compatibility and hosting', exact: true }),
    ).toBeEnabled();
    await expect(
      form.getByRole('heading', { name: 'Compatible serving configuration', exact: true }),
    ).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Create deployment', exact: true })).toBeDisabled();
    await form.getByRole('button', { name: 'Inspect compatibility and hosting', exact: true }).click();
    await expect(
      form.getByRole('heading', { name: 'Compatible serving configuration', exact: true }),
    ).toBeVisible();
    await form.getByLabel('GPU pool IDs', { exact: true }).fill('fixture-pool');
    if (task === 'text_generation') await form.getByLabel('GPU count per replica', { exact: true }).fill('2');
    else
      await expect(form.getByLabel('GPU count per replica', { exact: true })).toHaveAttribute('readonly', '');
    await expect(form).toContainText(
      task === 'decision'
        ? 'Selected hardware estimate per active replica (1 GPU): $1.00/hour · $24.00/day · $720.00/30 days'
        : 'Selected hardware estimate per active replica (2 GPUs): $2.00/hour · $48.00/day · $1,440.00/30 days',
    );
    await expect(form).toContainText('Storage, data transfer and other provider charges are additional');
    await page.screenshot({
      path: test.info().outputPath('model-deployment-managed-setup.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await expect
      .poll(() => form.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('model-deployment-managed-setup-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await form.getByRole('checkbox', { name: /I have reviewed and accept this model/ }).check();
    await form.getByRole('button', { name: 'Create deployment', exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(inputBodies).toHaveLength(1);
    expect(inputBodies[0]).toMatchObject({
      source: {
        kind: 'hugging_face',
        repository: 'fixture/reviewed',
        revision: 'a'.repeat(40),
        license_acknowledged: true,
      },
      runtime: { profile_id: profileId, parameters: { dtype: task === 'decision' ? 'bfloat16' : 'auto' } },
      access: { grants: [] },
      hosting: {
        kind: 'runpod_serverless',
        compute_connection_id: connectionId,
        placement: { gpu_pool_ids: ['fixture-pool'], gpu_count: task === 'decision' ? 1 : 2 },
      },
    });
  });
}
