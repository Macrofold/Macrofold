# SDK resource reference

Generated from the [OpenAPI contract](../../../api/openapi.json). All 173 public operations have a resource method. Start with the [language guides](README.md) for installation, authentication, and runnable examples.

Names below follow each language's casing. TypeScript, Python, and Go use resource properties; Java and Rust use resource accessors, such as `client.workspaces().create(...)`. Rust network methods are async. Signatures and response types are available in editor completion and checked-in generated sources; query/header options use typed parameter classes in Go, Rust, and Java. Python uses keyword arguments; TypeScript uses typed options.

Path identifiers are positional. Required request values stay typed; optional transport settings expose idempotency, cancellation, and organization selection where supported. Methods retain each SDK's documented transport behavior. The run `events` method delegates to resumable incremental streaming; `stream` remains available. Closing a stream leaves the remote run active; call `runs.cancel` to stop it.

## Run convenience helpers

These compose existing operations and add no backend endpoints.

| Purpose | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| Assistant text fragments | `runs.streamText` | `runs.stream_text` | `Runs.StreamText` |
| Typed complete result after execution and persistence | `runs.wait` | `runs.wait` | `Runs.Wait` |

Text streams handle SSE, cursors and duplicate suppression internally, excluding tool payloads and status events. Both convenience helpers report unsuccessful execution or persistence as a typed run error carrying the run ID. A wait timeout stops local waiting without cancelling execution. The language guides describe timeout options, callbacks/iterators, and advanced replay.

## Workspaces

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listWorkspaces` | `workspaces.list` | `workspaces.list` | `Workspaces.List` |
| `createWorkspace` | `workspaces.create` | `workspaces.create` | `Workspaces.Create` |
| `getWorkspace` | `workspaces.get` | `workspaces.get` | `Workspaces.Get` |
| `updateWorkspace` | `workspaces.update` | `workspaces.update` | `Workspaces.Update` |
| `deleteWorkspace` | `workspaces.delete` | `workspaces.delete` | `Workspaces.Delete` |
| `listWorktrees` | `workspaces.listWorktrees` | `workspaces.list_worktrees` | `Workspaces.ListWorktrees` |
| `createWorktree` | `workspaces.createWorktree` | `workspaces.create_worktree` | `Workspaces.CreateWorktree` |
| `scheduleWorkspaceDeletion` | `workspaces.scheduleDeletion` | `workspaces.schedule_deletion` | `Workspaces.ScheduleDeletion` |
| `cancelWorkspaceDeletion` | `workspaces.cancelDeletion` | `workspaces.cancel_deletion` | `Workspaces.CancelDeletion` |
| `getWorktreeOptions` | `workspaces.getWorktreeOptions` | `workspaces.get_worktree_options` | `Workspaces.GetWorktreeOptions` |

## Worktrees

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getWorktree` | `worktrees.get` | `worktrees.get` | `Worktrees.Get` |
| `deleteWorktree` | `worktrees.delete` | `worktrees.delete` | `Worktrees.Delete` |
| `updateWorktree` | `worktrees.update` | `worktrees.update` | `Worktrees.Update` |
| `listFiles` | `worktrees.listFiles` | `worktrees.list_files` | `Worktrees.ListFiles` |
| `readFile` | `worktrees.readFile` | `worktrees.read_file` | `Worktrees.ReadFile` |
| `writeFile` | `worktrees.writeFile` | `worktrees.write_file` | `Worktrees.WriteFile` |
| `deleteFile` | `worktrees.deleteFile` | `worktrees.delete_file` | `Worktrees.DeleteFile` |
| `renameFile` | `worktrees.renameFile` | `worktrees.rename_file` | `Worktrees.RenameFile` |
| `listCheckpoints` | `worktrees.listCheckpoints` | `worktrees.list_checkpoints` | `Worktrees.ListCheckpoints` |
| `createCheckpoint` | `worktrees.createCheckpoint` | `worktrees.create_checkpoint` | `Worktrees.CreateCheckpoint` |
| `restoreWorktree` | `worktrees.restore` | `worktrees.restore` | `Worktrees.Restore` |
| `getSync` | `worktrees.getSync` | `worktrees.get_sync` | `Worktrees.GetSync` |
| `syncWorktree` | `worktrees.sync` | `worktrees.sync` | `Worktrees.Sync` |
| `getWorktreeDiff` | `worktrees.getDiff` | `worktrees.get_diff` | `Worktrees.GetDiff` |
| `createTransfer` | `worktrees.createTransfer` | `worktrees.create_transfer` | `Worktrees.CreateTransfer` |
| `listTransfers` | `worktrees.listTransfers` | `worktrees.list_transfers` | `Worktrees.ListTransfers` |
| `createFolder` | `worktrees.createFolder` | `worktrees.create_folder` | `Worktrees.CreateFolder` |
| `duplicateFile` | `worktrees.duplicateFile` | `worktrees.duplicate_file` | `Worktrees.DuplicateFile` |

