# SDK resource reference

Generated from the [OpenAPI contract](../../../api/openapi.json). All 117 public operations have a resource method. Start with the [language guides](README.md) for installation, authentication, and runnable examples.

Names below follow each language's casing. TypeScript, Python, and Go use resource properties; Java and Rust use resource accessors, such as `client.projects().create(...)`. Rust network methods are async. Signatures and response types are available in editor completion and checked-in generated sources; query/header options use typed parameter classes in Go, Rust, and Java. Python uses keyword arguments; TypeScript uses typed options.

Path identifiers are positional. Required request values stay typed; optional transport settings expose idempotency, cancellation, and organization selection where supported. Methods retain each SDK's documented transport behavior. The run `events` method delegates to resumable incremental streaming; `stream` remains available. Closing a stream leaves the remote run active; call `runs.cancel` to stop it.

## Run convenience helpers

These compose existing operations and add no backend endpoints.

| Purpose | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| Assistant text fragments | `runs.streamText` | `runs.stream_text` | `Runs.StreamText` |
| Typed complete result after execution and persistence | `runs.wait` | `runs.wait` | `Runs.Wait` |

Text streams handle SSE, cursors and duplicate suppression internally, excluding tool payloads and status events. Both convenience helpers report unsuccessful execution or persistence as a typed run error carrying the run ID. A wait timeout stops local waiting without cancelling execution. The language guides describe timeout options, callbacks/iterators, and advanced replay.

## Projects

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `listProjects` | `projects.list` | `projects.list` | `Projects.List` |
| `createProject` | `projects.create` | `projects.create` | `Projects.Create` |
| `getProject` | `projects.get` | `projects.get` | `Projects.Get` |
| `updateProject` | `projects.update` | `projects.update` | `Projects.Update` |
| `deleteProject` | `projects.delete` | `projects.delete` | `Projects.Delete` |
| `listWorkspaces` | `projects.listWorkspaces` | `projects.list_workspaces` | `Projects.ListWorkspaces` |
| `createWorkspace` | `projects.createWorkspace` | `projects.create_workspace` | `Projects.CreateWorkspace` |
| `scheduleProjectDeletion` | `projects.scheduleDeletion` | `projects.schedule_deletion` | `Projects.ScheduleDeletion` |
| `cancelProjectDeletion` | `projects.cancelDeletion` | `projects.cancel_deletion` | `Projects.CancelDeletion` |

## Workspaces

| OpenAPI operation | TypeScript / Java | Python / Rust | Go |
| --- | --- | --- | --- |
| `getWorkspace` | `workspaces.get` | `workspaces.get` | `Workspaces.Get` |
| `deleteWorkspace` | `workspaces.delete` | `workspaces.delete` | `Workspaces.Delete` |
| `updateWorkspace` | `workspaces.update` | `workspaces.update` | `Workspaces.Update` |
| `listFiles` | `workspaces.listFiles` | `workspaces.list_files` | `Workspaces.ListFiles` |
| `readFile` | `workspaces.readFile` | `workspaces.read_file` | `Workspaces.ReadFile` |
| `writeFile` | `workspaces.writeFile` | `workspaces.write_file` | `Workspaces.WriteFile` |
| `deleteFile` | `workspaces.deleteFile` | `workspaces.delete_file` | `Workspaces.DeleteFile` |
| `listCheckpoints` | `workspaces.listCheckpoints` | `workspaces.list_checkpoints` | `Workspaces.ListCheckpoints` |
| `createCheckpoint` | `workspaces.createCheckpoint` | `workspaces.create_checkpoint` | `Workspaces.CreateCheckpoint` |
| `restoreWorkspace` | `workspaces.restore` | `workspaces.restore` | `Workspaces.Restore` |
| `getSync` | `workspaces.getSync` | `workspaces.get_sync` | `Workspaces.GetSync` |
| `syncWorkspace` | `workspaces.sync` | `workspaces.sync` | `Workspaces.Sync` |
| `getWorkspaceDiff` | `workspaces.getDiff` | `workspaces.get_diff` | `Workspaces.GetDiff` |
| `createTransfer` | `workspaces.createTransfer` | `workspaces.create_transfer` | `Workspaces.CreateTransfer` |
| `listTransfers` | `workspaces.listTransfers` | `workspaces.list_transfers` | `Workspaces.ListTransfers` |

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
| `getConnectionGrants` | `connections.getGrants` | `connections.get_grants` | `Connections.GetGrants` |
| `setConnectionGrants` | `connections.setGrants` | `connections.set_grants` | `Connections.SetGrants` |
| `listStdioPackages` | `connections.listStdioPackages` | `connections.list_stdio_packages` | `Connections.ListStdioPackages` |
| `listConnectorCatalog` | `connections.listConnectorCatalog` | `connections.list_connector_catalog` | `Connections.ListConnectorCatalog` |

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
