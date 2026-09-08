import { getExecutionPolicy, planFor } from './plans';
import { authorizeRepository, githubInstallations, githubRepositories, githubManager } from './github-auth';
import { queueGitSync } from './git-jobs';
import * as r from './resources';
import * as files from './files';
import * as runs from './runs';
import * as connections from './connections';
import * as transfers from './transfers';
import * as reports from './reports';
import * as payments from './billing';
import { disconnectConnection } from './connection-cleanup';
import { createKey, presentKey } from './keys';
import { isSimulated } from './config';
import { id, token, seal } from './crypto';
import { assert } from './errors';
import { harnesses, models } from './catalog';
import { listConnectorCatalog } from './connector-catalog';
import { connectorCatalogSource } from '../../providers/src/connector-catalog';
import { publicEvent } from './events';
import { readContent } from '../../providers/src/storage';
import { validatePublicURL } from '../../providers/src/network';
import { input, type Handler, type Context } from './api-types';
import { createTwoFilesPatch } from 'diff';
import { exportCheckpoint } from './exports';
import { stdioCatalog } from './stdio-catalog';
import * as organizations from './organizations';
import { storageReport } from './storage-maintenance';
import { requestProjectDeletion, cancelProjectDeletion } from './deletion';
import * as triggers from './triggers';
import * as triggerDeliveries from './trigger-deliveries';

const list =
  (table: r.Table, filter: (c: Context) => Record<string, unknown> = () => ({})): Handler =>
  async (c) =>
    r.list(c.tx, table, c.p, c.query, filter(c));
const get =
  (table: r.Table, param: string): Handler =>
  async (c) =>
    r.get(c.tx, table, c.params[param], c.p);
const mutation =
  (table: r.Table, param: string): Handler =>
  async (c) => {
    await r.get(c.tx, table, c.params[param], c.p);
    return r.update(c.tx, table, c.params[param], c.body as Record<string, unknown>);
  };
