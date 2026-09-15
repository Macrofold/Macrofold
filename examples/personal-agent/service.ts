import { z } from 'zod';
import { Macrofold, type Schema } from '../../sdk/typescript/src/index';
import { fileMemory, taskFileSchema } from '../shared/file-memory';
import { AgentStore, AppError, agentRecord, type AgentRecord } from './store';

const memory = fileMemory();
const runIdentity = z.object({ run_id: z.uuid(), session_id: z.uuid() });
const projectIdentity = z.object({ id: z.uuid(), default_workspace_id: z.uuid() });
const done = z.literal(true);
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup'), name: z.string().trim().min(1).max(80) }),
  z.object({
    action: z.literal('chat'),
    prompt: z.string().trim().min(1).max(10000),
    conversationId: z.uuid().optional(),
  }),
  z.object({ action: z.literal('connect'), secret: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('schedule'), timezone: z.string().min(1).max(100) }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('delete'), confirmation: z.string() }),
  z.object({
    action: z.literal('write'),
    path: z.string(),
    content: z.string().max(100000),
    revision: z.string().min(1),
  }),
  z.object({ action: z.literal('forget'), path: z.string(), revision: z.string().min(1) }),
]);
export type Action = z.infer<typeof actionSchema>;
export type AgentConfiguration = Pick<
  Schema['AgentCreate'],
  'harness' | 'model' | 'billing_mode' | 'provider_connection_id'
> & { budgetMicroUsd: string };
const requireId = (value: string | undefined) => z.uuid().parse(value);
const requireRevision = (value: string | null) => z.string().min(1).parse(value);

/** The customer ID must come from verified application authentication, never a request parameter.
 * All platform IDs are resolved from this customer's record before the SDK is called. */