## Agents

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listAgents` | `agents.list` | `agents.list` | `Agents.List` |
| `createAgent` | `agents.create` | `agents.create` | `Agents.Create` |
| `getAgent` | `agents.get` | `agents.get` | `Agents.Get` |
| `updateAgent` | `agents.update` | `agents.update` | `Agents.Update` |
| `deleteAgent` | `agents.delete` | `agents.delete` | `Agents.Delete` |

## Sessions

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listSessions` | `sessions.list` | `sessions.list` | `Sessions.List` |
| `createSession` | `sessions.create` | `sessions.create` | `Sessions.Create` |
| `getSession` | `sessions.get` | `sessions.get` | `Sessions.Get` |
| `continueSession` | `sessions.continueRun` | `sessions.continue_run` | `Sessions.ContinueRun` |

## Runs

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listRuns` | `runs.list` | `runs.list` | `Runs.List` |
| `createRun` | `runs.create` | `runs.create` | `Runs.Create` |
| `getRun` | `runs.get` | `runs.get` | `Runs.Get` |
| `cancelRun` | `runs.cancel` | `runs.cancel` | `Runs.Cancel` |
| `submitRunInput` | `runs.submitInput` | `runs.submit_input` | `Runs.SubmitInput` |
| `getRunResult` | `runs.getResult` | `runs.get_result` | `Runs.GetResult` |
| `listRunEvents` | `runs.listEvents` | `runs.list_events` | `Runs.ListEvents` |
| `streamRun` | `runs.events` | `runs.events` | `Runs.Events` |
| `listArtifacts` | `runs.listArtifacts` | `runs.list_artifacts` | `Runs.ListArtifacts` |

## Artifacts

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `downloadArtifact` | `artifacts.download` | `artifacts.download` | `Artifacts.Download` |
| `deleteArtifact` | `artifacts.delete` | `artifacts.delete` | `Artifacts.Delete` |

## Connections

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listConnections` | `connections.list` | `connections.list` | `Connections.List` |
| `createConnection` | `connections.create` | `connections.create` | `Connections.Create` |
| `getConnection` | `connections.get` | `connections.get` | `Connections.Get` |
| `updateConnection` | `connections.update` | `connections.update` | `Connections.Update` |
| `deleteConnection` | `connections.delete` | `connections.delete` | `Connections.Delete` |
| `authorizeConnection` | `connections.authorize` | `connections.authorize` | `Connections.Authorize` |
| `testConnection` | `connections.test` | `connections.test` | `Connections.Test` |
| `listConnectionTools` | `connections.listTools` | `connections.list_tools` | `Connections.ListTools` |
| `listStdioPackages` | `connections.listStdioPackages` | `connections.list_stdio_packages` | `Connections.ListStdioPackages` |
| `listConnectorCatalog` | `connections.listConnectorCatalog` | `connections.list_connector_catalog` | `Connections.ListConnectorCatalog` |
| `getConnectionAccess` | `connections.getAccess` | `connections.get_access` | `Connections.GetAccess` |
| `updateConnectionAccess` | `connections.updateAccess` | `connections.update_access` | `Connections.UpdateAccess` |
| `listConnectionAccessRules` | `connections.listAccessRules` | `connections.list_access_rules` | `Connections.ListAccessRules` |
| `createConnectionAccessRule` | `connections.createAccessRule` | `connections.create_access_rule` | `Connections.CreateAccessRule` |
| `updateConnectionAccessRule` | `connections.updateAccessRule` | `connections.update_access_rule` | `Connections.UpdateAccessRule` |
| `deleteConnectionAccessRule` | `connections.deleteAccessRule` | `connections.delete_access_rule` | `Connections.DeleteAccessRule` |
| `resolveConnectionAccess` | `connections.resolveAccess` | `connections.resolve_access` | `Connections.ResolveAccess` |

