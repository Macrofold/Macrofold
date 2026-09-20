// Generated from OpenAPI by pnpm sdk:generate:all. Do not edit.
use crate::{Client, ClientError, models, RequestOptions};
pub const DEFAULT_ORIGIN: &str = "https://app.macrofold.ai";
impl Client { pub fn workspaces(&self) -> WorkspacesResource<'_> {WorkspacesResource {client:self, options:RequestOptions::default()}}
pub fn worktrees(&self) -> WorktreesResource<'_> {WorktreesResource {client:self, options:RequestOptions::default()}}
pub fn agents(&self) -> AgentsResource<'_> {AgentsResource {client:self, options:RequestOptions::default()}}
pub fn sessions(&self) -> SessionsResource<'_> {SessionsResource {client:self, options:RequestOptions::default()}}
pub fn runs(&self) -> RunsResource<'_> {RunsResource {client:self, options:RequestOptions::default()}}
pub fn artifacts(&self) -> ArtifactsResource<'_> {ArtifactsResource {client:self, options:RequestOptions::default()}}
pub fn connections(&self) -> ConnectionsResource<'_> {ConnectionsResource {client:self, options:RequestOptions::default()}}
pub fn api_keys(&self) -> ApiKeysResource<'_> {ApiKeysResource {client:self, options:RequestOptions::default()}}
pub fn webhook_endpoints(&self) -> WebhookEndpointsResource<'_> {WebhookEndpointsResource {client:self, options:RequestOptions::default()}}
pub fn webhook_deliveries(&self) -> WebhookDeliveriesResource<'_> {WebhookDeliveriesResource {client:self, options:RequestOptions::default()}}
pub fn usage(&self) -> UsageResource<'_> {UsageResource {client:self, options:RequestOptions::default()}}
pub fn requests(&self) -> RequestsResource<'_> {RequestsResource {client:self, options:RequestOptions::default()}}
pub fn billing(&self) -> BillingResource<'_> {BillingResource {client:self, options:RequestOptions::default()}}
pub fn harnesses(&self) -> HarnessesResource<'_> {HarnessesResource {client:self, options:RequestOptions::default()}}
pub fn models(&self) -> ModelsResource<'_> {ModelsResource {client:self, options:RequestOptions::default()}}
pub fn operations(&self) -> OperationsResource<'_> {OperationsResource {client:self, options:RequestOptions::default()}}
pub fn operator(&self) -> OperatorResource<'_> {OperatorResource {client:self, options:RequestOptions::default()}}
pub fn checkpoints(&self) -> CheckpointsResource<'_> {CheckpointsResource {client:self, options:RequestOptions::default()}}
pub fn me(&self) -> MeResource<'_> {MeResource {client:self, options:RequestOptions::default()}}
pub fn transfers(&self) -> TransfersResource<'_> {TransfersResource {client:self, options:RequestOptions::default()}}
pub fn integrations(&self) -> IntegrationsResource<'_> {IntegrationsResource {client:self, options:RequestOptions::default()}}
pub fn organizations(&self) -> OrganizationsResource<'_> {OrganizationsResource {client:self, options:RequestOptions::default()}}
pub fn triggers(&self) -> TriggersResource<'_> {TriggersResource {client:self, options:RequestOptions::default()}}
pub fn slack_connections(&self) -> SlackConnectionsResource<'_> {SlackConnectionsResource {client:self, options:RequestOptions::default()}}
pub fn customer_agents(&self) -> CustomerAgentsResource<'_> {CustomerAgentsResource {client:self, options:RequestOptions::default()}}
pub fn inferences(&self) -> InferencesResource<'_> {InferencesResource {client:self, options:RequestOptions::default()}}
pub fn tasks(&self) -> TasksResource<'_> {TasksResource {client:self, options:RequestOptions::default()}}
pub fn sandboxes(&self) -> SandboxesResource<'_> {SandboxesResource {client:self, options:RequestOptions::default()}} }

#[derive(Debug,Clone,Default)] pub struct GetWorkspaceParams {pub include_connections: Option<bool>,pub agent_id: Option<String>,pub connections_limit: Option<i32>,pub connections_cursor: Option<String>}
#[derive(Debug,Clone,Default)] pub struct GetWorktreeOptionsParams {pub name: Option<String>,pub branch: Option<String>}
#[derive(Debug,Clone,Default)] pub struct ListWorkspacesParams {pub cursor: Option<String>,pub limit: Option<i32>,pub query: Option<String>,pub archived: Option<bool>}
#[derive(Debug,Clone,Default)] pub struct ListWorktreesParams {pub cursor: Option<String>,pub limit: Option<i32>}
pub struct WorkspacesResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> WorkspacesResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn cancel_deletion(&self, workspace_id: &str) -> Result<models::Workspace,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::cancel_workspace_deletion(self.client.configuration(), &key, workspace_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::WorkspaceCreate) -> Result<models::Workspace,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::create_workspace(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_worktree(&self, workspace_id: &str, input: models::WorktreeCreate) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::create_worktree(self.client.configuration(), workspace_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, workspace_id: &str) -> Result<models::Operation,ClientError> {

        crate::apis::workspaces_api::delete_workspace(self.client.configuration(), workspace_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get(&self, workspace_id: &str, params: GetWorkspaceParams) -> Result<models::Workspace,ClientError> {

        crate::apis::workspaces_api::get_workspace(self.client.configuration(), workspace_id, self.options.organization.as_deref(), params.include_connections, params.agent_id.as_deref(), params.connections_limit, params.connections_cursor.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_worktree_options(&self, workspace_id: &str, params: GetWorktreeOptionsParams) -> Result<models::WorktreeOptions,ClientError> {

        crate::apis::workspaces_api::get_worktree_options(self.client.configuration(), workspace_id, self.options.organization.as_deref(), params.name.as_deref(), params.branch.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListWorkspacesParams) -> Result<models::ListWorkspaces200Response,ClientError> {

        crate::apis::workspaces_api::list_workspaces(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref(), params.query.as_deref(), params.archived).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_worktrees(&self, workspace_id: &str, params: ListWorktreesParams) -> Result<models::ListWorktrees200Response,ClientError> {

        crate::apis::workspaces_api::list_worktrees(self.client.configuration(), workspace_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn schedule_deletion(&self, workspace_id: &str, input: models::WorkspaceDeletion) -> Result<models::Workspace,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::schedule_workspace_deletion(self.client.configuration(), &key, workspace_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, workspace_id: &str, input: models::WorkspacePatch) -> Result<models::Workspace,ClientError> {

        crate::apis::workspaces_api::update_workspace(self.client.configuration(), workspace_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone)] pub struct CreateFolderParams {pub if_match: String}
#[derive(Debug,Clone)] pub struct DeleteFileParams {pub path: String,pub if_match: String}
#[derive(Debug,Clone)] pub struct DuplicateFileParams {pub if_match: String}
#[derive(Debug,Clone,Default)] pub struct GetWorktreeDiffParams {pub base_checkpoint_id: Option<String>,pub path: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListCheckpointsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListFilesParams {pub path: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>,pub query: Option<String>,pub recursive: Option<bool>}
#[derive(Debug,Clone,Default)] pub struct ListTransfersParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone)] pub struct ReadFileParams {pub path: String,pub download: Option<bool>}
#[derive(Debug,Clone)] pub struct RenameFileParams {pub path: String,pub if_match: String}
#[derive(Debug,Clone)] pub struct WriteFileParams {pub path: String,pub if_match: String,pub create_only: Option<bool>}
pub struct WorktreesResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> WorktreesResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create_checkpoint(&self, worktree_id: &str, input: models::CheckpointCreate) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::create_checkpoint(self.client.configuration(), worktree_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_folder(&self, worktree_id: &str, input: models::FolderCreate, params: CreateFolderParams) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::create_folder(self.client.configuration(), worktree_id, &params.if_match, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_transfer(&self, worktree_id: &str, input: models::TransferCreate) -> Result<models::Transfer,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::create_transfer(self.client.configuration(), worktree_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete_file(&self, worktree_id: &str, params: DeleteFileParams) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::delete_file(self.client.configuration(), worktree_id, &params.path, &params.if_match, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, worktree_id: &str) -> Result<models::Operation,ClientError> {

        crate::apis::worktrees_api::delete_worktree(self.client.configuration(), worktree_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn duplicate_file(&self, worktree_id: &str, input: models::FileDuplicate, params: DuplicateFileParams) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::duplicate_file(self.client.configuration(), worktree_id, &params.if_match, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get_sync(&self, worktree_id: &str) -> Result<models::GitSync,ClientError> {

        crate::apis::worktrees_api::get_sync(self.client.configuration(), worktree_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get(&self, worktree_id: &str) -> Result<models::Worktree,ClientError> {

        crate::apis::worktrees_api::get_worktree(self.client.configuration(), worktree_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_diff(&self, worktree_id: &str, params: GetWorktreeDiffParams) -> Result<models::WorktreeDiff,ClientError> {

        crate::apis::worktrees_api::get_worktree_diff(self.client.configuration(), worktree_id, params.base_checkpoint_id.as_deref(), params.path.as_deref(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_checkpoints(&self, worktree_id: &str, params: ListCheckpointsParams) -> Result<models::ListCheckpoints200Response,ClientError> {

        crate::apis::worktrees_api::list_checkpoints(self.client.configuration(), worktree_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_files(&self, worktree_id: &str, params: ListFilesParams) -> Result<models::FileListing,ClientError> {

        crate::apis::worktrees_api::list_files(self.client.configuration(), worktree_id, params.path.as_deref(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref(), params.query.as_deref(), params.recursive).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_transfers(&self, worktree_id: &str, params: ListTransfersParams) -> Result<models::ListTransfers200Response,ClientError> {

        crate::apis::worktrees_api::list_transfers(self.client.configuration(), worktree_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn read_file(&self, worktree_id: &str, params: ReadFileParams) -> Result<reqwest::Response,ClientError> {

        crate::apis::worktrees_api::read_file(self.client.configuration(), worktree_id, &params.path, self.options.organization.as_deref(), params.download).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn rename_file(&self, worktree_id: &str, input: models::FileRename, params: RenameFileParams) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::rename_file(self.client.configuration(), worktree_id, &params.path, &params.if_match, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn restore(&self, worktree_id: &str, input: models::RestoreRequest) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::restore_worktree(self.client.configuration(), worktree_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn sync(&self, worktree_id: &str, input: Option<models::SyncWorktreeRequest>) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::sync_worktree(self.client.configuration(), worktree_id, &key, self.options.organization.as_deref(), input).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, worktree_id: &str, input: models::WorktreePatch) -> Result<models::Worktree,ClientError> {

        crate::apis::worktrees_api::update_worktree(self.client.configuration(), worktree_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn write_file(&self, worktree_id: &str, input: std::path::PathBuf, params: WriteFileParams) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::worktrees_api::write_file(self.client.configuration(), worktree_id, &params.path, &params.if_match, &key, input, self.options.organization.as_deref(), params.create_only).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
#[derive(Debug,Clone,Default)] pub struct GetAgentParams {pub include_connections: Option<bool>,pub workspace_id: Option<String>,pub connections_limit: Option<i32>,pub connections_cursor: Option<String>}
#[derive(Debug,Clone,Default)] pub struct ListAgentsParams {pub cursor: Option<String>,pub limit: Option<i32>,pub query: Option<String>}
pub struct AgentsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> AgentsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create(&self, input: models::AgentCreate) -> Result<models::Agent,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::agents_api::create_agent(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, agent_id: &str) -> Result<(),ClientError> {

        crate::apis::agents_api::delete_agent(self.client.configuration(), agent_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get(&self, agent_id: &str, params: GetAgentParams) -> Result<models::Agent,ClientError> {

        crate::apis::agents_api::get_agent(self.client.configuration(), agent_id, self.options.organization.as_deref(), params.include_connections, params.workspace_id.as_deref(), params.connections_limit, params.connections_cursor.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListAgentsParams) -> Result<models::ListAgents200Response,ClientError> {

        crate::apis::agents_api::list_agents(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref(), params.query.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn update(&self, agent_id: &str, input: models::AgentPatch) -> Result<models::Agent,ClientError> {

        crate::apis::agents_api::update_agent(self.client.configuration(), agent_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListSessionsParams {pub cursor: Option<String>,pub limit: Option<i32>,pub worktree_id: Option<String>}
pub struct SessionsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> SessionsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn continue_run(&self, session_id: &str, input: models::MessageCreate) -> Result<models::NativeRunAccepted,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::sessions_api::continue_session(self.client.configuration(), session_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::SessionCreate) -> Result<models::Session,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::sessions_api::create_session(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get(&self, session_id: &str) -> Result<models::Session,ClientError> {

        crate::apis::sessions_api::get_session(self.client.configuration(), session_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListSessionsParams) -> Result<models::ListSessions200Response,ClientError> {

        crate::apis::sessions_api::list_sessions(self.client.configuration(), params.cursor.as_deref(), params.limit, params.worktree_id.as_deref(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListArtifactsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListRunEventsParams {pub after: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListRunsParams {pub status: Option<String>,pub workspace_id: Option<String>,pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub cursor: Option<String>,pub limit: Option<i32>,pub worktree_id: Option<String>,pub session_id: Option<String>}
pub struct RunsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> RunsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn cancel(&self, run_id: &str) -> Result<models::Run,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::runs_api::cancel_run(self.client.configuration(), run_id, &key, std::collections::HashMap::new(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::RunCreate) -> Result<models::NativeRunAccepted,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::runs_api::create_run(self.client.configuration(), &key, Some(input), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get(&self, run_id: &str) -> Result<models::Run,ClientError> {

        crate::apis::runs_api::get_run(self.client.configuration(), run_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_result(&self, run_id: &str) -> Result<models::RunResult,ClientError> {

        crate::apis::runs_api::get_run_result(self.client.configuration(), run_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_artifacts(&self, run_id: &str, params: ListArtifactsParams) -> Result<models::ListArtifacts200Response,ClientError> {

        crate::apis::runs_api::list_artifacts(self.client.configuration(), run_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_events(&self, run_id: &str, params: ListRunEventsParams) -> Result<models::ListRunEvents200Response,ClientError> {

        crate::apis::runs_api::list_run_events(self.client.configuration(), run_id, params.after.as_deref(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListRunsParams) -> Result<models::ListRuns200Response,ClientError> {

        crate::apis::runs_api::list_runs(self.client.configuration(), params.status.as_deref(), params.workspace_id.as_deref(), params.from, params.to, params.cursor.as_deref(), params.limit, params.worktree_id.as_deref(), params.session_id.as_deref(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn stream(&self, run_id:&str, after:&str, receive:impl FnMut(models::Event)->bool) -> Result<(),ClientError> {self.client.stream_in_organization(run_id,after,self.options.organization.as_deref(),receive).await}
pub async fn submit_input(&self, run_id: &str, input: models::RunInput) -> Result<models::Run,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::runs_api::submit_run_input(self.client.configuration(), run_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
pub struct ArtifactsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> ArtifactsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn delete(&self, artifact_id: &str) -> Result<(),ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::artifacts_api::delete_artifact(self.client.configuration(), artifact_id, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn download(&self, artifact_id: &str) -> Result<models::Download,ClientError> {

        crate::apis::artifacts_api::download_artifact(self.client.configuration(), artifact_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone)] pub struct CreateConnectionAccessRuleParams {pub if_match: String}
#[derive(Debug,Clone)] pub struct DeleteConnectionAccessRuleParams {pub if_match: String}
#[derive(Debug,Clone,Default)] pub struct ListConnectionAccessRulesParams {pub cursor: Option<String>,pub limit: Option<i32>,pub workspace_id: Option<String>,pub agent_id: Option<String>,pub sort: Option<String>,pub direction: Option<String>}
#[derive(Debug,Clone,Default)] pub struct ListConnectionsParams {pub cursor: Option<String>,pub limit: Option<i32>,pub workspace_id: Option<String>,pub agent_id: Option<String>}
#[derive(Debug,Clone,Default)] pub struct ListConnectionToolsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListStdioPackagesParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ResolveConnectionAccessParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone)] pub struct UpdateConnectionAccessParams {pub if_match: String}
#[derive(Debug,Clone)] pub struct UpdateConnectionAccessRuleParams {pub if_match: String}
pub struct ConnectionsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> ConnectionsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn authorize(&self, connection_id: &str, input: models::AuthorizeRequest) -> Result<models::AuthorizationLink,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::authorize_connection(self.client.configuration(), connection_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::ConnectionCreate) -> Result<models::Connection,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::create_connection(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_access_rule(&self, connection_id: &str, input: models::ConnectionAccessRuleInput, params: CreateConnectionAccessRuleParams) -> Result<models::ConnectionAccessRuleMutation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::create_connection_access_rule(self.client.configuration(), connection_id, &params.if_match, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, connection_id: &str) -> Result<(),ClientError> {

        crate::apis::connections_api::delete_connection(self.client.configuration(), connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn delete_access_rule(&self, connection_id: &str, rule_id: &str, params: DeleteConnectionAccessRuleParams) -> Result<models::ConnectionAccessRuleDeleted,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::delete_connection_access_rule(self.client.configuration(), connection_id, rule_id, &params.if_match, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get(&self, connection_id: &str) -> Result<models::Connection,ClientError> {

        crate::apis::connections_api::get_connection(self.client.configuration(), connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_access(&self, connection_id: &str) -> Result<models::ConnectionAccess,ClientError> {

        crate::apis::connections_api::get_connection_access(self.client.configuration(), connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_access_rules(&self, connection_id: &str, params: ListConnectionAccessRulesParams) -> Result<models::ConnectionAccessRulePage,ClientError> {

        crate::apis::connections_api::list_connection_access_rules(self.client.configuration(), connection_id, self.options.organization.as_deref(), params.cursor.as_deref(), params.limit, params.workspace_id.as_deref(), params.agent_id.as_deref(), params.sort.as_deref(), params.direction.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListConnectionsParams) -> Result<models::ContextualConnectionPage,ClientError> {

        crate::apis::connections_api::list_connections(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref(), params.workspace_id.as_deref(), params.agent_id.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_tools(&self, connection_id: &str, params: ListConnectionToolsParams) -> Result<models::ListConnectionTools200Response,ClientError> {

        crate::apis::connections_api::list_connection_tools(self.client.configuration(), connection_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_connector_catalog(&self) -> Result<models::ConnectorCatalog,ClientError> {

        crate::apis::connections_api::list_connector_catalog(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_stdio_packages(&self, params: ListStdioPackagesParams) -> Result<models::StdioPackagePage,ClientError> {

        crate::apis::connections_api::list_stdio_packages(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn resolve_access(&self, input: models::ConnectionAccessResolve, params: ResolveConnectionAccessParams) -> Result<models::ConnectionAccessResolutionPage,ClientError> {

        crate::apis::connections_api::resolve_connection_access(self.client.configuration(), Some(input), self.options.organization.as_deref(), params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn test(&self, connection_id: &str) -> Result<models::ConnectionTest,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::test_connection(self.client.configuration(), connection_id, &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, connection_id: &str, input: models::ConnectionPatch) -> Result<models::Connection,ClientError> {

        crate::apis::connections_api::update_connection(self.client.configuration(), connection_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn update_access(&self, connection_id: &str, input: models::ConnectionAccessPatch, params: UpdateConnectionAccessParams) -> Result<models::ConnectionAccess,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::update_connection_access(self.client.configuration(), connection_id, &params.if_match, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update_access_rule(&self, connection_id: &str, rule_id: &str, input: models::ConnectionAccessRuleInput, params: UpdateConnectionAccessRuleParams) -> Result<models::ConnectionAccessRuleMutation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::update_connection_access_rule(self.client.configuration(), connection_id, rule_id, &params.if_match, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListApiKeysParams {pub cursor: Option<String>,pub limit: Option<i32>}
pub struct ApiKeysResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> ApiKeysResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create(&self, input: models::KeyCreate) -> Result<models::NewApiKey,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::api_keys_api::create_api_key(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn list(&self, params: ListApiKeysParams) -> Result<models::ListApiKeys200Response,ClientError> {

        crate::apis::api_keys_api::list_api_keys(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn revoke(&self, key_id: &str) -> Result<(),ClientError> {

        crate::apis::api_keys_api::revoke_api_key(self.client.configuration(), key_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListWebhookEndpointsParams {pub cursor: Option<String>,pub limit: Option<i32>}
pub struct WebhookEndpointsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> WebhookEndpointsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create(&self, input: models::WebhookCreate) -> Result<models::NewWebhook,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::webhook_endpoints_api::create_webhook_endpoint(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, endpoint_id: &str) -> Result<(),ClientError> {

        crate::apis::webhook_endpoints_api::delete_webhook_endpoint(self.client.configuration(), endpoint_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListWebhookEndpointsParams) -> Result<models::ListWebhookEndpoints200Response,ClientError> {

        crate::apis::webhook_endpoints_api::list_webhook_endpoints(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn rotate_webhook_secret(&self, endpoint_id: &str) -> Result<models::NewWebhook,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::webhook_endpoints_api::rotate_webhook_secret(self.client.configuration(), endpoint_id, &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, endpoint_id: &str, input: models::WebhookPatch) -> Result<models::Webhook,ClientError> {

        crate::apis::webhook_endpoints_api::update_webhook_endpoint(self.client.configuration(), endpoint_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListWebhookDeliveriesParams {pub cursor: Option<String>,pub limit: Option<i32>}
pub struct WebhookDeliveriesResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> WebhookDeliveriesResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn list(&self, params: ListWebhookDeliveriesParams) -> Result<models::ListWebhookDeliveries200Response,ClientError> {

        crate::apis::webhook_deliveries_api::list_webhook_deliveries(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn replay(&self, delivery_id: &str) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::webhook_deliveries_api::replay_webhook_delivery(self.client.configuration(), delivery_id, &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
#[derive(Debug,Clone,Default)] pub struct GetUsageParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub group_by: Option<String>}
pub struct UsageResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> UsageResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn get(&self, params: GetUsageParams) -> Result<models::Report,ClientError> {

        crate::apis::usage_api::get_usage(self.client.configuration(), params.from, params.to, params.group_by.as_deref(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListRequestsParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub cursor: Option<String>,pub limit: Option<i32>}
pub struct RequestsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> RequestsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn list(&self, params: ListRequestsParams) -> Result<models::ListRequests200Response,ClientError> {

        crate::apis::requests_api::list_requests(self.client.configuration(), params.from, params.to, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone)] pub struct ListBillingUsageParams {pub from: chrono::DateTime<chrono::FixedOffset>,pub to: chrono::DateTime<chrono::FixedOffset>,pub workspace_id: Option<String>,pub worktree_id: Option<String>,pub run_id: Option<String>,pub session_id: Option<String>,pub customer_id: Option<String>,pub agent_key: Option<String>,pub provider: Option<String>,pub model: Option<String>,pub kind: Option<String>,pub billing_mode: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
pub struct BillingResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> BillingResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create_portal(&self) -> Result<models::Redirect,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::billing_api::create_billing_portal(self.client.configuration(), &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_checkout(&self, input: models::CheckoutCreate) -> Result<models::Redirect,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::billing_api::create_checkout(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get(&self) -> Result<models::Billing,ClientError> {

        crate::apis::billing_api::get_billing(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_storage(&self) -> Result<models::Storage,ClientError> {

        crate::apis::billing_api::get_storage(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_usage(&self, params: ListBillingUsageParams) -> Result<models::BillingUsagePage,ClientError> {

        crate::apis::billing_api::list_billing_usage(self.client.configuration(), params.from, params.to, params.workspace_id.as_deref(), params.worktree_id.as_deref(), params.run_id.as_deref(), params.session_id.as_deref(), params.customer_id.as_deref(), params.agent_key.as_deref(), params.provider.as_deref(), params.model.as_deref(), params.kind.as_deref(), params.billing_mode.as_deref(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn update_storage_policy(&self, input: models::StoragePolicy) -> Result<models::Storage,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::billing_api::update_storage_policy(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListHarnessesParams {pub cursor: Option<String>,pub limit: Option<i32>}
pub struct HarnessesResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> HarnessesResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn list(&self, params: ListHarnessesParams) -> Result<models::ListHarnesses200Response,ClientError> {

        crate::apis::harnesses_api::list_harnesses(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListModelsParams {pub harness: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
pub struct ModelsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> ModelsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn list(&self, params: ListModelsParams) -> Result<models::ListModels200Response,ClientError> {

        crate::apis::models_api::list_models(self.client.configuration(), params.harness.as_deref(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
pub struct OperationsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> OperationsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn get(&self, operation_id: &str) -> Result<models::Operation,ClientError> {

        crate::apis::operations_api::get_operation(self.client.configuration(), operation_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct GetAccountSummaryParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub include_contact: Option<bool>}
#[derive(Debug,Clone,Default)] pub struct GetCapacityReportParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>}
#[derive(Debug,Clone,Default)] pub struct GetGrowthMetricsParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub group_by: Option<String>,pub organization_id: Option<String>}
#[derive(Debug,Clone,Default)] pub struct GetInfrastructureHealthParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub service_id: Option<String>}
#[derive(Debug,Clone,Default)] pub struct GetOperatingReportParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>}
#[derive(Debug,Clone,Default)] pub struct GetPlatformUsageMetricsParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub group_by: Option<String>,pub organization_id: Option<String>}
#[derive(Debug,Clone,Default)] pub struct GetRunDiagnosticsParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>}
#[derive(Debug,Clone,Default)] pub struct ListAccountsParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub query: Option<String>,pub include_contact: Option<bool>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListPlatformRequestsParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub organization_id: Option<String>,pub status_code: Option<i32>,pub route: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListReportSnapshotsParams {pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub cursor: Option<chrono::NaiveDate>,pub limit: Option<i32>}
pub struct OperatorResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> OperatorResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn get_account_summary(&self, account_id: &str, params: GetAccountSummaryParams) -> Result<models::AccountSummary,ClientError> {

        crate::apis::operator_api::get_account_summary(self.client.configuration(), account_id, params.from, params.to, params.include_contact).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_capacity_report(&self, params: GetCapacityReportParams) -> Result<models::Report,ClientError> {

        crate::apis::operator_api::get_capacity_report(self.client.configuration(), params.from, params.to).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_growth_metrics(&self, params: GetGrowthMetricsParams) -> Result<models::Report,ClientError> {

        crate::apis::operator_api::get_growth_metrics(self.client.configuration(), params.from, params.to, params.group_by.as_deref(), params.organization_id.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_infrastructure_health(&self, params: GetInfrastructureHealthParams) -> Result<models::Report,ClientError> {

        crate::apis::operator_api::get_infrastructure_health(self.client.configuration(), params.from, params.to, params.service_id.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_operating_report(&self, params: GetOperatingReportParams) -> Result<models::Report,ClientError> {

        crate::apis::operator_api::get_operating_report(self.client.configuration(), params.from, params.to).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_platform_usage_metrics(&self, params: GetPlatformUsageMetricsParams) -> Result<models::Report,ClientError> {

        crate::apis::operator_api::get_platform_usage_metrics(self.client.configuration(), params.from, params.to, params.group_by.as_deref(), params.organization_id.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_run_diagnostics(&self, run_id: &str, params: GetRunDiagnosticsParams) -> Result<models::Diagnostics,ClientError> {

        crate::apis::operator_api::get_run_diagnostics(self.client.configuration(), run_id, params.from, params.to).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_accounts(&self, params: ListAccountsParams) -> Result<models::ListAccounts200Response,ClientError> {

        crate::apis::operator_api::list_accounts(self.client.configuration(), params.from, params.to, params.query.as_deref(), params.include_contact, params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_platform_requests(&self, params: ListPlatformRequestsParams) -> Result<models::ListRequests200Response,ClientError> {

        crate::apis::operator_api::list_platform_requests(self.client.configuration(), params.from, params.to, params.organization_id.as_deref(), params.status_code, params.route.as_deref(), params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_report_snapshots(&self, params: ListReportSnapshotsParams) -> Result<models::ReportSnapshotPage,ClientError> {

        crate::apis::operator_api::list_report_snapshots(self.client.configuration(), params.from, params.to, params.cursor, params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
pub struct CheckpointsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> CheckpointsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn export_archive(&self, checkpoint_id: &str, input: models::CheckpointExportRequest) -> Result<models::ExportOperation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::checkpoints_api::export_checkpoint(self.client.configuration(), checkpoint_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update_retention(&self, checkpoint_id: &str, input: models::CheckpointPatch) -> Result<models::Checkpoint,ClientError> {

        crate::apis::checkpoints_api::update_checkpoint_retention(self.client.configuration(), checkpoint_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
pub struct MeResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> MeResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn get(&self) -> Result<models::Identity,ClientError> {

        crate::apis::me_api::get_identity(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
pub struct TransfersResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> TransfersResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn apply(&self, transfer_id: &str, input: models::TransferApply) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::transfers_api::apply_transfer(self.client.configuration(), transfer_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get(&self, transfer_id: &str) -> Result<models::Transfer,ClientError> {

        crate::apis::transfers_api::get_transfer(self.client.configuration(), transfer_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone)] pub struct ListGithubRepositoriesParams {pub installation_id: String}
pub struct IntegrationsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> IntegrationsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn disconnect_github(&self, workspace_id: &str) -> Result<models::Workspace,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::integrations_api::disconnect_github(self.client.configuration(), workspace_id, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn list_github_installations(&self) -> Result<models::GithubInstallations,ClientError> {

        crate::apis::integrations_api::list_github_installations(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_github_repositories(&self, params: ListGithubRepositoriesParams) -> Result<models::GithubRepositories,ClientError> {

        crate::apis::integrations_api::list_github_repositories(self.client.configuration(), &params.installation_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
pub struct OrganizationsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> OrganizationsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create_invitation(&self, input: models::InvitationCreate) -> Result<models::Invitation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::organizations_api::create_invitation(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::OrganizationCreate) -> Result<models::Organization,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::organizations_api::create_organization(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get_execution_policy(&self) -> Result<models::ExecutionPolicy,ClientError> {

        crate::apis::organizations_api::get_execution_policy(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_invitations(&self) -> Result<models::ListInvitations200Response,ClientError> {

        crate::apis::organizations_api::list_invitations(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_members(&self) -> Result<models::ListMembers200Response,ClientError> {

        crate::apis::organizations_api::list_members(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_audit(&self) -> Result<models::ListOrganizationAudit200Response,ClientError> {

        crate::apis::organizations_api::list_organization_audit(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn remove_member(&self, user_id: &str) -> Result<(),ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::organizations_api::remove_member(self.client.configuration(), &key, user_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn revoke_invitation(&self, invitation_id: &str) -> Result<(),ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::organizations_api::revoke_invitation(self.client.configuration(), &key, invitation_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update_execution_policy(&self, input: models::ExecutionPolicyPatch) -> Result<models::ExecutionPolicy,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::organizations_api::update_execution_policy(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update_member(&self, user_id: &str, input: models::MemberPatch) -> Result<(),ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::organizations_api::update_member(self.client.configuration(), &key, user_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, input: models::OrganizationCreate) -> Result<models::Organization,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::organizations_api::update_organization(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListTriggerDeliveriesParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListTriggersParams {pub cursor: Option<String>,pub limit: Option<i32>,pub kind: Option<String>}
pub struct TriggersResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> TriggersResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create(&self, input: models::TriggerCreate) -> Result<models::NewTrigger,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::triggers_api::create_trigger(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, trigger_id: &str) -> Result<models::DeleteTrigger200Response,ClientError> {

        crate::apis::triggers_api::delete_trigger(self.client.configuration(), trigger_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get(&self, trigger_id: &str) -> Result<models::Trigger,ClientError> {

        crate::apis::triggers_api::get_trigger(self.client.configuration(), trigger_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_deliveries(&self, trigger_id: &str, params: ListTriggerDeliveriesParams) -> Result<models::ListTriggerDeliveries200Response,ClientError> {

        crate::apis::triggers_api::list_trigger_deliveries(self.client.configuration(), trigger_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListTriggersParams) -> Result<models::ListTriggers200Response,ClientError> {

        crate::apis::triggers_api::list_triggers(self.client.configuration(), params.cursor.as_deref(), params.limit, params.kind.as_deref(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn retry_reply(&self, trigger_id: &str, delivery_id: &str) -> Result<models::TriggerDelivery,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::triggers_api::retry_trigger_reply(self.client.configuration(), trigger_id, delivery_id, &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn rotate_secret(&self, trigger_id: &str) -> Result<models::TriggerSecret,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::triggers_api::rotate_trigger_secret(self.client.configuration(), trigger_id, &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn run(&self, trigger_id: &str) -> Result<models::TriggerDelivery,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::triggers_api::run_trigger(self.client.configuration(), trigger_id, &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, trigger_id: &str, input: models::TriggerPatch) -> Result<models::Trigger,ClientError> {

        crate::apis::triggers_api::update_trigger(self.client.configuration(), trigger_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListSlackConnectionChannelsParams {pub cursor: Option<String>}
pub struct SlackConnectionsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> SlackConnectionsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create(&self, input: models::SlackConnectionCreate) -> Result<models::SlackConnection,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::slack_connections_api::create_slack_connection(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, connection_id: &str) -> Result<models::DeleteTrigger200Response,ClientError> {

        crate::apis::slack_connections_api::delete_slack_connection(self.client.configuration(), connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_channels(&self, connection_id: &str, params: ListSlackConnectionChannelsParams) -> Result<models::ListSlackConnectionChannels200Response,ClientError> {

        crate::apis::slack_connections_api::list_slack_connection_channels(self.client.configuration(), connection_id, params.cursor.as_deref(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self) -> Result<models::ListSlackConnections200Response,ClientError> {

        crate::apis::slack_connections_api::list_slack_connections(self.client.configuration(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListCustomerAgentConnectionsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListCustomerAgentConversationsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListCustomerAgentFilesParams {pub path: Option<String>,pub query: Option<String>,pub recursive: Option<bool>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListCustomerAgentRunEventsParams {pub after: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListCustomerAgentsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone)] pub struct ReadCustomerAgentFileParams {pub path: String,pub download: Option<bool>}
#[derive(Debug,Clone)] pub struct UpdateCustomerAgentConnectionPermissionsParams {pub if_match: String}
pub struct CustomerAgentsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> CustomerAgentsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn authorize_connection(&self, customer_id: &str, customer_agent_id: &str, connection_id: &str, input: models::CustomerConnectionAuthorize) -> Result<models::CustomerConnectionAuthorization,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::customer_agents_api::authorize_customer_agent_connection(self.client.configuration(), customer_id, customer_agent_id, connection_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn cancel_run(&self, customer_id: &str, customer_agent_id: &str, run_id: &str) -> Result<models::Run,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::customer_agents_api::cancel_customer_agent_run(self.client.configuration(), customer_id, customer_agent_id, run_id, &key, serde_json::json!({}), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn complete_connection(&self, customer_id: &str, customer_agent_id: &str, connection_id: &str, input: models::CustomerConnectionComplete) -> Result<models::CustomerAgentConnection,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::customer_agents_api::complete_customer_agent_connection(self.client.configuration(), customer_id, customer_agent_id, connection_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_connection(&self, customer_id: &str, customer_agent_id: &str, input: models::CustomerAgentConnectionCreate) -> Result<models::CustomerAgentConnection,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::customer_agents_api::create_customer_agent_connection(self.client.configuration(), customer_id, customer_agent_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete_connection(&self, customer_id: &str, customer_agent_id: &str, connection_id: &str) -> Result<(),ClientError> {

        crate::apis::customer_agents_api::delete_customer_agent_connection(self.client.configuration(), customer_id, customer_agent_id, connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn ensure(&self, customer_id: &str, input: models::CustomerAgentEnsure) -> Result<models::CustomerAgentBinding,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::customer_agents_api::ensure_customer_agent(self.client.configuration(), customer_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get(&self, customer_id: &str, customer_agent_id: &str) -> Result<models::CustomerAgentBinding,ClientError> {

        crate::apis::customer_agents_api::get_customer_agent(self.client.configuration(), customer_id, customer_agent_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_run(&self, customer_id: &str, customer_agent_id: &str, run_id: &str) -> Result<models::Run,ClientError> {

        crate::apis::customer_agents_api::get_customer_agent_run(self.client.configuration(), customer_id, customer_agent_id, run_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_run_result(&self, customer_id: &str, customer_agent_id: &str, run_id: &str) -> Result<models::RunResult,ClientError> {

        crate::apis::customer_agents_api::get_customer_agent_run_result(self.client.configuration(), customer_id, customer_agent_id, run_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_connections(&self, customer_id: &str, customer_agent_id: &str, params: ListCustomerAgentConnectionsParams) -> Result<models::CustomerAgentConnectionPage,ClientError> {

        crate::apis::customer_agents_api::list_customer_agent_connections(self.client.configuration(), customer_id, customer_agent_id, self.options.organization.as_deref(), params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_conversations(&self, customer_id: &str, customer_agent_id: &str, params: ListCustomerAgentConversationsParams) -> Result<models::ListSessions200Response,ClientError> {

        crate::apis::customer_agents_api::list_customer_agent_conversations(self.client.configuration(), customer_id, customer_agent_id, self.options.organization.as_deref(), params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_files(&self, customer_id: &str, customer_agent_id: &str, params: ListCustomerAgentFilesParams) -> Result<models::FileListing,ClientError> {

        crate::apis::customer_agents_api::list_customer_agent_files(self.client.configuration(), customer_id, customer_agent_id, self.options.organization.as_deref(), params.path.as_deref(), params.query.as_deref(), params.recursive, params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_run_events(&self, customer_id: &str, customer_agent_id: &str, run_id: &str, params: ListCustomerAgentRunEventsParams) -> Result<models::ListRunEvents200Response,ClientError> {

        crate::apis::customer_agents_api::list_customer_agent_run_events(self.client.configuration(), customer_id, customer_agent_id, run_id, self.options.organization.as_deref(), params.after.as_deref(), params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, customer_id: &str, params: ListCustomerAgentsParams) -> Result<models::CustomerAgentPage,ClientError> {

        crate::apis::customer_agents_api::list_customer_agents(self.client.configuration(), customer_id, self.options.organization.as_deref(), params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn read_file(&self, customer_id: &str, customer_agent_id: &str, params: ReadCustomerAgentFileParams) -> Result<reqwest::Response,ClientError> {

        crate::apis::customer_agents_api::read_customer_agent_file(self.client.configuration(), customer_id, customer_agent_id, &params.path, self.options.organization.as_deref(), params.download).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn send_message(&self, customer_id: &str, customer_agent_id: &str, input: models::CustomerAgentMessage) -> Result<models::NativeRunAccepted,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::customer_agents_api::send_customer_agent_message(self.client.configuration(), customer_id, customer_agent_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn stream_run(&self, customer_id:&str, customer_agent_id:&str, run_id:&str, after:&str, receive:impl FnMut(models::Event)->bool) -> Result<(),ClientError> {self.client.stream_target(run_id,after,self.options.organization.as_deref(),Some((customer_id,customer_agent_id)),receive).await}
pub async fn update_connection_permissions(&self, customer_id: &str, customer_agent_id: &str, connection_id: &str, input: models::CustomerAgentConnectionPermissions, params: UpdateCustomerAgentConnectionPermissionsParams) -> Result<models::CustomerAgentConnection,ClientError> {

        crate::apis::customer_agents_api::update_customer_agent_connection_permissions(self.client.configuration(), customer_id, customer_agent_id, connection_id, &params.if_match, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct CreateInferenceParams {pub prefer: Option<String>}
pub struct InferencesResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> InferencesResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create_bounded_agent_run(&self, input: models::BoundedAgentCreate) -> Result<models::RunAccepted,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::inferences_api::create_bounded_agent_run(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_context_artifact(&self, input: models::ContextArtifactCreate) -> Result<models::ContextArtifact,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::inferences_api::create_context_artifact(self.client.configuration(), &key, input).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_decision_definition(&self, input: models::DecisionDefinitionCreate) -> Result<models::DecisionDefinition,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::inferences_api::create_decision_definition(self.client.configuration(), &key, input).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::InferenceCreate, params: CreateInferenceParams) -> Result<models::InferenceResponse,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::inferences_api::create_inference(self.client.configuration(), &key, Some(input), self.options.organization.as_deref(), params.prefer.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete_context_artifact(&self, artifact_id: &str) -> Result<models::ContextArtifact,ClientError> {

        crate::apis::inferences_api::delete_context_artifact(self.client.configuration(), artifact_id).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn delete_decision_definition(&self, definition_id: &str) -> Result<models::DecisionDefinition,ClientError> {

        crate::apis::inferences_api::delete_decision_definition(self.client.configuration(), definition_id).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_context_artifact(&self, artifact_id: &str) -> Result<models::ContextArtifact,ClientError> {

        crate::apis::inferences_api::get_context_artifact(self.client.configuration(), artifact_id).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_decision_definition(&self, definition_id: &str) -> Result<models::DecisionDefinition,ClientError> {

        crate::apis::inferences_api::get_decision_definition(self.client.configuration(), definition_id).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
pub struct TasksResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> TasksResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn close_decision(&self, task_id: &str) -> Result<models::DecisionTask,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::tasks_api::close_decision_task(self.client.configuration(), &key, task_id).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_decision(&self, input: models::DecisionTaskCreate) -> Result<models::DecisionTask,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::tasks_api::create_decision_task(self.client.configuration(), &key, input).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get_decision(&self, task_id: &str) -> Result<models::DecisionTask,ClientError> {

        crate::apis::tasks_api::get_decision_task(self.client.configuration(), task_id).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn record_outcome(&self, task_id: &str, input: models::ApplicationOutcome) -> Result<models::DecisionTask,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::tasks_api::record_task_outcome(self.client.configuration(), &key, task_id, input).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn wake_decision(&self, task_id: &str, input: models::DecisionTaskWake) -> Result<models::DecisionTask,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::tasks_api::wake_decision_task(self.client.configuration(), &key, task_id, input).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListSandboxesParams {pub worktree_id: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
pub struct SandboxesResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> SandboxesResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create(&self, input: models::SandboxCreate) -> Result<models::Sandbox,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::sandboxes_api::create_sandbox(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn destroy(&self, sandbox_id: &str) -> Result<models::Sandbox,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::sandboxes_api::destroy_sandbox(self.client.configuration(), sandbox_id, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn get(&self, sandbox_id: &str) -> Result<models::Sandbox,ClientError> {

        crate::apis::sandboxes_api::get_sandbox(self.client.configuration(), sandbox_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListSandboxesParams) -> Result<models::SandboxPage,ClientError> {

        crate::apis::sandboxes_api::list_sandboxes(self.client.configuration(), self.options.organization.as_deref(), params.worktree_id.as_deref(), params.cursor.as_deref(), params.limit).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn pause(&self, sandbox_id: &str) -> Result<models::Sandbox,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::sandboxes_api::pause_sandbox(self.client.configuration(), sandbox_id, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn resume(&self, sandbox_id: &str) -> Result<models::Sandbox,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::sandboxes_api::resume_sandbox(self.client.configuration(), sandbox_id, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
