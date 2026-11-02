import type { HandlerMap, PreparationMap, ReplayAuthorizerMap } from './api-types';
import { input } from './api-types';
import { assert } from './errors';
import {
  prepareManualMemorySearch,
  authorizeMemorySearchReplay,
  forgetRemoteMemory,
  listMemoryActivity,
  readMemorySource,
  addMemoryNote,
  retryMemoryCheck,
} from './integration-memory';
import {
  listIntegrationPacks,
  listIntegrations,
  getIntegration,
  presentIntegration,
  prepareIntegrationInstall,
  setIntegrationState,
  removeIntegration,
  listIntegrationMemories,
  prepareMemoryEdit,
  prepareMemoryExport,
} from './agent-integrations';

export const agentIntegrationHandlers = {
  listIntegrationPacks: async () => listIntegrationPacks(),
  listAgentIntegrations: (c) => listIntegrations(c.tx, c.p, c.query),
  getAgentIntegration: async (c) =>
    presentIntegration(await getIntegration(c.tx, c.p, c.params.integration_id)),
  updateAgentIntegration: (c) =>
    setIntegrationState(
      c.tx,
      c.p,
      c.params.integration_id,
      input<'AgentIntegrationPatch'>(c).state,
      (c.request.headers.get('if-match') || '').replace(/^"|"$/g, ''),
    ),
  deleteAgentIntegration: (c) => removeIntegration(c.tx, c.p, c.params.integration_id),
  listAgentIntegrationMemories: (c) => listIntegrationMemories(c.tx, c.p, c.params.integration_id, c.query),
  listAgentIntegrationActivity: async (c) =>
    listMemoryActivity(c.tx, await getIntegration(c.tx, c.p, c.params.integration_id), c.query),
  getAgentIntegrationSource: async (c) =>
    readMemorySource(c.tx, await getIntegration(c.tx, c.p, c.params.integration_id), c.params.source_id),
  createAgentIntegrationNote: async (c) =>
    addMemoryNote(
      c.tx,
      await getIntegration(c.tx, c.p, c.params.integration_id),
      input<'AgentMemoryEdit'>(c).content,
    ),
  retryAgentIntegrationCheck: async (c) =>
    retryMemoryCheck(c.tx, await getIntegration(c.tx, c.p, c.params.integration_id), c.params.source_id),
  forgetAgentIntegrationMemory: async (c) => {
    const row = await getIntegration(c.tx, c.p, c.params.integration_id);
    assert(
      String(row.revision) === (c.request.headers.get('if-match') || '').replace(/^"|"$/g, ''),
      412,
      'stale_revision',
      'Memory settings changed. Reload before forgetting.',
    );
    return forgetRemoteMemory(c.tx, row);
  },
} satisfies HandlerMap;

export const agentIntegrationPreparations = {
  createAgentIntegration: (c) => prepareIntegrationInstall(c.p, input<'AgentIntegrationCreate'>(c)),
  exportAgentIntegrationMemory: (c) => prepareMemoryExport(c.p, c.params.integration_id),
  writeAgentIntegrationMemory: (c) =>
    prepareMemoryEdit(
      c.p,
      c.params.integration_id,
      c.query.get('path') || '',
      (c.request.headers.get('if-match') || '').replace(/^"|"$/g, ''),
      input<'AgentMemoryEdit'>(c).content,
    ),
  deleteAgentIntegrationMemory: (c) =>
    prepareMemoryEdit(
      c.p,
      c.params.integration_id,
      c.query.get('path') || '',
      (c.request.headers.get('if-match') || '').replace(/^"|"$/g, ''),
    ),
  searchAgentIntegrationMemory: (c) =>
    prepareManualMemorySearch(
      c.p,
      c.params.integration_id,
      c.idempotencyKey,
      input<'AgentMemorySearch'>(c).query,
      c.requestId,
    ),
} satisfies PreparationMap;

export const agentIntegrationReplayAuthorizers = {
  searchAgentIntegrationMemory: (c) =>
    authorizeMemorySearchReplay(c.tx, c.p, c.params.integration_id, c.idempotencyKey, c.body),
} satisfies ReplayAuthorizerMap;