## ApiKeys

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listApiKeys` | `apiKeys.list` | `api_keys.list` | `ApiKeys.List` |
| `createApiKey` | `apiKeys.create` | `api_keys.create` | `ApiKeys.Create` |
| `revokeApiKey` | `apiKeys.revoke` | `api_keys.revoke` | `ApiKeys.Revoke` |

## WebhookEndpoints

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listWebhookEndpoints` | `webhookEndpoints.list` | `webhook_endpoints.list` | `WebhookEndpoints.List` |
| `createWebhookEndpoint` | `webhookEndpoints.create` | `webhook_endpoints.create` | `WebhookEndpoints.Create` |
| `updateWebhookEndpoint` | `webhookEndpoints.update` | `webhook_endpoints.update` | `WebhookEndpoints.Update` |
| `deleteWebhookEndpoint` | `webhookEndpoints.delete` | `webhook_endpoints.delete` | `WebhookEndpoints.Delete` |
| `rotateWebhookSecret` | `webhookEndpoints.rotateWebhookSecret` | `webhook_endpoints.rotate_webhook_secret` | `WebhookEndpoints.RotateWebhookSecret` |

## WebhookDeliveries

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listWebhookDeliveries` | `webhookDeliveries.list` | `webhook_deliveries.list` | `WebhookDeliveries.List` |
| `replayWebhookDelivery` | `webhookDeliveries.replay` | `webhook_deliveries.replay` | `WebhookDeliveries.Replay` |

## Usage

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getUsage` | `usage.get` | `usage.get` | `Usage.Get` |

## Requests

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listRequests` | `requests.list` | `requests.list` | `Requests.List` |

## Billing

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getBilling` | `billing.get` | `billing.get` | `Billing.Get` |
| `createCheckout` | `billing.createCheckout` | `billing.create_checkout` | `Billing.CreateCheckout` |
| `createBillingPortal` | `billing.createPortal` | `billing.create_portal` | `Billing.CreatePortal` |
| `getStorage` | `billing.getStorage` | `billing.get_storage` | `Billing.GetStorage` |
| `updateStoragePolicy` | `billing.updateStoragePolicy` | `billing.update_storage_policy` | `Billing.UpdateStoragePolicy` |
| `listBillingUsage` | `billing.listUsage` | `billing.list_usage` | `Billing.ListUsage` |

## Harnesses

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listHarnesses` | `harnesses.list` | `harnesses.list` | `Harnesses.List` |

## Models

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listModels` | `models.list` | `models.list` | `Models.List` |

## Operations

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getOperation` | `operations.get` | `operations.get` | `Operations.Get` |

## Operator

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getGrowthMetrics` | `operator.getGrowthMetrics` | `operator.get_growth_metrics` | `Operator.GetGrowthMetrics` |
| `getPlatformUsageMetrics` | `operator.getPlatformUsageMetrics` | `operator.get_platform_usage_metrics` | `Operator.GetPlatformUsageMetrics` |
| `listAccounts` | `operator.listAccounts` | `operator.list_accounts` | `Operator.ListAccounts` |
| `getAccountSummary` | `operator.getAccountSummary` | `operator.get_account_summary` | `Operator.GetAccountSummary` |
| `listPlatformRequests` | `operator.listPlatformRequests` | `operator.list_platform_requests` | `Operator.ListPlatformRequests` |
| `getRunDiagnostics` | `operator.getRunDiagnostics` | `operator.get_run_diagnostics` | `Operator.GetRunDiagnostics` |
| `getInfrastructureHealth` | `operator.getInfrastructureHealth` | `operator.get_infrastructure_health` | `Operator.GetInfrastructureHealth` |
| `getCapacityReport` | `operator.getCapacityReport` | `operator.get_capacity_report` | `Operator.GetCapacityReport` |
| `getOperatingReport` | `operator.getOperatingReport` | `operator.get_operating_report` | `Operator.GetOperatingReport` |
| `listReportSnapshots` | `operator.listReportSnapshots` | `operator.list_report_snapshots` | `Operator.ListReportSnapshots` |

## Checkpoints

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `updateCheckpointRetention` | `checkpoints.updateRetention` | `checkpoints.update_retention` | `Checkpoints.UpdateRetention` |
| `exportCheckpoint` | `checkpoints.exportArchive` | `checkpoints.export_archive` | `Checkpoints.ExportArchive` |

## Me

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getIdentity` | `me.get` | `me.get` | `Me.Get` |

## Transfers

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getTransfer` | `transfers.get` | `transfers.get` | `Transfers.Get` |
| `applyTransfer` | `transfers.apply` | `transfers.apply` | `Transfers.Apply` |

