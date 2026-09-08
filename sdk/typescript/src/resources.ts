// Generated from OpenAPI by pnpm contracts. Do not edit.
import type { Client, Operation, Result, RequestOptions, Schema } from './client.js';
import type { operations } from './schema.js';
import { streamRunText, waitForRun, type WaitOptions } from './run-helpers.js';
export const DEFAULT_ORIGIN = 'https://app.macrofold.ai';
export type RequestSettings = {
  signal?: AbortSignal;
  idempotencyKey?: string;
  headers?: Record<string, string>;
};
type Transport = Pick<Client, 'request' | 'stream'>;
export type ListProjectsOptions = {
  cursor?: NonNullable<operations['listProjects']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listProjects']['parameters']['query']>['limit'];
  query?: NonNullable<operations['listProjects']['parameters']['query']>['query'];
  archived?: NonNullable<operations['listProjects']['parameters']['query']>['archived'];
};
export type CreateProjectOptions = NonNullable<
  operations['createProject']['requestBody']
>['content']['application/json'];
export type UpdateProjectOptions = NonNullable<
  operations['updateProject']['requestBody']
>['content']['application/json'];
export type ListWorkspacesOptions = {
  cursor?: NonNullable<operations['listWorkspaces']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listWorkspaces']['parameters']['query']>['limit'];
};
export type CreateWorkspaceOptions = NonNullable<
  operations['createWorkspace']['requestBody']
>['content']['application/json'];
export type ScheduleProjectDeletionOptions = NonNullable<
  operations['scheduleProjectDeletion']['requestBody']
