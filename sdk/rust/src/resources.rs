// Generated from OpenAPI by pnpm sdk:generate:all. Do not edit.
use crate::{Client, ClientError, models, RequestOptions};
pub const DEFAULT_ORIGIN: &str = "https://app.macrofold.ai";
impl Client { pub fn projects(&self) -> ProjectsResource<'_> {ProjectsResource {client:self, options:RequestOptions::default()}}
pub fn workspaces(&self) -> WorkspacesResource<'_> {WorkspacesResource {client:self, options:RequestOptions::default()}}
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
pub fn slack_connections(&self) -> SlackConnectionsResource<'_> {SlackConnectionsResource {client:self, options:RequestOptions::default()}} }

#[derive(Debug,Clone,Default)] pub struct ListProjectsParams {pub cursor: Option<String>,pub limit: Option<i32>,pub query: Option<String>,pub archived: Option<bool>}
#[derive(Debug,Clone,Default)] pub struct ListWorkspacesParams {pub cursor: Option<String>,pub limit: Option<i32>}
pub struct ProjectsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> ProjectsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn cancel_deletion(&self, project_id: &str) -> Result<models::Project,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::projects_api::cancel_project_deletion(self.client.configuration(), &key, project_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::ProjectCreate) -> Result<models::Project,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::projects_api::create_project(self.client.configuration(), &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_workspace(&self, project_id: &str, input: models::WorkspaceCreate) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::projects_api::create_workspace(self.client.configuration(), project_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, project_id: &str) -> Result<models::Operation,ClientError> {
        
        crate::apis::projects_api::delete_project(self.client.configuration(), project_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get(&self, project_id: &str) -> Result<models::Project,ClientError> {
        
        crate::apis::projects_api::get_project(self.client.configuration(), project_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListProjectsParams) -> Result<models::ListProjects200Response,ClientError> {
        
        crate::apis::projects_api::list_projects(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref(), params.query.as_deref(), params.archived).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_workspaces(&self, project_id: &str, params: ListWorkspacesParams) -> Result<models::ListWorkspaces200Response,ClientError> {
        
        crate::apis::projects_api::list_workspaces(self.client.configuration(), project_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn schedule_deletion(&self, project_id: &str, input: models::ProjectDeletion) -> Result<models::Project,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::projects_api::schedule_project_deletion(self.client.configuration(), &key, project_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, project_id: &str, input: models::ProjectPatch) -> Result<models::Project,ClientError> {
        
        crate::apis::projects_api::update_project(self.client.configuration(), project_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone)] pub struct DeleteFileParams {pub path: String,pub if_match: String}
#[derive(Debug,Clone,Default)] pub struct GetWorkspaceDiffParams {pub base_checkpoint_id: Option<String>,pub path: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListCheckpointsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListFilesParams {pub path: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>,pub query: Option<String>}
#[derive(Debug,Clone,Default)] pub struct ListTransfersParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone)] pub struct ReadFileParams {pub path: String,pub download: Option<bool>}
#[derive(Debug,Clone)] pub struct WriteFileParams {pub path: String,pub if_match: String}
pub struct WorkspacesResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> WorkspacesResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn create_checkpoint(&self, workspace_id: &str, input: models::CheckpointCreate) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::create_checkpoint(self.client.configuration(), workspace_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create_transfer(&self, workspace_id: &str, input: models::TransferCreate) -> Result<models::Transfer,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::create_transfer(self.client.configuration(), workspace_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete_file(&self, workspace_id: &str, params: DeleteFileParams) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::delete_file(self.client.configuration(), workspace_id, &params.path, &params.if_match, &key, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn delete(&self, workspace_id: &str) -> Result<models::Operation,ClientError> {
        
        crate::apis::workspaces_api::delete_workspace(self.client.configuration(), workspace_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_sync(&self, workspace_id: &str) -> Result<models::GitSync,ClientError> {
        
        crate::apis::workspaces_api::get_sync(self.client.configuration(), workspace_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get(&self, workspace_id: &str) -> Result<models::Workspace,ClientError> {
        
        crate::apis::workspaces_api::get_workspace(self.client.configuration(), workspace_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_diff(&self, workspace_id: &str, params: GetWorkspaceDiffParams) -> Result<models::WorkspaceDiff,ClientError> {
        
        crate::apis::workspaces_api::get_workspace_diff(self.client.configuration(), workspace_id, params.base_checkpoint_id.as_deref(), params.path.as_deref(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_checkpoints(&self, workspace_id: &str, params: ListCheckpointsParams) -> Result<models::ListCheckpoints200Response,ClientError> {
        
        crate::apis::workspaces_api::list_checkpoints(self.client.configuration(), workspace_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_files(&self, workspace_id: &str, params: ListFilesParams) -> Result<models::FileListing,ClientError> {
        
        crate::apis::workspaces_api::list_files(self.client.configuration(), workspace_id, params.path.as_deref(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref(), params.query.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list_transfers(&self, workspace_id: &str, params: ListTransfersParams) -> Result<models::ListTransfers200Response,ClientError> {
        
        crate::apis::workspaces_api::list_transfers(self.client.configuration(), workspace_id, params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn read_file(&self, workspace_id: &str, params: ReadFileParams) -> Result<reqwest::Response,ClientError> {
        
        crate::apis::workspaces_api::read_file(self.client.configuration(), workspace_id, &params.path, self.options.organization.as_deref(), params.download).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn restore(&self, workspace_id: &str, input: models::RestoreRequest) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::restore_workspace(self.client.configuration(), workspace_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn sync(&self, workspace_id: &str, input: Option<models::SyncWorkspaceRequest>) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::sync_workspace(self.client.configuration(), workspace_id, &key, self.options.organization.as_deref(), input).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn update(&self, workspace_id: &str, input: models::WorkspacePatch) -> Result<models::Workspace,ClientError> {
        
        crate::apis::workspaces_api::update_workspace(self.client.configuration(), workspace_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn write_file(&self, workspace_id: &str, input: std::path::PathBuf, params: WriteFileParams) -> Result<models::Operation,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::workspaces_api::write_file(self.client.configuration(), workspace_id, &params.path, &params.if_match, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListAgentsParams {pub cursor: Option<String>,pub limit: Option<i32>}
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
pub async fn get(&self, agent_id: &str) -> Result<models::Agent,ClientError> {
        
        crate::apis::agents_api::get_agent(self.client.configuration(), agent_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListAgentsParams) -> Result<models::ListAgents200Response,ClientError> {
        
        crate::apis::agents_api::list_agents(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn update(&self, agent_id: &str, input: models::AgentPatch) -> Result<models::Agent,ClientError> {
        
        crate::apis::agents_api::update_agent(self.client.configuration(), agent_id, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListSessionsParams {pub cursor: Option<String>,pub limit: Option<i32>,pub workspace_id: Option<String>}
pub struct SessionsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> SessionsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn continue_run(&self, session_id: &str, input: models::MessageCreate) -> Result<models::RunAccepted,ClientError> {
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
        
        crate::apis::sessions_api::list_sessions(self.client.configuration(), params.cursor.as_deref(), params.limit, params.workspace_id.as_deref(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListArtifactsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListRunEventsParams {pub after: Option<String>,pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListRunsParams {pub status: Option<String>,pub project_id: Option<String>,pub from: Option<chrono::DateTime<chrono::FixedOffset>>,pub to: Option<chrono::DateTime<chrono::FixedOffset>>,pub cursor: Option<String>,pub limit: Option<i32>,pub workspace_id: Option<String>,pub session_id: Option<String>}
pub struct RunsResource<'a> {client:&'a Client,options:RequestOptions}
    impl<'a> RunsResource<'a> {
      pub fn with_options(mut self, options:RequestOptions) -> Self {self.options=options;self}
      pub async fn cancel(&self, run_id: &str) -> Result<models::Run,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::runs_api::cancel_run(self.client.configuration(), run_id, &key, std::collections::HashMap::new(), self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
      }
pub async fn create(&self, input: models::RunCreate) -> Result<models::RunAccepted,ClientError> {
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
        
        crate::apis::runs_api::list_runs(self.client.configuration(), params.status.as_deref(), params.project_id.as_deref(), params.from, params.to, params.cursor.as_deref(), params.limit, params.workspace_id.as_deref(), params.session_id.as_deref(), self.options.organization.as_deref()).await
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
      pub async fn download(&self, artifact_id: &str) -> Result<models::Download,ClientError> {
        
        crate::apis::artifacts_api::download_artifact(self.client.configuration(), artifact_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
    }
#[derive(Debug,Clone,Default)] pub struct ListConnectionsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListConnectionToolsParams {pub cursor: Option<String>,pub limit: Option<i32>}
#[derive(Debug,Clone,Default)] pub struct ListStdioPackagesParams {pub cursor: Option<String>,pub limit: Option<i32>}
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
pub async fn delete(&self, connection_id: &str) -> Result<(),ClientError> {
        
        crate::apis::connections_api::delete_connection(self.client.configuration(), connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get(&self, connection_id: &str) -> Result<models::Connection,ClientError> {
        
        crate::apis::connections_api::get_connection(self.client.configuration(), connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn get_grants(&self, connection_id: &str) -> Result<models::ConnectionGrantSet,ClientError> {
        
        crate::apis::connections_api::get_connection_grants(self.client.configuration(), connection_id, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,None))
      }
pub async fn list(&self, params: ListConnectionsParams) -> Result<models::ListConnections200Response,ClientError> {
        
        crate::apis::connections_api::list_connections(self.client.configuration(), params.cursor.as_deref(), params.limit, self.options.organization.as_deref()).await
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
pub async fn set_grants(&self, connection_id: &str, input: models::ConnectionGrantSet) -> Result<models::ConnectionGrantSet,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::connections_api::set_connection_grants(self.client.configuration(), connection_id, &key, input, self.options.organization.as_deref()).await
          .map_err(|error|crate::request_error(error,Some(key)))
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
      pub async fn disconnect_github(&self, project_id: &str) -> Result<models::Project,ClientError> {
        let key = self.options.idempotency_key.clone().unwrap_or_else(||uuid::Uuid::new_v4().to_string());
        crate::apis::integrations_api::disconnect_github(self.client.configuration(), project_id, &key, self.options.organization.as_deref()).await
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
