// Generated from docs/api/openapi.json. Run pnpm sdk:generate after contract changes.
export const routes = {
  "listWorkspaces": {
    "method": "GET",
    "path": "/v1/workspaces"
  },
  "createWorkspace": {
    "method": "POST",
    "path": "/v1/workspaces"
  },
  "getWorkspace": {
    "method": "GET",
    "path": "/v1/workspaces/{workspace_id}"
  },
  "updateWorkspace": {
    "method": "PATCH",
    "path": "/v1/workspaces/{workspace_id}"
  },
  "deleteWorkspace": {
    "method": "DELETE",
    "path": "/v1/workspaces/{workspace_id}"
  },
  "listWorktrees": {
    "method": "GET",
    "path": "/v1/workspaces/{workspace_id}/worktrees"
  },
  "createWorktree": {
    "method": "POST",
    "path": "/v1/workspaces/{workspace_id}/worktrees"
  },
  "getWorktree": {
    "method": "GET",
    "path": "/v1/worktrees/{worktree_id}"
  },
  "deleteWorktree": {
    "method": "DELETE",
    "path": "/v1/worktrees/{worktree_id}"
  },
  "updateWorktree": {
    "method": "PATCH",
    "path": "/v1/worktrees/{worktree_id}"
  },
  "listFiles": {
    "method": "GET",
    "path": "/v1/worktrees/{worktree_id}/files"
  },
  "readFile": {
    "method": "GET",
    "path": "/v1/worktrees/{worktree_id}/file"
  },
  "writeFile": {
    "method": "PUT",
    "path": "/v1/worktrees/{worktree_id}/file"
  },
  "deleteFile": {
    "method": "DELETE",
    "path": "/v1/worktrees/{worktree_id}/file"
  },
  "renameFile": {
    "method": "PATCH",
    "path": "/v1/worktrees/{worktree_id}/file"
  },
  "listCheckpoints": {
    "method": "GET",
    "path": "/v1/worktrees/{worktree_id}/checkpoints"
  },
  "createCheckpoint": {
    "method": "POST",
    "path": "/v1/worktrees/{worktree_id}/checkpoints"
  },
  "restoreWorktree": {
    "method": "POST",
    "path": "/v1/worktrees/{worktree_id}/restore"
  },
  "getSync": {
    "method": "GET",
    "path": "/v1/worktrees/{worktree_id}/sync"
  },
  "syncWorktree": {
    "method": "POST",
    "path": "/v1/worktrees/{worktree_id}/sync"
  },
  "listAgents": {
    "method": "GET",
    "path": "/v1/agents"
  },
  "createAgent": {
    "method": "POST",
    "path": "/v1/agents"
  },
  "getAgent": {
    "method": "GET",
    "path": "/v1/agents/{agent_id}"
  },
  "updateAgent": {
    "method": "PATCH",
    "path": "/v1/agents/{agent_id}"
  },
  "deleteAgent": {
    "method": "DELETE",
    "path": "/v1/agents/{agent_id}"
  },
  "listSessions": {
    "method": "GET",
    "path": "/v1/sessions"
  },
  "createSession": {
    "method": "POST",
    "path": "/v1/sessions"
  },
  "getSession": {
    "method": "GET",
    "path": "/v1/sessions/{session_id}"
  },
  "continueSession": {
    "method": "POST",
    "path": "/v1/sessions/{session_id}/messages"
  },
  "listRuns": {
    "method": "GET",
    "path": "/v1/runs"
  },
  "createRun": {
    "method": "POST",
    "path": "/v1/runs"
  },
  "getRun": {
    "method": "GET",
    "path": "/v1/runs/{run_id}"
  },
  "cancelRun": {
    "method": "POST",
    "path": "/v1/runs/{run_id}/cancel"
  },
  "submitRunInput": {
    "method": "POST",
    "path": "/v1/runs/{run_id}/input"
  },
  "getRunResult": {
    "method": "GET",
    "path": "/v1/runs/{run_id}/result"
  },
  "listRunEvents": {
    "method": "GET",
    "path": "/v1/runs/{run_id}/events"
  },
  "streamRun": {
    "method": "GET",
    "path": "/v1/runs/{run_id}/stream"
  },
  "listArtifacts": {
    "method": "GET",
    "path": "/v1/runs/{run_id}/artifacts"
  },
  "downloadArtifact": {
    "method": "GET",
    "path": "/v1/artifacts/{artifact_id}/download"
  },
  "listConnections": {
    "method": "GET",
    "path": "/v1/connections"
  },
  "createConnection": {
    "method": "POST",
    "path": "/v1/connections"
  },
  "getConnection": {
    "method": "GET",
    "path": "/v1/connections/{connection_id}"
  },
  "updateConnection": {
    "method": "PATCH",
    "path": "/v1/connections/{connection_id}"
  },
  "deleteConnection": {
    "method": "DELETE",
    "path": "/v1/connections/{connection_id}"
  },
  "authorizeConnection": {
    "method": "POST",
    "path": "/v1/connections/{connection_id}/authorize"
  },
  "testConnection": {
    "method": "POST",
    "path": "/v1/connections/{connection_id}/test"
  },
  "listConnectionTools": {
    "method": "GET",
    "path": "/v1/connections/{connection_id}/tools"
  },
  "listApiKeys": {
    "method": "GET",
    "path": "/v1/api-keys"
  },
  "createApiKey": {
    "method": "POST",
    "path": "/v1/api-keys"
  },
  "revokeApiKey": {
    "method": "DELETE",
    "path": "/v1/api-keys/{key_id}"
  },
  "listWebhookEndpoints": {
    "method": "GET",
    "path": "/v1/webhook-endpoints"
  },
  "createWebhookEndpoint": {
    "method": "POST",
    "path": "/v1/webhook-endpoints"
  },
  "updateWebhookEndpoint": {
    "method": "PATCH",
    "path": "/v1/webhook-endpoints/{endpoint_id}"
  },
  "deleteWebhookEndpoint": {
    "method": "DELETE",
    "path": "/v1/webhook-endpoints/{endpoint_id}"
  },
  "listWebhookDeliveries": {
    "method": "GET",
    "path": "/v1/webhook-deliveries"
  },
  "replayWebhookDelivery": {
    "method": "POST",
    "path": "/v1/webhook-deliveries/{delivery_id}/replay"
  },
  "getUsage": {
    "method": "GET",
    "path": "/v1/usage"
  },
  "listRequests": {
    "method": "GET",
    "path": "/v1/requests"
  },
  "getBilling": {
    "method": "GET",
    "path": "/v1/billing"
  },
  "createCheckout": {
    "method": "POST",
    "path": "/v1/billing/checkout"
  },
  "createBillingPortal": {
    "method": "POST",
    "path": "/v1/billing/portal"
  },
  "listHarnesses": {
    "method": "GET",
    "path": "/v1/harnesses"
  },
  "listModels": {
    "method": "GET",
    "path": "/v1/models"
  },
  "getOperation": {
    "method": "GET",
    "path": "/v1/operations/{operation_id}"
  },
  "getGrowthMetrics": {
    "method": "GET",
    "path": "/admin/v1/metrics/growth"
  },
  "getPlatformUsageMetrics": {
    "method": "GET",
    "path": "/admin/v1/metrics/usage"
  },
  "listAccounts": {
    "method": "GET",
    "path": "/admin/v1/accounts"
  },
  "getAccountSummary": {
    "method": "GET",
    "path": "/admin/v1/accounts/{account_id}"
  },
  "listPlatformRequests": {
    "method": "GET",
    "path": "/admin/v1/requests"
  },
  "getRunDiagnostics": {
    "method": "GET",
    "path": "/admin/v1/runs/{run_id}/diagnostics"
  },
  "getInfrastructureHealth": {
    "method": "GET",
    "path": "/admin/v1/infrastructure/health"
  },
  "getCapacityReport": {
    "method": "GET",
    "path": "/admin/v1/infrastructure/capacity"
  },
  "getOperatingReport": {
    "method": "GET",
    "path": "/admin/v1/reports/operating"
  },
  "updateCheckpointRetention": {
    "method": "PATCH",
    "path": "/v1/checkpoints/{checkpoint_id}"
  },
  "rotateWebhookSecret": {
    "method": "POST",
    "path": "/v1/webhook-endpoints/{endpoint_id}/rotate-secret"
  },
  "getIdentity": {
    "method": "GET",
    "path": "/v1/me"
  },
  "getWorktreeDiff": {
    "method": "GET",
    "path": "/v1/worktrees/{worktree_id}/diff"
  },
  "createTransfer": {
    "method": "POST",
    "path": "/v1/worktrees/{worktree_id}/transfers"
  },
  "listTransfers": {
    "method": "GET",
    "path": "/v1/worktrees/{worktree_id}/transfers"
  },
  "getTransfer": {
    "method": "GET",
    "path": "/v1/transfers/{transfer_id}"
  },
  "applyTransfer": {
    "method": "POST",
    "path": "/v1/transfers/{transfer_id}/apply"
  },
  "exportCheckpoint": {
    "method": "POST",
    "path": "/v1/checkpoints/{checkpoint_id}/exports"
  },
  "listGithubInstallations": {
    "method": "GET",
    "path": "/v1/integrations/github/installations"
  },
  "listGithubRepositories": {
    "method": "GET",
    "path": "/v1/integrations/github/repositories"
  },
  "disconnectGithub": {
    "method": "DELETE",
    "path": "/v1/workspaces/{workspace_id}/github"
  },
  "listStdioPackages": {
    "method": "GET",
    "path": "/v1/stdio-packages"
  },
  "createOrganization": {
    "method": "POST",
    "path": "/v1/organizations"
  },
  "updateOrganization": {
    "method": "PATCH",
    "path": "/v1/organization"
  },
  "listMembers": {
    "method": "GET",
    "path": "/v1/organization/members"
  },
  "updateMember": {
    "method": "PATCH",
    "path": "/v1/organization/members/{user_id}"
  },
  "removeMember": {
    "method": "DELETE",
    "path": "/v1/organization/members/{user_id}"
  },
  "listInvitations": {
    "method": "GET",
    "path": "/v1/organization/invitations"
  },
  "createInvitation": {
    "method": "POST",
    "path": "/v1/organization/invitations"
  },
  "revokeInvitation": {
    "method": "DELETE",
    "path": "/v1/organization/invitations/{invitation_id}"
  },
  "listOrganizationAudit": {
    "method": "GET",
    "path": "/v1/organization/audit"
  },
  "getStorage": {
    "method": "GET",
    "path": "/v1/storage"
  },
  "updateStoragePolicy": {
    "method": "PATCH",
    "path": "/v1/storage"
  },
  "scheduleWorkspaceDeletion": {
    "method": "POST",
    "path": "/v1/workspaces/{workspace_id}/deletion"
  },
  "cancelWorkspaceDeletion": {
    "method": "DELETE",
    "path": "/v1/workspaces/{workspace_id}/deletion"
  },
  "listReportSnapshots": {
    "method": "GET",
    "path": "/admin/v1/reports/snapshots"
  },
  "getExecutionPolicy": {
    "method": "GET",
    "path": "/v1/organization/execution-policy"
  },
  "updateExecutionPolicy": {
    "method": "PATCH",
    "path": "/v1/organization/execution-policy"
  },
  "listConnectorCatalog": {
    "method": "GET",
    "path": "/v1/connector-catalog"
  },
  "listTriggers": {
    "method": "GET",
    "path": "/v1/triggers"
  },
  "createTrigger": {
    "method": "POST",
    "path": "/v1/triggers"
  },
  "getTrigger": {
    "method": "GET",
    "path": "/v1/triggers/{trigger_id}"
  },
  "updateTrigger": {
    "method": "PATCH",
    "path": "/v1/triggers/{trigger_id}"
  },
  "deleteTrigger": {
    "method": "DELETE",
    "path": "/v1/triggers/{trigger_id}"
  },
  "rotateTriggerSecret": {
    "method": "POST",
    "path": "/v1/triggers/{trigger_id}/rotate-secret"
  },
  "listTriggerDeliveries": {
    "method": "GET",
    "path": "/v1/triggers/{trigger_id}/deliveries"
  },
  "runTrigger": {
    "method": "POST",
    "path": "/v1/triggers/{trigger_id}/run"
  },
  "retryTriggerReply": {
    "method": "POST",
    "path": "/v1/triggers/{trigger_id}/deliveries/{delivery_id}/retry-reply"
  },
  "listSlackConnections": {
    "method": "GET",
    "path": "/v1/slack-connections"
  },
  "createSlackConnection": {
    "method": "POST",
    "path": "/v1/slack-connections"
  },
  "deleteSlackConnection": {
    "method": "DELETE",
    "path": "/v1/slack-connections/{connection_id}"
  },
  "listSlackConnectionChannels": {
    "method": "GET",
    "path": "/v1/slack-connections/{connection_id}/channels"
  },
  "createFolder": {
    "method": "POST",
    "path": "/v1/worktrees/{worktree_id}/folders"
  },
  "getWorktreeOptions": {
    "method": "GET",
    "path": "/v1/workspaces/{workspace_id}/worktree-options"
  },
  "duplicateFile": {
    "method": "POST",
    "path": "/v1/worktrees/{worktree_id}/files/duplicate"
  },
  "getConnectionAccess": {
    "method": "GET",
    "path": "/v1/connections/{connection_id}/access"
  },
  "updateConnectionAccess": {
    "method": "PATCH",
    "path": "/v1/connections/{connection_id}/access"
  },
  "listConnectionAccessRules": {
    "method": "GET",
    "path": "/v1/connections/{connection_id}/access/rules"
  },
  "createConnectionAccessRule": {
    "method": "POST",
    "path": "/v1/connections/{connection_id}/access/rules"
  },
  "updateConnectionAccessRule": {
    "method": "PATCH",
    "path": "/v1/connections/{connection_id}/access/rules/{rule_id}"
  },
  "deleteConnectionAccessRule": {
    "method": "DELETE",
    "path": "/v1/connections/{connection_id}/access/rules/{rule_id}"
  },
  "resolveConnectionAccess": {
    "method": "POST",
    "path": "/v1/connection-access/resolve"
  },
  "ensureCustomerAgent": {
    "method": "POST",
    "path": "/v1/integration-paths/customer-agents/{customer_id}"
  },
  "listCustomerAgents": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}"
  },
  "getCustomerAgent": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}"
  },
  "sendCustomerAgentMessage": {
    "method": "POST",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/messages"
  },
  "listCustomerAgentConversations": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/conversations"
  },
  "getCustomerAgentRun": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/runs/{run_id}"
  },
  "getCustomerAgentRunResult": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/runs/{run_id}/result"
  },
  "listCustomerAgentRunEvents": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/runs/{run_id}/events"
  },
  "streamCustomerAgentRun": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/runs/{run_id}/stream"
  },
  "cancelCustomerAgentRun": {
    "method": "POST",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/runs/{run_id}/cancel"
  },
  "listCustomerAgentFiles": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/files"
  },
  "readCustomerAgentFile": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/file"
  },
  "listCustomerAgentConnections": {
    "method": "GET",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/connections"
  },
  "createCustomerAgentConnection": {
    "method": "POST",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/connections"
  },
  "deleteCustomerAgentConnection": {
    "method": "DELETE",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/connections/{connection_id}"
  },
  "updateCustomerAgentConnectionPermissions": {
    "method": "PATCH",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/connections/{connection_id}/permissions"
  },
  "authorizeCustomerAgentConnection": {
    "method": "POST",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/connections/{connection_id}/authorize"
  },
  "completeCustomerAgentConnection": {
    "method": "POST",
    "path": "/v1/integration-paths/customer-agents/{customer_id}/{customer_agent_id}/connections/{connection_id}/complete"
  },
  "createInference": {
    "method": "POST",
    "path": "/v1/inferences"
  },
  "createDecisionDefinition": {
    "method": "POST",
    "path": "/v1/decision-definitions"
  },
  "getDecisionDefinition": {
    "method": "GET",
    "path": "/v1/decision-definitions/{definition_id}"
  },
  "deleteDecisionDefinition": {
    "method": "DELETE",
    "path": "/v1/decision-definitions/{definition_id}"
  },
  "createContextArtifact": {
    "method": "POST",
    "path": "/v1/context-artifacts"
  },
  "getContextArtifact": {
    "method": "GET",
    "path": "/v1/context-artifacts/{artifact_id}"
  },
  "deleteContextArtifact": {
    "method": "DELETE",
    "path": "/v1/context-artifacts/{artifact_id}"
  },
  "createBoundedAgentRun": {
    "method": "POST",
    "path": "/v1/bounded-agent-runs"
  },
  "createDecisionTask": {
    "method": "POST",
    "path": "/v1/tasks"
  },
  "getDecisionTask": {
    "method": "GET",
    "path": "/v1/tasks/{task_id}"
  },
  "wakeDecisionTask": {
    "method": "POST",
    "path": "/v1/tasks/{task_id}/wake"
  },
  "recordTaskOutcome": {
    "method": "POST",
    "path": "/v1/tasks/{task_id}/outcomes"
  },
  "closeDecisionTask": {
    "method": "POST",
    "path": "/v1/tasks/{task_id}/close"
  },
  "deleteArtifact": {
    "method": "DELETE",
    "path": "/v1/artifacts/{artifact_id}"
  },
  "listBillingUsage": {
    "method": "GET",
    "path": "/v1/billing/usage"
  },
  "listWorkers": {
    "method": "GET",
    "path": "/v1/workers"
  },
  "createWorker": {
    "method": "POST",
    "path": "/v1/workers"
  },
  "getWorker": {
    "method": "GET",
    "path": "/v1/workers/{worker_id}"
  },
  "patchWorker": {
    "method": "PATCH",
    "path": "/v1/workers/{worker_id}"
  },
  "pauseWorker": {
    "method": "POST",
    "path": "/v1/workers/{worker_id}/pause"
  },
  "resumeWorker": {
    "method": "POST",
    "path": "/v1/workers/{worker_id}/resume"
  },
  "destroyWorker": {
    "method": "POST",
    "path": "/v1/workers/{worker_id}/destroy"
  },
  "listWorkerOfferings": {
    "method": "GET",
    "path": "/v1/worker-offerings"
  }
} as const;