## Integrations

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listGithubInstallations` | `integrations.listGithubInstallations` | `integrations.list_github_installations` | `Integrations.ListGithubInstallations` |
| `listGithubRepositories` | `integrations.listGithubRepositories` | `integrations.list_github_repositories` | `Integrations.ListGithubRepositories` |
| `disconnectGithub` | `integrations.disconnectGithub` | `integrations.disconnect_github` | `Integrations.DisconnectGithub` |

## Organizations

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `createOrganization` | `organizations.create` | `organizations.create` | `Organizations.Create` |
| `updateOrganization` | `organizations.update` | `organizations.update` | `Organizations.Update` |
| `listMembers` | `organizations.listMembers` | `organizations.list_members` | `Organizations.ListMembers` |
| `updateMember` | `organizations.updateMember` | `organizations.update_member` | `Organizations.UpdateMember` |
| `removeMember` | `organizations.removeMember` | `organizations.remove_member` | `Organizations.RemoveMember` |
| `listInvitations` | `organizations.listInvitations` | `organizations.list_invitations` | `Organizations.ListInvitations` |
| `createInvitation` | `organizations.createInvitation` | `organizations.create_invitation` | `Organizations.CreateInvitation` |
| `revokeInvitation` | `organizations.revokeInvitation` | `organizations.revoke_invitation` | `Organizations.RevokeInvitation` |
| `listOrganizationAudit` | `organizations.listAudit` | `organizations.list_audit` | `Organizations.ListAudit` |
| `getExecutionPolicy` | `organizations.getExecutionPolicy` | `organizations.get_execution_policy` | `Organizations.GetExecutionPolicy` |
| `updateExecutionPolicy` | `organizations.updateExecutionPolicy` | `organizations.update_execution_policy` | `Organizations.UpdateExecutionPolicy` |

## Triggers

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listTriggers` | `triggers.list` | `triggers.list` | `Triggers.List` |
| `createTrigger` | `triggers.create` | `triggers.create` | `Triggers.Create` |
| `getTrigger` | `triggers.get` | `triggers.get` | `Triggers.Get` |
| `updateTrigger` | `triggers.update` | `triggers.update` | `Triggers.Update` |
| `deleteTrigger` | `triggers.delete` | `triggers.delete` | `Triggers.Delete` |
| `rotateTriggerSecret` | `triggers.rotateSecret` | `triggers.rotate_secret` | `Triggers.RotateSecret` |
| `listTriggerDeliveries` | `triggers.listDeliveries` | `triggers.list_deliveries` | `Triggers.ListDeliveries` |
| `runTrigger` | `triggers.run` | `triggers.run` | `Triggers.Run` |
| `retryTriggerReply` | `triggers.retryReply` | `triggers.retry_reply` | `Triggers.RetryReply` |