export class PersonalAgents {
  private busy = new Set<string>();
  constructor(
    readonly store: AgentStore,
    private client: Macrofold,
    readonly configuration: AgentConfiguration,
  ) {}
  list(customerId: string) {
    return this.store.list(customerId);
  }
  async act(customerId: string, agentId: string, requestId: string, raw: unknown) {
    z.uuid().parse(agentId);
    z.uuid().parse(requestId);
    const parsed = actionSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, 'Check the fields and try again.', true);
    const action = parsed.data;
    if (this.busy.has(agentId))
      throw new AppError(409, 'Another action is finishing. Try again in a moment.');
    this.busy.add(agentId);
    try {
      const record =
        action.action === 'setup'
          ? this.store.create(customerId, agentId, action.name)
          : this.store.get(customerId, agentId);
      return await this.store.step(agentId, `action/${requestId}`, action, agentRecord, async () => {
        if (record.status === 'deleted') throw new AppError(409, 'This agent has been deleted.');
        if (action.action === 'setup') return await this.setup(record);
        if (record.status === 'setting_up')
          throw new AppError(409, 'Finish setup first. Retry with the same agent ID and name.');
        if (record.status !== 'active' && ['chat', 'schedule', 'connect'].includes(action.action))
          throw new AppError(409, 'Resume this agent before starting new work.');
        const step = <T>(
          name: string,
          schema: z.ZodType<T>,
          execute: (options: { idempotencyKey: string; revision: string | null }) => Promise<T>,
          revision?: () => Promise<string>,
        ) => this.store.step(record.id, `${requestId}/${name}`, action, schema, execute, revision);
        const workspaceId = requireId(record.workspaceId),
          projectId = requireId(record.projectId),
          presetId = requireId(record.presetId);
        if (action.action === 'chat') {
          if (action.conversationId && !record.conversations.includes(action.conversationId))
            throw new AppError(404, 'Conversation not found.');
          const run = await step('run', runIdentity, (options) =>
            this.client.runs.create(
              {
                ...(action.conversationId
                  ? { session_id: action.conversationId }
                  : { workspace_id: workspaceId, agent_id: presetId }),
                prompt: action.prompt,
              },
              options,
            ),
          );
          record.conversations = [...new Set([...record.conversations, run.session_id])];
          record.runs = [...new Set([...record.runs, run.run_id])];
        } else if (action.action === 'connect') {
          if (record.connectionActionId && record.connectionActionId !== requestId)
            throw new AppError(
              409,
              'This agent already has a search account. Disconnect it in the dashboard before replacing it.',
            );
          record.connectionActionId = requestId;
          this.store.save(record);
          const connectionId = await step(
            'connection',
            z.uuid(),
            async (options) =>
              (
                await this.client.connections.create(
                  {
                    name: `${record.name} search`,
                    kind: 'search',
                    provider: 'exa',
                    auth_method: 'api_key',
                    secret: action.secret,
                  },
                  options,
                )
              ).id,
          );
          await step(
            'approve',
            done,
            async (options) => {
              await this.client.connections.updateAccess(
                connectionId,
                { tools: ['web_search'], ifMatch: requireRevision(options.revision) },
                options,
              );
              return true;
            },
            async () => `"${(await this.client.connections.getAccess(connectionId)).version}"`,
          );
          await step(
            'scope',
            done,
            async (options) => {
              await this.client.connections.createAccessRule(
                connectionId,
                {
                  scope: 'project_agent',
                  project_id: projectId,
                  agent_id: presetId,
                  ifMatch: requireRevision(options.revision),
                },
                options,
              );
              return true;
            },
            async () => `"${(await this.client.connections.getAccess(connectionId)).version}"`,
          );
          // Explicit selection prevents other organization-wide connections from being inherited.
          await step('selection', done, async (options) => {
            await this.client.agents.update(
              presetId,
              { connection_grants: [{ connection_id: connectionId, tools: ['web_search'] }] },
              options,
            );
            return true;
          });
          record.connectionId = connectionId;
        } else if (action.action === 'schedule') {
          try {
            new Intl.DateTimeFormat('en', { timeZone: action.timezone }).format();
          } catch {
            throw new AppError(400, 'Choose a valid IANA timezone, such as America/New_York.', true);
          }
          if (record.scheduleActionId && record.scheduleActionId !== requestId)
            throw new AppError(409, 'This agent already has a weekly schedule. Manage it in the dashboard.');
          record.scheduleActionId = requestId;
          this.store.save(record);
          record.triggerId = await step(
            'schedule',
            z.uuid(),
            async (options) =>
              (
                await this.client.triggers.create(
                  {
                    name: `${record.name} weekly review`,
                    kind: 'schedule',
                    project_id: projectId,
                    agent_id: presetId,
                    cron: '0 9 * * 1',
                    timezone: action.timezone,
                    enabled: true,
                    max_runs_per_day: 1,
                    prompt:
                      'Review current profile, memory and tasks. Update weekly-plan.md with completed work, next steps and uncertainties. Do not send messages or make purchases.',
                  },
                  options,
                )
              ).id,
          );
        } else if (action.action === 'write' || action.action === 'forget') {
          this.memoryPath(action.path);
          if (action.action === 'write' && action.path === memory.paths.tasks) {
            try {
              taskFileSchema.parse(JSON.parse(action.content));
            } catch {
              throw new AppError(400, 'Use the documented tasks.json format.', true);
            }
          }
          await step('file', done, async (options) => {
            if (action.action === 'write')
              await this.client.workspaces.writeFile(
                workspaceId,
                {
                  path: action.path,
                  ifMatch: action.revision,
                  content: new TextEncoder().encode(action.content),
                },
                options,
              );
            else
              await this.client.workspaces.deleteFile(
                workspaceId,
                { path: action.path, ifMatch: action.revision },
                options,
              );
            return true;
          });
        } else if (action.action === 'delete') {
          if (action.confirmation !== record.name)
            throw new AppError(400, 'Type the agent name to confirm deletion.', true);
          // Set paused first: retries cannot admit app work during partial cleanup.
          record.status = 'paused';
          this.store.save(record);
          await step('project-deletion', done, async (options) => {
            const project = await this.client.projects.get(projectId);
            await this.client.projects.scheduleDeletion(projectId, { confirmation: project.name }, options);
            return true;
          });
          if (record.connectionId)
            await step('disconnect', done, async (options) => {
              await this.client.connections.delete(requireId(record.connectionId), options);
              return true;
            });
          record.status = 'deleted';
        } else {
          record.status = 'paused';
          this.store.save(record);
          if (record.triggerId)
            await step('schedule-enabled', done, async (options) => {
              await this.client.triggers.update(
                requireId(record.triggerId),
                { enabled: action.action === 'resume' },
                options,
              );
              return true;
            });
          // Pausing prevents future starts; an accepted run is cancelled explicitly, including schedule runs.
          if (action.action === 'pause') {
            let cursor: string | undefined;
            do {
              const page = await this.client.runs.list({ project_id: projectId, cursor, limit: 100 });
              for (const run of page.data)
                if (['queued', 'provisioning', 'running', 'waiting_for_input'].includes(run.status))
                  await step(`cancel-${run.id}`, done, async (options) => {
                    await this.client.runs.cancel(run.id, {}, options);
                    return true;
                  });
              cursor = page.next_cursor || undefined;
            } while (cursor);
          }
          record.status = action.action === 'resume' ? 'active' : 'paused';
        }
        this.store.save(record);
        return record;
      });
    } finally {
      this.busy.delete(agentId);
    }
  }
  private async setup(record: AgentRecord) {
    if (record.status !== 'setting_up') return record;
    const step = <T>(
      name: string,
      input: unknown,
      schema: z.ZodType<T>,
      call: (options: { idempotencyKey: string; revision: string | null }) => Promise<T>,
      revision?: () => Promise<string>,
    ) => this.store.step(record.id, `setup/${name}`, input, schema, call, revision);
    const project = await step('project', { name: record.name }, projectIdentity, async (options) =>
      projectIdentity.parse(
        await this.client.projects.create({ name: `${record.name} · ${record.id}` }, options),
      ),
    );
    record.projectId = project.id;
    record.workspaceId = project.default_workspace_id;
    this.store.save(record);
    const { budgetMicroUsd, ...route } = this.configuration;
    record.presetId = await step(
      'preset',
      this.configuration,
      z.uuid(),
      async (options) =>
        (
          await this.client.agents.create(
            {
              name: record.name,
              ...route,
              limits: { max_cost_micro_usd: budgetMicroUsd },
              connection_grants: [],
              instructions: `Your name is ${record.name}. Help this customer manage their personal plans.\n\n${memory.instructions}`,
            },
            options,
          )
        ).id,
    );
    this.store.save(record);
    for (const [path, content] of Object.entries(memory.files))
      await step(
        `file/${path}`,
        { path, content },
        done,
        async (options) => {
          await this.client.workspaces.writeFile(
            project.default_workspace_id,
            {
              path,
              content: new TextEncoder().encode(content),
              create_only: true,
              ifMatch: requireRevision(options.revision),
            },
            options,
          );
          return true;
        },
        async () => (await this.client.workspaces.get(project.default_workspace_id)).revision,
      );
    record.status = 'active';
    this.store.save(record);
    return record;
  }
  private memoryPath(path: string) {
    if (
      ![memory.paths.profile, memory.paths.tasks].includes(path) &&
      !/^memory\/[a-zA-Z0-9_-]+\.md$/.test(path)
    )
      throw new AppError(400, 'Choose profile.md, tasks.json, or a Markdown note under memory/.', true);
  }
  async readMemory(customerId: string, agentId: string, path: string) {
    const agent = this.store.get(customerId, agentId);
    this.memoryPath(path);
    // ReadFile's ETag and body refer to the same published revision. A later write must use it.
    const response = await this.client.raw('readFile', {
      params: { path: { workspace_id: requireId(agent.workspaceId) }, query: { path } },
    });
    return { content: await response.text(), revision: z.string().parse(response.headers.get('etag')) };
  }
  async activity(customerId: string, agentId: string) {
    const agent = this.store.get(customerId, agentId);
    if (agent.status === 'deleted' || !agent.projectId) return { runs: [], files: [], schedule: null };
    const runs = await this.client.runs.list({ project_id: agent.projectId, limit: 30 });
    return {
      runs: await Promise.all(
        runs.data.map(async (run) => ({
          id: run.id,
          sessionId: run.session_id,
          status: run.status,
          ...(await this.client.runs.getResult(run.id)),
        })),
      ),
      files: (
        await this.client.workspaces.listFiles(requireId(agent.workspaceId), { recursive: true, limit: 100 })
      ).entries,
      schedule: agent.triggerId ? await this.client.triggers.get(agent.triggerId) : null,
    };
  }
}