const page = (data: unknown[]) => ({ data, next_cursor: null });
export const capabilities = {
  api_version: 'v1',
  minimum_cli_version: '0.1.0',
  recommended_cli_version: '0.1.0',
  features: ['streaming', 'sessions', 'workspaces', 'transfers', 'checkpoint_exports'],
  stream_rotation_seconds: 55,
  max_transfer_files: 1000,
  max_transfer_bytes: 262144000,
  max_file_bytes: 26214400,
};
export const handlers: Record<string, Handler> = {
  listTriggers: (c) => triggers.listTriggers(c.tx, c.p, c.query),
  createTrigger: (c) => triggers.saveTrigger(c.tx, c.p, input<'TriggerCreate'>(c)),
  getTrigger: async (c) => triggers.presentTrigger(await triggers.getTrigger(c.tx, c.p, c.params.trigger_id)),
  updateTrigger: (c) => triggers.patchTrigger(c.tx, c.p, c.params.trigger_id, input<'TriggerPatch'>(c)),
  deleteTrigger: (c) => triggers.deleteTrigger(c.tx, c.p, c.params.trigger_id),
  rotateTriggerSecret: (c) => triggers.rotateTriggerSecret(c.tx, c.p, c.params.trigger_id),
  listTriggerDeliveries: (c) =>
    triggerDeliveries.listTriggerDeliveries(c.tx, c.p, c.params.trigger_id, c.query),
  runTrigger: (c) => triggerDeliveries.runTriggerNow(c.tx, c.p, c.params.trigger_id, c.idempotencyKey),
  retryTriggerReply: (c) =>
    triggerDeliveries.retryTriggerReply(c.tx, c.p, c.params.trigger_id, c.params.delivery_id),
  listSlackConnections: (c) => triggers.listSlackConnections(c.tx, c.p),
  createSlackConnection: (c) => triggers.saveSlackConnection(c.tx, c.p, input<'SlackConnectionCreate'>(c)),
  deleteSlackConnection: (c) => triggers.disconnectSlack(c.tx, c.p, c.params.connection_id),
  listSlackConnectionChannels: (c) =>
    triggers.listSlackChannels(c.tx, c.p, c.params.connection_id, c.query.get('cursor') || undefined),
  listConnectorCatalog: () =>
    listConnectorCatalog(connectorCatalogSource(), {
      enabled:
        Boolean(process.env.COMPOSIO_API_KEY) &&
        process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED === 'true',
      authConfigs: process.env.COMPOSIO_AUTH_CONFIGS_JSON,
      versions: process.env.COMPOSIO_TOOLKIT_VERSIONS_JSON,
    }),
  scheduleProjectDeletion: (c) =>
    requestProjectDeletion(c.tx, c.p, c.params.project_id, input<'ProjectDeletion'>(c), c.request),
  cancelProjectDeletion: (c) => cancelProjectDeletion(c.tx, c.p, c.params.project_id),
  getStorage: (c) => storageReport(c.tx, c.p.organizationId),
  updateStoragePolicy: async (c) => {
    organizations.organizationManager(c.p);
    const value = input<'StoragePolicy'>(c);
    await c.tx.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [c.p.organizationId]);
    await c.tx.query(
      'UPDATE organizations SET settings=settings||$2::jsonb,storage_due_at=now() WHERE id=$1',
      [
        c.p.organizationId,
        JSON.stringify({
          storage_overage_enabled: value.overage_enabled,
          storage_monthly_budget_micro_usd: value.monthly_budget_micro_usd,
        }),
      ],
    );
    await c.tx.query('INSERT INTO storage_state(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [
      c.p.organizationId,
    ]);
    await c.tx.query(
      'UPDATE storage_state SET billing_at=now(),billing_remainder=0 WHERE organization_id=$1',
      [c.p.organizationId],
    );
    await c.tx.query(
      `UPDATE organizations o SET settings=settings||jsonb_build_object('storage_over_quota',
      s.physical_bytes>$4::bigint AND
      (NOT $2::boolean OR $3::bigint<=coalesce((SELECT sum(charged_micro_usd) FROM storage_usage WHERE observed_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0) OR o.balance_micro_usd<=o.reserved_micro_usd))
      FROM storage_state s WHERE o.id=$1 AND s.organization_id=o.id`,
      [
        c.p.organizationId,
        value.overage_enabled,
        value.monthly_budget_micro_usd,
        String(
          planFor(
            (await c.tx.query('SELECT plan FROM organizations WHERE id=$1', [c.p.organizationId])).rows[0]
              .plan,
          ).storage_gib *
            1024 ** 3,
        ),
      ],
    );
    return storageReport(c.tx, c.p.organizationId);
  },
  getExecutionPolicy: async (c) => {
    assert(!c.p.projectIds.length, 403, 'forbidden', 'Use an unrestricted organization credential.');
    return getExecutionPolicy(c.tx, c.p.organizationId);
  },
  updateExecutionPolicy: (c) =>
    organizations.updateExecutionPolicy(c.tx, c.p, input<'ExecutionPolicyPatch'>(c)),
  createOrganization: (c) => organizations.createOrganization(c.tx, c.p, input<'OrganizationCreate'>(c).name),
  updateOrganization: async (c) => {
    organizations.organizationManager(c.p);
    return (
      await c.tx.query('UPDATE organizations SET name=$2 WHERE id=$1 RETURNING id,name', [
        c.p.organizationId,
        input<'OrganizationCreate'>(c).name,
      ])
    ).rows[0];
  },
  listMembers: (c) => organizations.listMembers(c.tx, c.p),
  updateMember: (c) => organizations.changeMember(c.tx, c.p, c.params.user_id, input<'MemberPatch'>(c).role),
  removeMember: (c) => organizations.changeMember(c.tx, c.p, c.params.user_id),
  createInvitation: (c) => {
    const value = input<'InvitationCreate'>(c);
    return organizations.inviteMember(c.tx, c.p, value.email, value.role);
  },
  listInvitations: async (c) => {
    organizations.organizationManager(c.p);
    return page(
      (
        await c.tx.query(
          'SELECT id,email,role,created_at,expires_at,accepted_at,revoked_at FROM organization_invitations WHERE expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC',
        )
      ).rows,
    );
  },
  revokeInvitation: async (c) => {
    organizations.organizationManager(c.p);
    const result = await c.tx.query(
      'UPDATE organization_invitations SET revoked_at=now() WHERE id=$1 RETURNING id',
      [c.params.invitation_id],
    );
    assert(result.rowCount, 404, 'not_found', 'Invitation not found.');
  },
  listOrganizationAudit: async (c) => {
    organizations.organizationManager(c.p);
    return page(
      (
        await c.tx.query(
          'SELECT id,actor_id,action,subject_id,data,created_at FROM organization_audit ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
    );
  },
  listStdioPackages: async () =>
    page(
      stdioCatalog().map(({ package: pkg, version, label, environment_keys, tools }) => ({
        package: pkg,
        version,
        label,
        environment_keys,
        tools: tools.map((t) => t.name),
      })),
    ),
  exportCheckpoint: async (c) =>
    exportCheckpoint(c.tx, c.p, c.params.checkpoint_id, input<'CheckpointExportRequest'>(c).format),
  listProjects: list('projects'),
  getProject: get('projects', 'project_id'),
  listGithubInstallations: (c) => githubInstallations(c.tx, c.p),
  listGithubRepositories: (c) => githubRepositories(c.tx, c.p, c.query.get('installation_id')!),
  updateProject: async (c) => {
    const existing = await r.get(c.tx, 'projects', c.params.project_id, c.p);
    const body = input<'ProjectPatch'>(c);
    assert(
      !existing.deletion_due_at || body.archived !== false,
      409,
      'deletion_pending',
      'Cancel the pending deletion before restoring this project.',
    );
    if (body.github) {
      githubManager(c.p);
      const connected = existing.github as { installation_id: string; repository_id: string } | undefined;
      if (connected)
        assert(
          connected.installation_id === body.github.installation_id &&
            connected.repository_id === body.github.repository_id,
          409,
          'github_already_connected',
          'Disconnect the current repository before selecting another.',
        );
      else await authorizeRepository(c.tx, c.p, body.github);
      const { branchName } = await import('../../providers/src/git-repository');
      branchName(body.github.target_branch);
    }
    const result = await r.update(
      c.tx,
      'projects',
      existing.id,
      body,
      c.request.headers.get('if-match')?.replaceAll('"', ''),
    );
    if (body.github && !existing.github && existing.default_workspace_id)
      await queueGitSync(c.tx, c.p, String(existing.default_workspace_id), 'pull');
    return result;
  },
  disconnectGithub: async (c) => {
    const { githubManager } = await import('./github-auth');
    githubManager(c.p);
    await r.get(c.tx, 'projects', c.params.project_id, c.p);
    return r.update(c.tx, 'projects', c.params.project_id, { github: null });
  },
  createProject: async (c) => {
    assert(
      !c.p.projectIds.length,
      403,
      'forbidden',
      'A project-restricted key cannot create unrelated projects.',
    );
    const value = input<'ProjectCreate'>(c);
    if (value.github) await authorizeRepository(c.tx, c.p, value.github);
    const project = await r.create(c.tx, 'projects', c.p.organizationId, {
      ...value,
      persistence: value.persistence || 'persistent',
      archived: false,
      storage_bytes: '0',
    });
    await files.createWorkspace(c.tx, c.p, project.id, {
      name: 'main',
      branch: value.github?.target_branch || 'main',
    });
    const created = await r.get(c.tx, 'projects', project.id, c.p);
    if (value.github) await queueGitSync(c.tx, c.p, String(created.default_workspace_id), 'pull');
    return created;
  },
  deleteProject: async (c) => {
    const project = await r.get(c.tx, 'projects', c.params.project_id, c.p);
    const active = await c.tx.query(
      "SELECT id FROM runs WHERE project_id=$1 AND status IN ('queued','provisioning','running','waiting_for_input','persisting')",
      [project.id],
    );
    assert(!active.rowCount, 409, 'project_busy', 'Cancel pending runs before archiving the project.');
    await r.update(c.tx, 'projects', project.id, { archived: true });
    return r.operation(c.tx, c.p, 'project_archive', { project_id: project.id });
  },
  listWorkspaces: async (c) => {
    await r.get(c.tx, 'projects', c.params.project_id, c.p);
    return r.list(c.tx, 'workspaces', c.p, c.query, { project_id: c.params.project_id, deleted: false });
  },
  createWorkspace: async (c) =>
    files.createWorkspace(c.tx, c.p, c.params.project_id, input<'WorkspaceCreate'>(c)),
  getWorkspace: get('workspaces', 'workspace_id'),
  updateWorkspace: mutation('workspaces', 'workspace_id'),
  deleteWorkspace: async (c) => {
    const ws = await r.get(c.tx, 'workspaces', c.params.workspace_id, c.p);
    await files.ensureWritable(c.tx, ws.id);
    const queued = await c.tx.query("SELECT id FROM runs WHERE workspace_id=$1 AND status='queued' LIMIT 1", [
      ws.id,
    ]);
    assert(!queued.rowCount, 409, 'workspace_busy', 'Cancel queued runs before deleting this workspace.');
    const project = await r.get(c.tx, 'projects', String(ws.project_id), c.p);
    assert(
      project.default_workspace_id !== ws.id,
      409,
      'default_workspace',
      'Keep the default workspace or archive the project.',
    );
    await r.update(c.tx, 'workspaces', ws.id, { deleted: true, status: 'deleting' });
    // Bind authorization before hiding the workspace. Resolving the deleted resource
    // again would turn a successful deletion into a 404 and roll back the transaction.
    return r.operation(c.tx, c.p, 'workspace_delete', { workspace_id: ws.id, project_id: ws.project_id });
  },
  listFiles: async (c) => {
    const { workspace, files: entries } = await files.workspaceFiles(c.tx, c.params.workspace_id, c.p);
    const prefix = c.query.get('path') || '';
    if (prefix) files.normalizePath(prefix);
    const cursor = c.query.get('cursor');
    const limit = Math.min(100, Number(c.query.get('limit')) || 100);
    const selected = entries
      .filter(
        (f) =>
          (!prefix || f.path === prefix || f.path.startsWith(`${prefix}/`)) &&
          (!cursor || f.path > cursor) &&
          (!c.query.get('query') || f.path.toLowerCase().includes(c.query.get('query')!.toLowerCase())),
      )
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    c.headers.set('ETag', `"${workspace.revision}"`);
    return {
      entries: selected.slice(0, limit).map((f) => ({ ...f, revision: workspace.revision })),
      revision: workspace.revision,
      source: workspace.status === 'busy' ? 'checkpoint' : 'active_workspace',
      observed_at: workspace.last_verified_at || workspace.created_at,
      next_cursor: selected.length > limit ? selected[limit - 1].path : null,
    };
  },
  readFile: async (c) => {
    const { workspace, files: entries } = await files.workspaceFiles(c.tx, c.params.workspace_id, c.p);
    const path = files.normalizePath(c.query.get('path') || '');
    const file = entries.find((f) => f.path === path);
    assert(file, 404, 'not_found', 'File not found.');
    assert(
      file.type === 'file',
      409,
      'unsupported_file',
      'Read the link target explicitly; file reads do not follow symlinks.',
    );
    if (c.query.get('download') === 'true')
      return new Response(null, {
        status: 302,
        headers: {
          ...Object.fromEntries(c.headers),
          Location: transfers.downloadURL(c.p.organizationId, file.key, file.sha256, path).url,
        },
      });
    assert(
      BigInt(file.size_bytes) <= 4n * 1024n * 1024n,
      413,
      'file_too_large',
      'Use download=true or a staged file transfer to download files larger than 4 MiB.',
    );
    c.headers.set('ETag', `"${workspace.revision}"`);
    c.headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path)}`);
    return new Response(new Uint8Array(await readContent(file.key, file.sha256)), {
      headers: { ...Object.fromEntries(c.headers), 'content-type': 'application/octet-stream' },
    });
  },
  writeFile: async (c) =>
    files.writeFile(
      c.tx,
      c.p,
      c.params.workspace_id,
      c.query.get('path') || '',
      c.bytes,
      (c.request.headers.get('if-match') || '').replace(/^"|"$/g, ''),
    ),
  deleteFile: async (c) =>
    files.deleteFile(
      c.tx,
      c.p,
      c.params.workspace_id,
      c.query.get('path') || '',
      (c.request.headers.get('if-match') || '').replace(/^"|"$/g, ''),
    ),
  listCheckpoints: async (c) => {
    await r.get(c.tx, 'workspaces', c.params.workspace_id, c.p);
    return r.list(c.tx, 'checkpoints', c.p, c.query, { workspace_id: c.params.workspace_id });
  },
  createCheckpoint: async (c) => {
    await files.ensureWritable(c.tx, c.params.workspace_id);
    const cp = await files.checkpoint(c.tx, c.p, c.params.workspace_id);
    await r.update(c.tx, 'workspaces', c.params.workspace_id, files.checkpointState(cp));
    if (input<'CheckpointCreate'>(c).pinned) await r.update(c.tx, 'checkpoints', cp.id, { pinned: true });
    return r.operation(c.tx, c.p, 'checkpoint_create', {
      workspace_id: c.params.workspace_id,
      checkpoint_id: cp.id,
    });
  },
  restoreWorkspace: async (c) => {
    await files.ensureWritable(c.tx, c.params.workspace_id);
    const ws = await r.get(c.tx, 'workspaces', c.params.workspace_id, c.p);
    const cp = await r.get(c.tx, 'checkpoints', input<'RestoreRequest'>(c).checkpoint_id, c.p);
    assert(
      cp.project_id === ws.project_id,
      400,
      'checkpoint_mismatch',
      'Restore from a checkpoint in this project.',
    );
    await files.checkpoint(c.tx, c.p, ws.id, 'Before restore');
    const verified = await files.checkpoint(
      c.tx,
      c.p,
      ws.id,
      'Restored checkpoint',
      cp.files as files.FileRecord[],
      (cp.git_files || []) as files.FileRecord[],
    );
    const changed = await r.update(c.tx, 'workspaces', ws.id, {
      ...files.checkpointState(verified),
      status: 'idle',
    });
    return r.operation(c.tx, c.p, 'workspace_restore', {
      workspace_id: ws.id,
      checkpoint_id: verified.id,
      revision: changed.revision,
    });
  },
  updateCheckpointRetention: mutation('checkpoints', 'checkpoint_id'),
  getSync: async (c) => {
    const ws = await r.get(c.tx, 'workspaces', c.params.workspace_id, c.p);
    return ws.sync || { workspace_id: ws.id, status: 'disabled', updated_at: ws.created_at };
  },
  syncWorkspace: async (c) =>
    queueGitSync(
      c.tx,
      c.p,
      c.params.workspace_id,
      (c.body as { mode?: 'push' | 'pull' | 'pull_request' }).mode || 'push',
    ),
  listAgents: list('agents'),
  getAgent: get('agents', 'agent_id'),
  createAgent: async (c) => {
    const value = input<'AgentCreate'>(c);
    await runs.validateConfiguration(c.tx, c.p, { ...value, workspace_id: id() });
    return r.create(c.tx, 'agents', c.p.organizationId, { ...value });
  },
  updateAgent: async (c) => {
    const old = await r.get(c.tx, 'agents', c.params.agent_id, c.p);
    const merged = { ...old, ...input<'AgentPatch'>(c) };
    await runs.validateConfiguration(c.tx, c.p, { ...merged, workspace_id: id() } as unknown as Parameters<
      typeof runs.validateConfiguration
    >[2]);
    return r.update(c.tx, 'agents', old.id, input<'AgentPatch'>(c));
  },
  deleteAgent: async (c) => {
    await r.get(c.tx, 'agents', c.params.agent_id, c.p);
    await r.remove(c.tx, 'agents', c.params.agent_id);
  },
  listSessions: list('sessions', (c) =>
    c.query.has('workspace_id') ? { workspace_id: c.query.get('workspace_id') } : {},
  ),
  getSession: get('sessions', 'session_id'),
  createSession: async (c) => runs.createSession(c.tx, c.p, input<'SessionCreate'>(c)),
  continueSession: async (c) =>
    runs.admitRun(
      c.tx,
      c.p,
      { ...input<'MessageCreate'>(c), session_id: c.params.session_id },
      c.request.headers.get('x-client-type') || 'api',
    ),
  createRun: async (c) =>
    runs.admitRun(c.tx, c.p, input<'RunCreate'>(c), c.request.headers.get('x-client-type') || 'api'),
  getRun: async (c) => (await runs.presentRuns(c.tx, [await runs.getRun(c.tx, c.params.run_id, c.p)]))[0],
  listRuns: async (c) => {
    const args: unknown[] = [];
    const where = ['true'];
    for (const field of ['project_id', 'workspace_id', 'session_id', 'status'])
      if (c.query.has(field)) {
        args.push(c.query.get(field));
        where.push(`${field}=$${args.length}`);
      }
    if (c.query.has('cursor')) {
      args.push(c.query.get('cursor'));
      where.push(`id<$${args.length}::uuid`);
    }
    if (c.p.projectIds.length) {
      args.push(c.p.projectIds);
      where.push(`project_id=ANY($${args.length}::uuid[])`);
    }
    const limit = Math.min(100, Number(c.query.get('limit')) || 25);
    args.push(limit + 1);
    const rows = (
      await c.tx.query<runs.RunRow>(
        `SELECT * FROM runs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT $${args.length}`,
        args,
      )
    ).rows;
    return {
      data: await runs.presentRuns(c.tx, rows.slice(0, limit)),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  },
  cancelRun: async (c) => runs.cancelRun(c.tx, c.p, c.params.run_id),
  submitRunInput: async (c) => runs.submitInput(c.tx, c.p, c.params.run_id, input<'RunInput'>(c)),
  getRunResult: async (c) => {
    const row = await runs.getRun(c.tx, c.params.run_id, c.p);
    return {
      run_id: row.id,
      final: runs.terminal(row.status),
      execution_outcome: 'pending',
      persistence_status: 'pending',
      ...row.result,
    };
  },
  listRunEvents: async (c) => {
    await runs.getRun(c.tx, c.params.run_id, c.p);
    const after = c.query.get('after') || c.query.get('cursor') || '0';
    assert(/^\d+$/.test(after), 400, 'invalid_cursor', 'Use the last event sequence as cursor.');
    const limit = Math.min(100, Number(c.query.get('limit')) || 100);
    const rows = (
      await c.tx.query(
        'SELECT * FROM run_events WHERE run_id=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT $3',
        [c.params.run_id, after, limit + 1],
      )
    ).rows;
    return {
      data: rows.slice(0, limit).map(publicEvent),
      next_cursor: rows.length > limit ? String(rows[limit - 1].sequence) : null,
    };
  },
  listArtifacts: async (c) => {
    await runs.getRun(c.tx, c.params.run_id, c.p);
    return r.list(c.tx, 'artifacts', c.p, c.query, { run_id: c.params.run_id });
  },
  downloadArtifact: async (c) => {
    const artifact = await r.get(c.tx, 'artifacts', c.params.artifact_id, c.p);
    return transfers.downloadURL(
      c.p.organizationId,
      String(artifact.key),
      String(artifact.sha256),
      String(artifact.name),
    );
  },
  listConnections: list('connections'),
  getConnection: get('connections', 'connection_id'),
  createConnection: async (c) => connections.saveConnection(c.tx, c.p, input<'ConnectionCreate'>(c)),
  updateConnection: async (c) =>
    connections.saveConnection(c.tx, c.p, input<'ConnectionPatch'>(c), c.params.connection_id),
  deleteConnection: async (c) => {
    const conn = await r.get(c.tx, 'connections', c.params.connection_id, c.p);
    await disconnectConnection(c.tx, c.p, conn);
  },
  authorizeConnection: async (c) =>
    connections.authorizeConnection(c.tx, c.p, await r.get(c.tx, 'connections', c.params.connection_id, c.p)),
  testConnection: async (c) =>
    connections.testConnection(c.tx, c.p, await r.get(c.tx, 'connections', c.params.connection_id, c.p)),
  listConnectionTools: async (c) =>
    page(await connections.connectionTools(await r.get(c.tx, 'connections', c.params.connection_id, c.p))),
  getConnectionGrants: async (c) => (await r.get(c.tx, 'connections', c.params.connection_id, c.p)).grants,
  setConnectionGrants: async (c) =>
    connections.setGrants(
      c.tx,
      c.p,
      await r.get(c.tx, 'connections', c.params.connection_id, c.p),
      input<'ConnectionGrantSet'>(c),
    ),
  listApiKeys: async (c) => {
    const limit = Math.min(100, Math.max(1, Number(c.query.get('limit')) || 25));
    const rows = (
      await c.tx.query(
        'SELECT * FROM api_keys WHERE organization_id=$1 AND user_id=$2 AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT $4',
        [c.p.organizationId, c.p.userId, c.query.get('cursor'), limit + 1],
      )
    ).rows;
    return {
      data: rows.slice(0, limit).map(presentKey),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  },
  createApiKey: async (c) => createKey(c.tx, c.p, input<'KeyCreate'>(c)),
  revokeApiKey: async (c) => {
    const result = await c.tx.query(
      'UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND organization_id=$2 AND user_id=$3 RETURNING id',
      [c.params.key_id, c.p.organizationId, c.p.userId],
    );
    assert(result.rowCount, 404, 'not_found', 'API key not found.');
  },
  listWebhookEndpoints: list('webhooks'),
  createWebhookEndpoint: async (c) => {
    const value = input<'WebhookCreate'>(c);
    await validatePublicURL(value.url);
    const secret = token('whsec');
    const endpoint = await r.create(c.tx, 'webhooks', c.p.organizationId, {
      ...value,
      enabled: true,
      secret_ciphertext: seal(secret),
    });
    return { ...endpoint, signing_secret: secret };
  },
  updateWebhookEndpoint: async (c) => {
    const value = input<'WebhookPatch'>(c);
    await r.get(c.tx, 'webhooks', c.params.endpoint_id, c.p);
    if (value.url) await validatePublicURL(value.url);
    return r.update(c.tx, 'webhooks', c.params.endpoint_id, value);
  },
  deleteWebhookEndpoint: async (c) => {
    await r.get(c.tx, 'webhooks', c.params.endpoint_id, c.p);
    await r.update(c.tx, 'webhooks', c.params.endpoint_id, { enabled: false, deleted: true });
  },
  rotateWebhookSecret: async (c) => {
    const old = await r.get(c.tx, 'webhooks', c.params.endpoint_id, c.p);
    const secret = token('whsec');
    const endpoint = await r.update(c.tx, 'webhooks', old.id, {
      secret_ciphertext: seal(secret),
      previous_secret_ciphertext: old.secret_ciphertext,
      previous_secret_expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    return { ...endpoint, signing_secret: secret };
  },
  listWebhookDeliveries: list('deliveries'),
  replayWebhookDelivery: async (c) => {
    const original = await r.get(c.tx, 'deliveries', c.params.delivery_id, c.p);
    const delivery = await r.create(c.tx, 'deliveries', c.p.organizationId, {
      event_id: original.event_id,
      endpoint_id: original.endpoint_id,
      payload: original.payload,
      project_id: original.project_id,
      replay_of: original.id,
      status: 'pending',
      attempts: 0,
    });
    const operation = await r.operation(c.tx, c.p, 'webhook_replay', { delivery_id: delivery.id }, 'queued');
    await r.update(c.tx, 'deliveries', delivery.id, {
      replay_operation_id: operation.id,
      status: 'pending',
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
    });
    await c.tx.query(
      "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'webhook',$3) ON CONFLICT(kind,resource_id) DO UPDATE SET state='pending',available_at=now()",
      [id(), c.p.organizationId, delivery.id],
    );
    return operation;
  },
  getUsage: async (c) => reports.usageReport(c.tx, c.query, false, c.p.organizationId),
  listRequests: async (c) => reports.requests(c.tx, c.query, c.p.organizationId),
  getBilling: async (c) => reports.billing(c.tx, c.p.organizationId),
  createCheckout: async (c) => payments.checkout(c.tx, c.p, input<'CheckoutCreate'>(c), c.idempotencyKey),
  createBillingPortal: async (c) => payments.portal(c.tx, c.p),
  listHarnesses: async () =>
    page(
      harnesses.map((h) => ({
        id: h.id,
        version: isSimulated()
          ? 'simulation'
          : process.env[`${h.id.replace('-', '_').toUpperCase()}_VERSION`] || 'configured',
        enabled: true,
        capabilities: Object.keys(h.capabilities),
      })),
    ),
  listModels: async (c) =>
    page(
      models()
        .filter((m) => !c.query.get('harness') || m.harnesses.includes(c.query.get('harness')!))
        .map((m) => ({
          ...m,
          billing_modes: ['managed', 'byok'],
          rate_card_version: process.env.RATE_CARD_VERSION || 'local-simulation',
        })),
    ),
  getOperation: get('operations', 'operation_id'),
  getIdentity: async (c) => ({
    organization_id: c.p.organizationId,
    principal_id: c.p.id,
    principal_type: c.p.kind === 'api_key' ? 'api_key' : 'user',
    user_id: c.p.userId,
    organizations: (
      await c.tx.query(
        'SELECT o.id,o.name,m.role FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND ($2::uuid IS NULL OR o.id=$2::uuid) ORDER BY o.created_at',
        [c.p.userId, c.p.kind === 'api_key' ? c.p.organizationId : null],
      )
    ).rows,
    effective_scopes: c.p.scopes,
    project_restrictions: c.p.projectIds,
    capabilities,
  }),
  createTransfer: async (c) =>
    transfers.createTransfer(c.tx, c.p, c.params.workspace_id, input<'TransferCreate'>(c)),
  listTransfers: async (c) => {
    await r.get(c.tx, 'workspaces', c.params.workspace_id, c.p);
    return r.list(c.tx, 'transfers', c.p, c.query, { workspace_id: c.params.workspace_id });
  },
  getTransfer: get('transfers', 'transfer_id'),
  applyTransfer: async (c) =>
    transfers.applyTransfer(c.tx, c.p, c.params.transfer_id, input<'TransferApply'>(c)),
  getWorkspaceDiff: async (c) => {
    const { workspace, files: current } = await files.workspaceFiles(c.tx, c.params.workspace_id, c.p);
    const baseId = c.query.get('base_checkpoint_id') || (workspace.base_checkpoint_id as string | undefined);
    const base = baseId ? await r.get(c.tx, 'checkpoints', baseId, c.p) : undefined;
    assert(
      !base || base.project_id === workspace.project_id,
      400,
      'checkpoint_mismatch',
      'Diff checkpoint must belong to this project.',
    );
    const before = (base?.files || []) as files.FileRecord[];
    const previousFiles = new Map(before.map((file) => [file.path, file]));
    const currentFiles = new Map(current.map((file) => [file.path, file]));
    const selectedPath = c.query.get('path');
    const paths = [...new Set([...previousFiles.keys(), ...currentFiles.keys()])]
      .filter(
        (path) =>
          (!selectedPath || path === selectedPath) &&
          previousFiles.get(path)?.sha256 !== currentFiles.get(path)?.sha256,
      )
      .sort();
    const limit = Math.min(100, Number(c.query.get('limit')) || 100);
    const diff = [];
    // Decide which paths are returned before fetching their content.
    for (const path of paths.slice(0, limit)) {
      const a = previousFiles.get(path),
        b = currentFiles.get(path);
      // Verified checkpoint sizes let us skip large objects before allocating their contents.
      const inspect = BigInt(a?.size_bytes || '0') + BigInt(b?.size_bytes || '0') < 512000n;
      const old = inspect && a ? await readContent(a.key, a.sha256) : Buffer.alloc(0),
        next = inspect && b ? await readContent(b.key, b.sha256) : Buffer.alloc(0);
      const binary = inspect ? old.includes(0) || next.includes(0) : null;
      diff.push({
        path,
        change: !a ? 'added' : !b ? 'deleted' : 'modified',
        before_sha256: a?.sha256 || null,
        after_sha256: b?.sha256 || null,
        binary,
        ...(inspect && !binary && old.length + next.length < 512000
          ? { patch: createTwoFilesPatch(path, path, old.toString(), next.toString()) }
          : {}),
      });
    }
    return {
      workspace_id: workspace.id,
      base_checkpoint_id: baseId,
      revision: workspace.revision,
      data: diff,
      next_cursor: null,
      truncated: paths.length > limit,
    };
  },
};