## SlackConnections

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listSlackConnections` | `slackConnections.list` | `slack_connections.list` | `SlackConnections.List` |
| `createSlackConnection` | `slackConnections.create` | `slack_connections.create` | `SlackConnections.Create` |
| `deleteSlackConnection` | `slackConnections.delete` | `slack_connections.delete` | `SlackConnections.Delete` |
| `listSlackConnectionChannels` | `slackConnections.listChannels` | `slack_connections.list_channels` | `SlackConnections.ListChannels` |

## CustomerAgents

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `ensureCustomerAgent` | `customerAgents.ensure` | `customer_agents.ensure` | `CustomerAgents.Ensure` |
| `listCustomerAgents` | `customerAgents.list` | `customer_agents.list` | `CustomerAgents.List` |
| `getCustomerAgent` | `customerAgents.get` | `customer_agents.get` | `CustomerAgents.Get` |
| `sendCustomerAgentMessage` | `customerAgents.sendMessage` | `customer_agents.send_message` | `CustomerAgents.SendMessage` |
| `listCustomerAgentConversations` | `customerAgents.listConversations` | `customer_agents.list_conversations` | `CustomerAgents.ListConversations` |
| `getCustomerAgentRun` | `customerAgents.getRun` | `customer_agents.get_run` | `CustomerAgents.GetRun` |
| `getCustomerAgentRunResult` | `customerAgents.getRunResult` | `customer_agents.get_run_result` | `CustomerAgents.GetRunResult` |
| `listCustomerAgentRunEvents` | `customerAgents.listRunEvents` | `customer_agents.list_run_events` | `CustomerAgents.ListRunEvents` |
| `streamCustomerAgentRun` | `customerAgents.streamRun` | `customer_agents.stream_run` | `CustomerAgents.StreamRun` |
| `cancelCustomerAgentRun` | `customerAgents.cancelRun` | `customer_agents.cancel_run` | `CustomerAgents.CancelRun` |
| `listCustomerAgentFiles` | `customerAgents.listFiles` | `customer_agents.list_files` | `CustomerAgents.ListFiles` |
| `readCustomerAgentFile` | `customerAgents.readFile` | `customer_agents.read_file` | `CustomerAgents.ReadFile` |
| `listCustomerAgentConnections` | `customerAgents.listConnections` | `customer_agents.list_connections` | `CustomerAgents.ListConnections` |
| `createCustomerAgentConnection` | `customerAgents.createConnection` | `customer_agents.create_connection` | `CustomerAgents.CreateConnection` |
| `deleteCustomerAgentConnection` | `customerAgents.deleteConnection` | `customer_agents.delete_connection` | `CustomerAgents.DeleteConnection` |
| `updateCustomerAgentConnectionPermissions` | `customerAgents.updateConnectionPermissions` | `customer_agents.update_connection_permissions` | `CustomerAgents.UpdateConnectionPermissions` |
| `authorizeCustomerAgentConnection` | `customerAgents.authorizeConnection` | `customer_agents.authorize_connection` | `CustomerAgents.AuthorizeConnection` |
| `completeCustomerAgentConnection` | `customerAgents.completeConnection` | `customer_agents.complete_connection` | `CustomerAgents.CompleteConnection` |

## Inferences

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `createInference` | `inferences.create` | `inferences.create` | `Inferences.Create` |
| `createDecisionDefinition` | `inferences.createDecisionDefinition` | `inferences.create_decision_definition` | `Inferences.CreateDecisionDefinition` |
| `getDecisionDefinition` | `inferences.getDecisionDefinition` | `inferences.get_decision_definition` | `Inferences.GetDecisionDefinition` |
| `deleteDecisionDefinition` | `inferences.deleteDecisionDefinition` | `inferences.delete_decision_definition` | `Inferences.DeleteDecisionDefinition` |
| `createContextArtifact` | `inferences.createContextArtifact` | `inferences.create_context_artifact` | `Inferences.CreateContextArtifact` |
| `getContextArtifact` | `inferences.getContextArtifact` | `inferences.get_context_artifact` | `Inferences.GetContextArtifact` |
| `deleteContextArtifact` | `inferences.deleteContextArtifact` | `inferences.delete_context_artifact` | `Inferences.DeleteContextArtifact` |
| `createBoundedAgentRun` | `inferences.createBoundedAgentRun` | `inferences.create_bounded_agent_run` | `Inferences.CreateBoundedAgentRun` |

## Tasks

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `createDecisionTask` | `tasks.createDecision` | `tasks.create_decision` | `Tasks.CreateDecision` |
| `getDecisionTask` | `tasks.getDecision` | `tasks.get_decision` | `Tasks.GetDecision` |
| `wakeDecisionTask` | `tasks.wakeDecision` | `tasks.wake_decision` | `Tasks.WakeDecision` |
| `recordTaskOutcome` | `tasks.recordOutcome` | `tasks.record_outcome` | `Tasks.RecordOutcome` |
| `closeDecisionTask` | `tasks.closeDecision` | `tasks.close_decision` | `Tasks.CloseDecision` |

## Sandboxes

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `createSandbox` | `sandboxes.create` | `sandboxes.create` | `Sandboxes.Create` |
| `listSandboxes` | `sandboxes.list` | `sandboxes.list` | `Sandboxes.List` |
| `getSandbox` | `sandboxes.get` | `sandboxes.get` | `Sandboxes.Get` |
| `pauseSandbox` | `sandboxes.pause` | `sandboxes.pause` | `Sandboxes.Pause` |
| `resumeSandbox` | `sandboxes.resume` | `sandboxes.resume` | `Sandboxes.Resume` |
| `destroySandbox` | `sandboxes.destroy` | `sandboxes.destroy` | `Sandboxes.Destroy` |

## Workers

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listWorkers` | `workers.list` | `workers.list` | `Workers.List` |
| `createWorker` | `workers.create` | `workers.create` | `Workers.Create` |
| `getWorker` | `workers.get` | `workers.get` | `Workers.Get` |
| `patchWorker` | `workers.patch` | `workers.patch` | `Workers.Patch` |
| `pauseWorker` | `workers.pause` | `workers.pause` | `Workers.Pause` |
| `resumeWorker` | `workers.resume` | `workers.resume` | `Workers.Resume` |
| `destroyWorker` | `workers.destroy` | `workers.destroy` | `Workers.Destroy` |
| `listWorkerOfferings` | `workers.listOfferings` | `workers.list_offerings` | `Workers.ListOfferings` |