>['content']['application/json'];
export class ProjectsResource {
  constructor(private client: Transport) {}
  list(
    options: ListProjectsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listProjects'>> {
    return this.client.request('listProjects', {
      ...requestOptions,
      params: {
        query: {
          cursor: options.cursor,
          limit: options.limit,
          query: options.query,
          archived: options.archived,
        },
      },
    });
  }
  create(
    options: CreateProjectOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createProject'>> {
    return this.client.request('createProject', {
      ...requestOptions,

      body: options,
    });
  }
  get(projectId: string, requestOptions: RequestSettings = {}): Promise<Result<'getProject'>> {
    return this.client.request('getProject', {
      ...requestOptions,
      params: { path: { project_id: projectId } },
    });
  }
  update(
    projectId: string,
    options: UpdateProjectOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateProject'>> {
    return this.client.request('updateProject', {
      ...requestOptions,
      params: { path: { project_id: projectId } },
      body: options,
    });
  }
  delete(projectId: string, requestOptions: RequestSettings = {}): Promise<Result<'deleteProject'>> {
    return this.client.request('deleteProject', {
      ...requestOptions,
      params: { path: { project_id: projectId } },
    });
  }
  listWorkspaces(
    projectId: string,
    options: ListWorkspacesOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listWorkspaces'>> {
    return this.client.request('listWorkspaces', {
      ...requestOptions,
      params: { path: { project_id: projectId }, query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  createWorkspace(
    projectId: string,
    options: CreateWorkspaceOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createWorkspace'>> {
    return this.client.request('createWorkspace', {
      ...requestOptions,
      params: { path: { project_id: projectId } },
      body: options,
    });
  }
  scheduleDeletion(
    projectId: string,
    options: ScheduleProjectDeletionOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'scheduleProjectDeletion'>> {
    return this.client.request('scheduleProjectDeletion', {
      ...requestOptions,
      params: { path: { project_id: projectId } },
      body: options,
    });
  }
  cancelDeletion(
    projectId: string,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'cancelProjectDeletion'>> {
    return this.client.request('cancelProjectDeletion', {
      ...requestOptions,
      params: { path: { project_id: projectId } },
    });
  }
}
export type UpdateWorkspaceOptions = NonNullable<
  operations['updateWorkspace']['requestBody']
>['content']['application/json'];
export type ListFilesOptions = {
  path?: NonNullable<operations['listFiles']['parameters']['query']>['path'];
  cursor?: NonNullable<operations['listFiles']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listFiles']['parameters']['query']>['limit'];
  query?: NonNullable<operations['listFiles']['parameters']['query']>['query'];
};
export type ReadFileOptions = {
  path: NonNullable<operations['readFile']['parameters']['query']>['path'];
  download?: NonNullable<operations['readFile']['parameters']['query']>['download'];
};
export type WriteFileOptions = {
  path: NonNullable<operations['writeFile']['parameters']['query']>['path'];
  ifMatch: NonNullable<operations['writeFile']['parameters']['header']>['If-Match'];
  content: Uint8Array;
};
export type DeleteFileOptions = {
  path: NonNullable<operations['deleteFile']['parameters']['query']>['path'];
  ifMatch: NonNullable<operations['deleteFile']['parameters']['header']>['If-Match'];
};
export type ListCheckpointsOptions = {
  cursor?: NonNullable<operations['listCheckpoints']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listCheckpoints']['parameters']['query']>['limit'];
};
export type CreateCheckpointOptions = NonNullable<
  operations['createCheckpoint']['requestBody']
>['content']['application/json'];
export type RestoreWorkspaceOptions = NonNullable<
  operations['restoreWorkspace']['requestBody']
>['content']['application/json'];
export type SyncWorkspaceOptions = NonNullable<
  operations['syncWorkspace']['requestBody']
>['content']['application/json'];
export type GetWorkspaceDiffOptions = {
  base_checkpoint_id?: NonNullable<
    operations['getWorkspaceDiff']['parameters']['query']
  >['base_checkpoint_id'];
  path?: NonNullable<operations['getWorkspaceDiff']['parameters']['query']>['path'];
  cursor?: NonNullable<operations['getWorkspaceDiff']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['getWorkspaceDiff']['parameters']['query']>['limit'];
};
export type CreateTransferOptions = NonNullable<
  operations['createTransfer']['requestBody']
>['content']['application/json'];
export type ListTransfersOptions = {
  cursor?: NonNullable<operations['listTransfers']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listTransfers']['parameters']['query']>['limit'];
};
export class WorkspacesResource {
  constructor(private client: Transport) {}
  get(workspaceId: string, requestOptions: RequestSettings = {}): Promise<Result<'getWorkspace'>> {
    return this.client.request('getWorkspace', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
    });
  }
  delete(workspaceId: string, requestOptions: RequestSettings = {}): Promise<Result<'deleteWorkspace'>> {
    return this.client.request('deleteWorkspace', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
    });
  }
  update(
    workspaceId: string,
    options: UpdateWorkspaceOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateWorkspace'>> {
    return this.client.request('updateWorkspace', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
      body: options,
    });
  }
  listFiles(
    workspaceId: string,
    options: ListFilesOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listFiles'>> {
    return this.client.request('listFiles', {
      ...requestOptions,
      params: {
        path: { workspace_id: workspaceId },
        query: { path: options.path, cursor: options.cursor, limit: options.limit, query: options.query },
      },
    });
  }
  readFile(
    workspaceId: string,
    options: ReadFileOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'readFile'>> {
    return this.client.request('readFile', {
      ...requestOptions,
      params: {
        path: { workspace_id: workspaceId },
        query: { path: options.path, download: options.download },
      },
    });
  }
  writeFile(
    workspaceId: string,
    options: WriteFileOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'writeFile'>> {
    return this.client.request('writeFile', {
      ...requestOptions,
      params: {
        path: { workspace_id: workspaceId },
        query: { path: options.path },
        header: { 'If-Match': options.ifMatch },
      },
      body: options.content,
    });
  }
  deleteFile(
    workspaceId: string,
    options: DeleteFileOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'deleteFile'>> {
    return this.client.request('deleteFile', {
      ...requestOptions,
      params: {
        path: { workspace_id: workspaceId },
        query: { path: options.path },
        header: { 'If-Match': options.ifMatch },
      },
    });
  }
  listCheckpoints(
    workspaceId: string,
    options: ListCheckpointsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listCheckpoints'>> {
    return this.client.request('listCheckpoints', {
      ...requestOptions,
      params: {
        path: { workspace_id: workspaceId },
        query: { cursor: options.cursor, limit: options.limit },
      },
    });
  }
  createCheckpoint(
    workspaceId: string,
    options: CreateCheckpointOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createCheckpoint'>> {
    return this.client.request('createCheckpoint', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
      body: options,
    });
  }
  restore(
    workspaceId: string,
    options: RestoreWorkspaceOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'restoreWorkspace'>> {
    return this.client.request('restoreWorkspace', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
      body: options,
    });
  }
  getSync(workspaceId: string, requestOptions: RequestSettings = {}): Promise<Result<'getSync'>> {
    return this.client.request('getSync', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
    });
  }
  sync(
    workspaceId: string,
    options: SyncWorkspaceOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'syncWorkspace'>> {
    return this.client.request('syncWorkspace', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
      body: options,
    });
  }
  getDiff(
    workspaceId: string,
    options: GetWorkspaceDiffOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getWorkspaceDiff'>> {
    return this.client.request('getWorkspaceDiff', {
      ...requestOptions,
      params: {
        path: { workspace_id: workspaceId },
        query: {
          base_checkpoint_id: options.base_checkpoint_id,
          path: options.path,
          cursor: options.cursor,
          limit: options.limit,
        },
      },
    });
  }
  createTransfer(
    workspaceId: string,
    options: CreateTransferOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createTransfer'>> {
    return this.client.request('createTransfer', {
      ...requestOptions,
      params: { path: { workspace_id: workspaceId } },
      body: options,
    });
  }
  listTransfers(
    workspaceId: string,
    options: ListTransfersOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listTransfers'>> {
    return this.client.request('listTransfers', {
      ...requestOptions,
      params: {
        path: { workspace_id: workspaceId },
        query: { cursor: options.cursor, limit: options.limit },
      },
    });
  }
}
export type ListAgentsOptions = {
  cursor?: NonNullable<operations['listAgents']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listAgents']['parameters']['query']>['limit'];
};
export type CreateAgentOptions = NonNullable<
  operations['createAgent']['requestBody']
>['content']['application/json'];
export type UpdateAgentOptions = NonNullable<
  operations['updateAgent']['requestBody']
>['content']['application/json'];
export class AgentsResource {
  constructor(private client: Transport) {}
  list(options: ListAgentsOptions = {}, requestOptions: RequestSettings = {}): Promise<Result<'listAgents'>> {
    return this.client.request('listAgents', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  create(options: CreateAgentOptions, requestOptions: RequestSettings = {}): Promise<Result<'createAgent'>> {
    return this.client.request('createAgent', {
      ...requestOptions,

      body: options,
    });
  }
  get(agentId: string, requestOptions: RequestSettings = {}): Promise<Result<'getAgent'>> {
    return this.client.request('getAgent', { ...requestOptions, params: { path: { agent_id: agentId } } });
  }
  update(
    agentId: string,
    options: UpdateAgentOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateAgent'>> {
    return this.client.request('updateAgent', {
      ...requestOptions,
      params: { path: { agent_id: agentId } },
      body: options,
    });
  }
  delete(agentId: string, requestOptions: RequestSettings = {}): Promise<Result<'deleteAgent'>> {
    return this.client.request('deleteAgent', { ...requestOptions, params: { path: { agent_id: agentId } } });
  }
}
export type ListSessionsOptions = {
  cursor?: NonNullable<operations['listSessions']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listSessions']['parameters']['query']>['limit'];
  workspace_id?: NonNullable<operations['listSessions']['parameters']['query']>['workspace_id'];
};
export type CreateSessionOptions = NonNullable<
  operations['createSession']['requestBody']
>['content']['application/json'];
export type ContinueSessionOptions = NonNullable<
  operations['continueSession']['requestBody']
>['content']['application/json'];
export class SessionsResource {
  constructor(private client: Transport) {}
  list(
    options: ListSessionsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listSessions'>> {
    return this.client.request('listSessions', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit, workspace_id: options.workspace_id } },
    });
  }
  create(
    options: CreateSessionOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createSession'>> {
    return this.client.request('createSession', {
      ...requestOptions,

      body: options,
    });
  }
  get(sessionId: string, requestOptions: RequestSettings = {}): Promise<Result<'getSession'>> {
    return this.client.request('getSession', {
      ...requestOptions,
      params: { path: { session_id: sessionId } },
    });
  }
  continueRun(
    sessionId: string,
    options: ContinueSessionOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'continueSession'>> {
    return this.client.request('continueSession', {
      ...requestOptions,
      params: { path: { session_id: sessionId } },
      body: options,
    });
  }
}
export type ListRunsOptions = {
  status?: NonNullable<operations['listRuns']['parameters']['query']>['status'];
  project_id?: NonNullable<operations['listRuns']['parameters']['query']>['project_id'];
  from?: NonNullable<operations['listRuns']['parameters']['query']>['from'];
  to?: NonNullable<operations['listRuns']['parameters']['query']>['to'];
  cursor?: NonNullable<operations['listRuns']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listRuns']['parameters']['query']>['limit'];
  workspace_id?: NonNullable<operations['listRuns']['parameters']['query']>['workspace_id'];
  session_id?: NonNullable<operations['listRuns']['parameters']['query']>['session_id'];
};
export type CreateRunOptions = NonNullable<
  operations['createRun']['requestBody']
>['content']['application/json'] &
  (
    | {
        project_id: NonNullable<
          NonNullable<operations['createRun']['requestBody']>['content']['application/json']['project_id']
        >;
        workspace_id?: never;
        session_id?: never;
      }
    | {
        project_id?: never;
        workspace_id: NonNullable<
          NonNullable<operations['createRun']['requestBody']>['content']['application/json']['workspace_id']
        >;
        session_id?: never;
      }
    | {
        project_id?: never;
        workspace_id?: never;
        session_id: NonNullable<
          NonNullable<operations['createRun']['requestBody']>['content']['application/json']['session_id']
        >;
      }
  );
export type CancelRunOptions = NonNullable<
  operations['cancelRun']['requestBody']
>['content']['application/json'];
export type SubmitRunInputOptions = NonNullable<
  operations['submitRunInput']['requestBody']
>['content']['application/json'];
export type ListRunEventsOptions = {
  after?: NonNullable<operations['listRunEvents']['parameters']['query']>['after'];
  cursor?: NonNullable<operations['listRunEvents']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listRunEvents']['parameters']['query']>['limit'];
};
export type ListArtifactsOptions = {
  cursor?: NonNullable<operations['listArtifacts']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listArtifacts']['parameters']['query']>['limit'];
};
export class RunsResource {
  constructor(private client: Transport) {}
  list(options: ListRunsOptions = {}, requestOptions: RequestSettings = {}): Promise<Result<'listRuns'>> {
    return this.client.request('listRuns', {
      ...requestOptions,
      params: {
        query: {
          status: options.status,
          project_id: options.project_id,
          from: options.from,
          to: options.to,
          cursor: options.cursor,
          limit: options.limit,
          workspace_id: options.workspace_id,
          session_id: options.session_id,
        },
      },
    });
  }
  create(options: CreateRunOptions, requestOptions: RequestSettings = {}): Promise<Result<'createRun'>> {
    return this.client.request('createRun', {
      ...requestOptions,

      body: options,
    });
  }
  get(runId: string, requestOptions: RequestSettings = {}): Promise<Result<'getRun'>> {
    return this.client.request('getRun', { ...requestOptions, params: { path: { run_id: runId } } });
  }
  cancel(
    runId: string,
    options: CancelRunOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'cancelRun'>> {
    return this.client.request('cancelRun', {
      ...requestOptions,
      params: { path: { run_id: runId } },
      body: options,
    });
  }
  submitInput(
    runId: string,
    options: SubmitRunInputOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'submitRunInput'>> {
    return this.client.request('submitRunInput', {
      ...requestOptions,
      params: { path: { run_id: runId } },
      body: options,
    });
  }
  getResult(runId: string, requestOptions: RequestSettings = {}): Promise<Result<'getRunResult'>> {
    return this.client.request('getRunResult', { ...requestOptions, params: { path: { run_id: runId } } });
  }
  listEvents(
    runId: string,
    options: ListRunEventsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listRunEvents'>> {
    return this.client.request('listRunEvents', {
      ...requestOptions,
      params: {
        path: { run_id: runId },
        query: { after: options.after, cursor: options.cursor, limit: options.limit },
      },
    });
  }
  /** Stream live or historical events; reconnects from the last delivered cursor. */
  stream(runId: string, options: { after?: string; signal?: AbortSignal } = {}) {
    return this.client.stream(runId, options);
  }
  events(runId: string, options: { after?: string; signal?: AbortSignal } = {}) {
    return this.stream(runId, options);
  }
  streamText(runId: string, options: { after?: string; signal?: AbortSignal } = {}): AsyncGenerator<string> {
    return streamRunText(this.events(runId, options), () => this.wait(runId, { signal: options.signal }));
  }
  wait(runId: string, options: WaitOptions = {}): Promise<Schema['RunResult']> {
    return waitForRun(this, runId, options);
  }
  listArtifacts(
    runId: string,
    options: ListArtifactsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listArtifacts'>> {
    return this.client.request('listArtifacts', {
      ...requestOptions,
      params: { path: { run_id: runId }, query: { cursor: options.cursor, limit: options.limit } },
    });
  }
}
export class ArtifactsResource {
  constructor(private client: Transport) {}
  download(artifactId: string, requestOptions: RequestSettings = {}): Promise<Result<'downloadArtifact'>> {
    return this.client.request('downloadArtifact', {
      ...requestOptions,
      params: { path: { artifact_id: artifactId } },
    });
  }
}
export type ListConnectionsOptions = {
  cursor?: NonNullable<operations['listConnections']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listConnections']['parameters']['query']>['limit'];
};
export type CreateConnectionOptions = NonNullable<
  operations['createConnection']['requestBody']
>['content']['application/json'];
export type UpdateConnectionOptions = NonNullable<
  operations['updateConnection']['requestBody']
>['content']['application/json'];
export type AuthorizeConnectionOptions = NonNullable<
  operations['authorizeConnection']['requestBody']
>['content']['application/json'];
export type TestConnectionOptions = NonNullable<
  operations['testConnection']['requestBody']
>['content']['application/json'];
export type ListConnectionToolsOptions = {
  cursor?: NonNullable<operations['listConnectionTools']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listConnectionTools']['parameters']['query']>['limit'];
};
export type SetConnectionGrantsOptions = NonNullable<
  operations['setConnectionGrants']['requestBody']
>['content']['application/json'];
export type ListStdioPackagesOptions = {
  cursor?: NonNullable<operations['listStdioPackages']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listStdioPackages']['parameters']['query']>['limit'];
};
export class ConnectionsResource {
  constructor(private client: Transport) {}
  list(
    options: ListConnectionsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listConnections'>> {
    return this.client.request('listConnections', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  create(
    options: CreateConnectionOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createConnection'>> {
    return this.client.request('createConnection', {
      ...requestOptions,

      body: options,
    });
  }
  get(connectionId: string, requestOptions: RequestSettings = {}): Promise<Result<'getConnection'>> {
    return this.client.request('getConnection', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
    });
  }
  update(
    connectionId: string,
    options: UpdateConnectionOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateConnection'>> {
    return this.client.request('updateConnection', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
      body: options,
    });
  }
  delete(connectionId: string, requestOptions: RequestSettings = {}): Promise<Result<'deleteConnection'>> {
    return this.client.request('deleteConnection', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
    });
  }
  authorize(
    connectionId: string,
    options: AuthorizeConnectionOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'authorizeConnection'>> {
    return this.client.request('authorizeConnection', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
      body: options,
    });
  }
  test(
    connectionId: string,
    options: TestConnectionOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'testConnection'>> {
    return this.client.request('testConnection', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
      body: options,
    });
  }
  listTools(
    connectionId: string,
    options: ListConnectionToolsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listConnectionTools'>> {
    return this.client.request('listConnectionTools', {
      ...requestOptions,
      params: {
        path: { connection_id: connectionId },
        query: { cursor: options.cursor, limit: options.limit },
      },
    });
  }
  getGrants(
    connectionId: string,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getConnectionGrants'>> {
    return this.client.request('getConnectionGrants', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
    });
  }
  setGrants(
    connectionId: string,
    options: SetConnectionGrantsOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'setConnectionGrants'>> {
    return this.client.request('setConnectionGrants', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
      body: options,
    });
  }
  listStdioPackages(
    options: ListStdioPackagesOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listStdioPackages'>> {
    return this.client.request('listStdioPackages', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  listConnectorCatalog(requestOptions: RequestSettings = {}): Promise<Result<'listConnectorCatalog'>> {
    return this.client.request('listConnectorCatalog', { ...requestOptions });
  }
}
export type ListApiKeysOptions = {
  cursor?: NonNullable<operations['listApiKeys']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listApiKeys']['parameters']['query']>['limit'];
};
export type CreateApiKeyOptions = NonNullable<
  operations['createApiKey']['requestBody']
>['content']['application/json'];
export class ApiKeysResource {
  constructor(private client: Transport) {}
  list(
    options: ListApiKeysOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listApiKeys'>> {
    return this.client.request('listApiKeys', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  create(
    options: CreateApiKeyOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createApiKey'>> {
    return this.client.request('createApiKey', {
      ...requestOptions,

      body: options,
    });
  }
  revoke(keyId: string, requestOptions: RequestSettings = {}): Promise<Result<'revokeApiKey'>> {
    return this.client.request('revokeApiKey', { ...requestOptions, params: { path: { key_id: keyId } } });
  }
}
export type ListWebhookEndpointsOptions = {
  cursor?: NonNullable<operations['listWebhookEndpoints']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listWebhookEndpoints']['parameters']['query']>['limit'];
};
export type CreateWebhookEndpointOptions = NonNullable<
  operations['createWebhookEndpoint']['requestBody']
>['content']['application/json'];
export type UpdateWebhookEndpointOptions = NonNullable<
  operations['updateWebhookEndpoint']['requestBody']
>['content']['application/json'];
export type RotateWebhookSecretOptions = NonNullable<
  operations['rotateWebhookSecret']['requestBody']
>['content']['application/json'];
export class WebhookEndpointsResource {
  constructor(private client: Transport) {}
  list(
    options: ListWebhookEndpointsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listWebhookEndpoints'>> {
    return this.client.request('listWebhookEndpoints', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  create(
    options: CreateWebhookEndpointOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createWebhookEndpoint'>> {
    return this.client.request('createWebhookEndpoint', {
      ...requestOptions,

      body: options,
    });
  }
  update(
    endpointId: string,
    options: UpdateWebhookEndpointOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateWebhookEndpoint'>> {
    return this.client.request('updateWebhookEndpoint', {
      ...requestOptions,
      params: { path: { endpoint_id: endpointId } },
      body: options,
    });
  }
  delete(endpointId: string, requestOptions: RequestSettings = {}): Promise<Result<'deleteWebhookEndpoint'>> {
    return this.client.request('deleteWebhookEndpoint', {
      ...requestOptions,
      params: { path: { endpoint_id: endpointId } },
    });
  }
  rotateWebhookSecret(
    endpointId: string,
    options: RotateWebhookSecretOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'rotateWebhookSecret'>> {
    return this.client.request('rotateWebhookSecret', {
      ...requestOptions,
      params: { path: { endpoint_id: endpointId } },
      body: options,
    });
  }
}
export type ListWebhookDeliveriesOptions = {
  cursor?: NonNullable<operations['listWebhookDeliveries']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listWebhookDeliveries']['parameters']['query']>['limit'];
};
export type ReplayWebhookDeliveryOptions = NonNullable<
  operations['replayWebhookDelivery']['requestBody']
>['content']['application/json'];
export class WebhookDeliveriesResource {
  constructor(private client: Transport) {}
  list(
    options: ListWebhookDeliveriesOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listWebhookDeliveries'>> {
    return this.client.request('listWebhookDeliveries', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  replay(
    deliveryId: string,
    options: ReplayWebhookDeliveryOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'replayWebhookDelivery'>> {
    return this.client.request('replayWebhookDelivery', {
      ...requestOptions,
      params: { path: { delivery_id: deliveryId } },
      body: options,
    });
  }
}
export type GetUsageOptions = {
  from?: NonNullable<operations['getUsage']['parameters']['query']>['from'];
  to?: NonNullable<operations['getUsage']['parameters']['query']>['to'];
  group_by?: NonNullable<operations['getUsage']['parameters']['query']>['group_by'];
};
export class UsageResource {
  constructor(private client: Transport) {}
  get(options: GetUsageOptions = {}, requestOptions: RequestSettings = {}): Promise<Result<'getUsage'>> {
    return this.client.request('getUsage', {
      ...requestOptions,
      params: { query: { from: options.from, to: options.to, group_by: options.group_by } },
    });
  }
}
export type ListRequestsOptions = {
  from?: NonNullable<operations['listRequests']['parameters']['query']>['from'];
  to?: NonNullable<operations['listRequests']['parameters']['query']>['to'];
  cursor?: NonNullable<operations['listRequests']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listRequests']['parameters']['query']>['limit'];
};
export class RequestsResource {
  constructor(private client: Transport) {}
  list(
    options: ListRequestsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listRequests'>> {
    return this.client.request('listRequests', {
      ...requestOptions,
      params: { query: { from: options.from, to: options.to, cursor: options.cursor, limit: options.limit } },
    });
  }
}
export type CreateCheckoutOptions = NonNullable<
  operations['createCheckout']['requestBody']
>['content']['application/json'];
export type CreateBillingPortalOptions = NonNullable<
  operations['createBillingPortal']['requestBody']
>['content']['application/json'];
export type UpdateStoragePolicyOptions = NonNullable<
  operations['updateStoragePolicy']['requestBody']
>['content']['application/json'];
export class BillingResource {
  constructor(private client: Transport) {}
  get(requestOptions: RequestSettings = {}): Promise<Result<'getBilling'>> {
    return this.client.request('getBilling', { ...requestOptions });
  }
  createCheckout(
    options: CreateCheckoutOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createCheckout'>> {
    return this.client.request('createCheckout', {
      ...requestOptions,

      body: options,
    });
  }
  createPortal(
    options: CreateBillingPortalOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createBillingPortal'>> {
    return this.client.request('createBillingPortal', {
      ...requestOptions,

      body: options,
    });
  }
  getStorage(requestOptions: RequestSettings = {}): Promise<Result<'getStorage'>> {
    return this.client.request('getStorage', { ...requestOptions });
  }
  updateStoragePolicy(
    options: UpdateStoragePolicyOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateStoragePolicy'>> {
    return this.client.request('updateStoragePolicy', {
      ...requestOptions,

      body: options,
    });
  }
}
export type ListHarnessesOptions = {
  cursor?: NonNullable<operations['listHarnesses']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listHarnesses']['parameters']['query']>['limit'];
};
export class HarnessesResource {
  constructor(private client: Transport) {}
  list(
    options: ListHarnessesOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listHarnesses'>> {
    return this.client.request('listHarnesses', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit } },
    });
  }
}
export type ListModelsOptions = {
  harness?: NonNullable<operations['listModels']['parameters']['query']>['harness'];
  cursor?: NonNullable<operations['listModels']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listModels']['parameters']['query']>['limit'];
};
export class ModelsResource {
  constructor(private client: Transport) {}
  list(options: ListModelsOptions = {}, requestOptions: RequestSettings = {}): Promise<Result<'listModels'>> {
    return this.client.request('listModels', {
      ...requestOptions,
      params: { query: { harness: options.harness, cursor: options.cursor, limit: options.limit } },
    });
  }
}
export class OperationsResource {
  constructor(private client: Transport) {}
  get(operationId: string, requestOptions: RequestSettings = {}): Promise<Result<'getOperation'>> {
    return this.client.request('getOperation', {
      ...requestOptions,
      params: { path: { operation_id: operationId } },
    });
  }
}
export type GetGrowthMetricsOptions = {
  from?: NonNullable<operations['getGrowthMetrics']['parameters']['query']>['from'];
  to?: NonNullable<operations['getGrowthMetrics']['parameters']['query']>['to'];
  group_by?: NonNullable<operations['getGrowthMetrics']['parameters']['query']>['group_by'];
  organization_id?: NonNullable<operations['getGrowthMetrics']['parameters']['query']>['organization_id'];
};
export type GetPlatformUsageMetricsOptions = {
  from?: NonNullable<operations['getPlatformUsageMetrics']['parameters']['query']>['from'];
  to?: NonNullable<operations['getPlatformUsageMetrics']['parameters']['query']>['to'];
  group_by?: NonNullable<operations['getPlatformUsageMetrics']['parameters']['query']>['group_by'];
  organization_id?: NonNullable<
    operations['getPlatformUsageMetrics']['parameters']['query']
  >['organization_id'];
};
export type ListAccountsOptions = {
  from?: NonNullable<operations['listAccounts']['parameters']['query']>['from'];
  to?: NonNullable<operations['listAccounts']['parameters']['query']>['to'];
  query?: NonNullable<operations['listAccounts']['parameters']['query']>['query'];
  include_contact?: NonNullable<operations['listAccounts']['parameters']['query']>['include_contact'];
  cursor?: NonNullable<operations['listAccounts']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listAccounts']['parameters']['query']>['limit'];
};
export type GetAccountSummaryOptions = {
  from?: NonNullable<operations['getAccountSummary']['parameters']['query']>['from'];
  to?: NonNullable<operations['getAccountSummary']['parameters']['query']>['to'];
  include_contact?: NonNullable<operations['getAccountSummary']['parameters']['query']>['include_contact'];
};
export type ListPlatformRequestsOptions = {
  from?: NonNullable<operations['listPlatformRequests']['parameters']['query']>['from'];
  to?: NonNullable<operations['listPlatformRequests']['parameters']['query']>['to'];
  organization_id?: NonNullable<operations['listPlatformRequests']['parameters']['query']>['organization_id'];
  status_code?: NonNullable<operations['listPlatformRequests']['parameters']['query']>['status_code'];
  route?: NonNullable<operations['listPlatformRequests']['parameters']['query']>['route'];
  cursor?: NonNullable<operations['listPlatformRequests']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listPlatformRequests']['parameters']['query']>['limit'];
};
export type GetRunDiagnosticsOptions = {
  from?: NonNullable<operations['getRunDiagnostics']['parameters']['query']>['from'];
  to?: NonNullable<operations['getRunDiagnostics']['parameters']['query']>['to'];
};
export type GetInfrastructureHealthOptions = {
  from?: NonNullable<operations['getInfrastructureHealth']['parameters']['query']>['from'];
  to?: NonNullable<operations['getInfrastructureHealth']['parameters']['query']>['to'];
  service_id?: NonNullable<operations['getInfrastructureHealth']['parameters']['query']>['service_id'];
};
export type GetCapacityReportOptions = {
  from?: NonNullable<operations['getCapacityReport']['parameters']['query']>['from'];
  to?: NonNullable<operations['getCapacityReport']['parameters']['query']>['to'];
};
export type GetOperatingReportOptions = {
  from?: NonNullable<operations['getOperatingReport']['parameters']['query']>['from'];
  to?: NonNullable<operations['getOperatingReport']['parameters']['query']>['to'];
};
export type ListReportSnapshotsOptions = {
  from?: NonNullable<operations['listReportSnapshots']['parameters']['query']>['from'];
  to?: NonNullable<operations['listReportSnapshots']['parameters']['query']>['to'];
  cursor?: NonNullable<operations['listReportSnapshots']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listReportSnapshots']['parameters']['query']>['limit'];
};
export class OperatorResource {
  constructor(private client: Transport) {}
  getGrowthMetrics(
    options: GetGrowthMetricsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getGrowthMetrics'>> {
    return this.client.request('getGrowthMetrics', {
      ...requestOptions,
      params: {
        query: {
          from: options.from,
          to: options.to,
          group_by: options.group_by,
          organization_id: options.organization_id,
        },
      },
    });
  }
  getPlatformUsageMetrics(
    options: GetPlatformUsageMetricsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getPlatformUsageMetrics'>> {
    return this.client.request('getPlatformUsageMetrics', {
      ...requestOptions,
      params: {
        query: {
          from: options.from,
          to: options.to,
          group_by: options.group_by,
          organization_id: options.organization_id,
        },
      },
    });
  }
  listAccounts(
    options: ListAccountsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listAccounts'>> {
    return this.client.request('listAccounts', {
      ...requestOptions,
      params: {
        query: {
          from: options.from,
          to: options.to,
          query: options.query,
          include_contact: options.include_contact,
          cursor: options.cursor,
          limit: options.limit,
        },
      },
    });
  }
  getAccountSummary(
    accountId: string,
    options: GetAccountSummaryOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getAccountSummary'>> {
    return this.client.request('getAccountSummary', {
      ...requestOptions,
      params: {
        path: { account_id: accountId },
        query: { from: options.from, to: options.to, include_contact: options.include_contact },
      },
    });
  }
  listPlatformRequests(
    options: ListPlatformRequestsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listPlatformRequests'>> {
    return this.client.request('listPlatformRequests', {
      ...requestOptions,
      params: {
        query: {
          from: options.from,
          to: options.to,
          organization_id: options.organization_id,
          status_code: options.status_code,
          route: options.route,
          cursor: options.cursor,
          limit: options.limit,
        },
      },
    });
  }
  getRunDiagnostics(
    runId: string,
    options: GetRunDiagnosticsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getRunDiagnostics'>> {
    return this.client.request('getRunDiagnostics', {
      ...requestOptions,
      params: { path: { run_id: runId }, query: { from: options.from, to: options.to } },
    });
  }
  getInfrastructureHealth(
    options: GetInfrastructureHealthOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getInfrastructureHealth'>> {
    return this.client.request('getInfrastructureHealth', {
      ...requestOptions,
      params: { query: { from: options.from, to: options.to, service_id: options.service_id } },
    });
  }
  getCapacityReport(
    options: GetCapacityReportOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getCapacityReport'>> {
    return this.client.request('getCapacityReport', {
      ...requestOptions,
      params: { query: { from: options.from, to: options.to } },
    });
  }
  getOperatingReport(
    options: GetOperatingReportOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'getOperatingReport'>> {
    return this.client.request('getOperatingReport', {
      ...requestOptions,
      params: { query: { from: options.from, to: options.to } },
    });
  }
  listReportSnapshots(
    options: ListReportSnapshotsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listReportSnapshots'>> {
    return this.client.request('listReportSnapshots', {
      ...requestOptions,
      params: { query: { from: options.from, to: options.to, cursor: options.cursor, limit: options.limit } },
    });
  }
}
export type UpdateCheckpointRetentionOptions = NonNullable<
  operations['updateCheckpointRetention']['requestBody']
>['content']['application/json'];
export type ExportCheckpointOptions = NonNullable<
  operations['exportCheckpoint']['requestBody']
>['content']['application/json'];
export class CheckpointsResource {
  constructor(private client: Transport) {}
  updateRetention(
    checkpointId: string,
    options: UpdateCheckpointRetentionOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateCheckpointRetention'>> {
    return this.client.request('updateCheckpointRetention', {
      ...requestOptions,
      params: { path: { checkpoint_id: checkpointId } },
      body: options,
    });
  }
  exportArchive(
    checkpointId: string,
    options: ExportCheckpointOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'exportCheckpoint'>> {
    return this.client.request('exportCheckpoint', {
      ...requestOptions,
      params: { path: { checkpoint_id: checkpointId } },
      body: options,
    });
  }
}
export class MeResource {
  constructor(private client: Transport) {}
  get(requestOptions: RequestSettings = {}): Promise<Result<'getIdentity'>> {
    return this.client.request('getIdentity', { ...requestOptions });
  }
}
export type ApplyTransferOptions = NonNullable<
  operations['applyTransfer']['requestBody']
>['content']['application/json'];
export class TransfersResource {
  constructor(private client: Transport) {}
  get(transferId: string, requestOptions: RequestSettings = {}): Promise<Result<'getTransfer'>> {
    return this.client.request('getTransfer', {
      ...requestOptions,
      params: { path: { transfer_id: transferId } },
    });
  }
  apply(
    transferId: string,
    options: ApplyTransferOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'applyTransfer'>> {
    return this.client.request('applyTransfer', {
      ...requestOptions,
      params: { path: { transfer_id: transferId } },
      body: options,
    });
  }
}
export type ListGithubRepositoriesOptions = {
  installation_id: NonNullable<
    operations['listGithubRepositories']['parameters']['query']
  >['installation_id'];
};
export class IntegrationsResource {
  constructor(private client: Transport) {}
  listGithubInstallations(requestOptions: RequestSettings = {}): Promise<Result<'listGithubInstallations'>> {
    return this.client.request('listGithubInstallations', { ...requestOptions });
  }
  listGithubRepositories(
    options: ListGithubRepositoriesOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listGithubRepositories'>> {
    return this.client.request('listGithubRepositories', {
      ...requestOptions,
      params: { query: { installation_id: options.installation_id } },
    });
  }
  disconnectGithub(
    projectId: string,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'disconnectGithub'>> {
    return this.client.request('disconnectGithub', {
      ...requestOptions,
      params: { path: { project_id: projectId } },
    });
  }
}
export type CreateOrganizationOptions = NonNullable<
  operations['createOrganization']['requestBody']
>['content']['application/json'];
export type UpdateOrganizationOptions = NonNullable<
  operations['updateOrganization']['requestBody']
>['content']['application/json'];
export type UpdateMemberOptions = NonNullable<
  operations['updateMember']['requestBody']
>['content']['application/json'];
export type CreateInvitationOptions = NonNullable<
  operations['createInvitation']['requestBody']
>['content']['application/json'];
export type UpdateExecutionPolicyOptions = NonNullable<
  operations['updateExecutionPolicy']['requestBody']
>['content']['application/json'];
export class OrganizationsResource {
  constructor(private client: Transport) {}
  create(
    options: CreateOrganizationOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createOrganization'>> {
    return this.client.request('createOrganization', {
      ...requestOptions,

      body: options,
    });
  }
  update(
    options: UpdateOrganizationOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateOrganization'>> {
    return this.client.request('updateOrganization', {
      ...requestOptions,

      body: options,
    });
  }
  listMembers(requestOptions: RequestSettings = {}): Promise<Result<'listMembers'>> {
    return this.client.request('listMembers', { ...requestOptions });
  }
  updateMember(
    userId: string,
    options: UpdateMemberOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateMember'>> {
    return this.client.request('updateMember', {
      ...requestOptions,
      params: { path: { user_id: userId } },
      body: options,
    });
  }
  removeMember(userId: string, requestOptions: RequestSettings = {}): Promise<Result<'removeMember'>> {
    return this.client.request('removeMember', { ...requestOptions, params: { path: { user_id: userId } } });
  }
  listInvitations(requestOptions: RequestSettings = {}): Promise<Result<'listInvitations'>> {
    return this.client.request('listInvitations', { ...requestOptions });
  }
  createInvitation(
    options: CreateInvitationOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createInvitation'>> {
    return this.client.request('createInvitation', {
      ...requestOptions,

      body: options,
    });
  }
  revokeInvitation(
    invitationId: string,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'revokeInvitation'>> {
    return this.client.request('revokeInvitation', {
      ...requestOptions,
      params: { path: { invitation_id: invitationId } },
    });
  }
  listAudit(requestOptions: RequestSettings = {}): Promise<Result<'listOrganizationAudit'>> {
    return this.client.request('listOrganizationAudit', { ...requestOptions });
  }
  getExecutionPolicy(requestOptions: RequestSettings = {}): Promise<Result<'getExecutionPolicy'>> {
    return this.client.request('getExecutionPolicy', { ...requestOptions });
  }
  updateExecutionPolicy(
    options: UpdateExecutionPolicyOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateExecutionPolicy'>> {
    return this.client.request('updateExecutionPolicy', {
      ...requestOptions,

      body: options,
    });
  }
}
export type ListTriggersOptions = {
  cursor?: NonNullable<operations['listTriggers']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listTriggers']['parameters']['query']>['limit'];
  kind?: NonNullable<operations['listTriggers']['parameters']['query']>['kind'];
};
export type CreateTriggerOptions = NonNullable<
  operations['createTrigger']['requestBody']
>['content']['application/json'];
export type UpdateTriggerOptions = NonNullable<
  operations['updateTrigger']['requestBody']
>['content']['application/json'];
export type RotateTriggerSecretOptions = NonNullable<
  operations['rotateTriggerSecret']['requestBody']
>['content']['application/json'];
export type ListTriggerDeliveriesOptions = {
  cursor?: NonNullable<operations['listTriggerDeliveries']['parameters']['query']>['cursor'];
  limit?: NonNullable<operations['listTriggerDeliveries']['parameters']['query']>['limit'];
};
export type RunTriggerOptions = NonNullable<
  operations['runTrigger']['requestBody']
>['content']['application/json'];
export type RetryTriggerReplyOptions = NonNullable<
  operations['retryTriggerReply']['requestBody']
>['content']['application/json'];
export class TriggersResource {
  constructor(private client: Transport) {}
  list(
    options: ListTriggersOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listTriggers'>> {
    return this.client.request('listTriggers', {
      ...requestOptions,
      params: { query: { cursor: options.cursor, limit: options.limit, kind: options.kind } },
    });
  }
  create(
    options: CreateTriggerOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createTrigger'>> {
    return this.client.request('createTrigger', {
      ...requestOptions,

      body: options,
    });
  }
  get(triggerId: string, requestOptions: RequestSettings = {}): Promise<Result<'getTrigger'>> {
    return this.client.request('getTrigger', {
      ...requestOptions,
      params: { path: { trigger_id: triggerId } },
    });
  }
  update(
    triggerId: string,
    options: UpdateTriggerOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'updateTrigger'>> {
    return this.client.request('updateTrigger', {
      ...requestOptions,
      params: { path: { trigger_id: triggerId } },
      body: options,
    });
  }
  delete(triggerId: string, requestOptions: RequestSettings = {}): Promise<Result<'deleteTrigger'>> {
    return this.client.request('deleteTrigger', {
      ...requestOptions,
      params: { path: { trigger_id: triggerId } },
    });
  }
  rotateSecret(
    triggerId: string,
    options: RotateTriggerSecretOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'rotateTriggerSecret'>> {
    return this.client.request('rotateTriggerSecret', {
      ...requestOptions,
      params: { path: { trigger_id: triggerId } },
      body: options,
    });
  }
  listDeliveries(
    triggerId: string,
    options: ListTriggerDeliveriesOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listTriggerDeliveries'>> {
    return this.client.request('listTriggerDeliveries', {
      ...requestOptions,
      params: { path: { trigger_id: triggerId }, query: { cursor: options.cursor, limit: options.limit } },
    });
  }
  run(
    triggerId: string,
    options: RunTriggerOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'runTrigger'>> {
    return this.client.request('runTrigger', {
      ...requestOptions,
      params: { path: { trigger_id: triggerId } },
      body: options,
    });
  }
  retryReply(
    triggerId: string,
    deliveryId: string,
    options: RetryTriggerReplyOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'retryTriggerReply'>> {
    return this.client.request('retryTriggerReply', {
      ...requestOptions,
      params: { path: { trigger_id: triggerId, delivery_id: deliveryId } },
      body: options,
    });
  }
}
export type CreateSlackConnectionOptions = NonNullable<
  operations['createSlackConnection']['requestBody']
>['content']['application/json'];
export type ListSlackConnectionChannelsOptions = {
  cursor?: NonNullable<operations['listSlackConnectionChannels']['parameters']['query']>['cursor'];
};
export class SlackConnectionsResource {
  constructor(private client: Transport) {}
  list(requestOptions: RequestSettings = {}): Promise<Result<'listSlackConnections'>> {
    return this.client.request('listSlackConnections', { ...requestOptions });
  }
  create(
    options: CreateSlackConnectionOptions,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'createSlackConnection'>> {
    return this.client.request('createSlackConnection', {
      ...requestOptions,

      body: options,
    });
  }
  delete(
    connectionId: string,
    requestOptions: RequestSettings = {},
  ): Promise<Result<'deleteSlackConnection'>> {
    return this.client.request('deleteSlackConnection', {
      ...requestOptions,
      params: { path: { connection_id: connectionId } },
    });
  }
  listChannels(
    connectionId: string,
    options: ListSlackConnectionChannelsOptions = {},
    requestOptions: RequestSettings = {},
  ): Promise<Result<'listSlackConnectionChannels'>> {
    return this.client.request('listSlackConnectionChannels', {
      ...requestOptions,
      params: { path: { connection_id: connectionId }, query: { cursor: options.cursor } },
    });
  }
}
export abstract class Resources {
  abstract request<O extends Operation>(operation: O, options?: RequestOptions<O>): Promise<Result<O>>;
  abstract stream(
    runId: string,
    options?: { after?: string; signal?: AbortSignal },
  ): AsyncGenerator<Schema['Event']>;
  readonly projects = new ProjectsResource(this);
  readonly workspaces = new WorkspacesResource(this);
  readonly agents = new AgentsResource(this);
  readonly sessions = new SessionsResource(this);
  readonly runs = new RunsResource(this);
  readonly artifacts = new ArtifactsResource(this);
  readonly connections = new ConnectionsResource(this);
  readonly apiKeys = new ApiKeysResource(this);
  readonly webhookEndpoints = new WebhookEndpointsResource(this);
  readonly webhookDeliveries = new WebhookDeliveriesResource(this);
  readonly usage = new UsageResource(this);
  readonly requests = new RequestsResource(this);
  readonly billing = new BillingResource(this);
  readonly harnesses = new HarnessesResource(this);
  readonly models = new ModelsResource(this);
  readonly operations = new OperationsResource(this);
  readonly operator = new OperatorResource(this);
  readonly checkpoints = new CheckpointsResource(this);
  readonly me = new MeResource(this);
  readonly transfers = new TransfersResource(this);
  readonly integrations = new IntegrationsResource(this);
  readonly organizations = new OrganizationsResource(this);
  readonly triggers = new TriggersResource(this);
  readonly slackConnections = new SlackConnectionsResource(this);
}
