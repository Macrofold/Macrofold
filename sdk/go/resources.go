// Code generated from OpenAPI by pnpm sdk:generate:all; DO NOT EDIT.
package macrofold
import ("context"; "os"; "time")
const DefaultOrigin = "https://app.macrofold.ai"
type Client struct { *APIClient; Projects *ProjectsResource;Workspaces *WorkspacesResource;Agents *AgentsResource;Sessions *SessionsResource;Runs *RunsResource;Artifacts *ArtifactsResource;Connections *ConnectionsResource;ApiKeys *ApiKeysResource;WebhookEndpoints *WebhookEndpointsResource;WebhookDeliveries *WebhookDeliveriesResource;Usage *UsageResource;Requests *RequestsResource;Billing *BillingResource;Harnesses *HarnessesResource;Models *ModelsResource;Operations *OperationsResource;Operator *OperatorResource;Checkpoints *CheckpointsResource;Me *MeResource;Transfers *TransfersResource;Integrations *IntegrationsResource;Organizations *OrganizationsResource;Triggers *TriggersResource;SlackConnections *SlackConnectionsResource }
func resources(api *APIClient) *Client { return &Client{APIClient:api, Projects:&ProjectsResource{api},Workspaces:&WorkspacesResource{api},Agents:&AgentsResource{api},Sessions:&SessionsResource{api},Runs:&RunsResource{api},Artifacts:&ArtifactsResource{api},Connections:&ConnectionsResource{api},ApiKeys:&ApiKeysResource{api},WebhookEndpoints:&WebhookEndpointsResource{api},WebhookDeliveries:&WebhookDeliveriesResource{api},Usage:&UsageResource{api},Requests:&RequestsResource{api},Billing:&BillingResource{api},Harnesses:&HarnessesResource{api},Models:&ModelsResource{api},Operations:&OperationsResource{api},Operator:&OperatorResource{api},Checkpoints:&CheckpointsResource{api},Me:&MeResource{api},Transfers:&TransfersResource{api},Integrations:&IntegrationsResource{api},Organizations:&OrganizationsResource{api},Triggers:&TriggersResource{api},SlackConnections:&SlackConnectionsResource{api},} }

type ProjectsResource struct {client *APIClient}
func (r *ProjectsResource) CancelDeletion(ctx context.Context, projectId string, options ...RequestOption) (*Project, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.ProjectsAPI.CancelProjectDeletion(ctx, projectId)
        
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ProjectsResource) Create(ctx context.Context, input *ProjectCreate, options ...RequestOption) (*Project, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ProjectsAPI.CreateProject(ctx)
        if input != nil {call = call.ProjectCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ProjectsResource) CreateWorkspace(ctx context.Context, projectId string, input *WorkspaceCreate, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ProjectsAPI.CreateWorkspace(ctx, projectId)
        if input != nil {call = call.WorkspaceCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ProjectsResource) Delete(ctx context.Context, projectId string, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.ProjectsAPI.DeleteProject(ctx, projectId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *ProjectsResource) Get(ctx context.Context, projectId string, options ...RequestOption) (*Project, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.ProjectsAPI.GetProject(ctx, projectId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListProjectsParams struct {Cursor *string;Limit *int32;Query *string;Archived *bool}
func (r *ProjectsResource) List(ctx context.Context, params *ListProjectsParams, options ...RequestOption) (*ListProjects200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListProjectsParams{}}
        call := r.client.ProjectsAPI.ListProjects(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.Query != nil {call = call.Query(*params.Query)}
if params.Archived != nil {call = call.Archived(*params.Archived)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListWorkspacesParams struct {Cursor *string;Limit *int32}
func (r *ProjectsResource) ListWorkspaces(ctx context.Context, projectId string, params *ListWorkspacesParams, options ...RequestOption) (*ListWorkspaces200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListWorkspacesParams{}}
        call := r.client.ProjectsAPI.ListWorkspaces(ctx, projectId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *ProjectsResource) ScheduleDeletion(ctx context.Context, projectId string, input *ProjectDeletion, options ...RequestOption) (*Project, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ProjectsAPI.ScheduleProjectDeletion(ctx, projectId)
        if input != nil {call = call.ProjectDeletion(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ProjectsResource) Update(ctx context.Context, projectId string, input *ProjectPatch, options ...RequestOption) (*Project, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ProjectsAPI.UpdateProject(ctx, projectId)
        if input != nil {call = call.ProjectPatch(*input)}
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type WorkspacesResource struct {client *APIClient}
func (r *WorkspacesResource) CreateCheckpoint(ctx context.Context, workspaceId string, input *CheckpointCreate, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.WorkspacesAPI.CreateCheckpoint(ctx, workspaceId)
        if input != nil {call = call.CheckpointCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkspacesResource) CreateTransfer(ctx context.Context, workspaceId string, input *TransferCreate, options ...RequestOption) (*Transfer, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.WorkspacesAPI.CreateTransfer(ctx, workspaceId)
        if input != nil {call = call.TransferCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type DeleteFileParams struct {Path string;IfMatch string}
func (r *WorkspacesResource) DeleteFile(ctx context.Context, workspaceId string, params *DeleteFileParams, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorkspacesAPI.DeleteFile(ctx, workspaceId)
        
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkspacesResource) Delete(ctx context.Context, workspaceId string, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.WorkspacesAPI.DeleteWorkspace(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WorkspacesResource) GetSync(ctx context.Context, workspaceId string, options ...RequestOption) (*GitSync, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.WorkspacesAPI.GetSync(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WorkspacesResource) Get(ctx context.Context, workspaceId string, options ...RequestOption) (*Workspace, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.WorkspacesAPI.GetWorkspace(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetWorkspaceDiffParams struct {BaseCheckpointId *string;Path *string;Cursor *string;Limit *int32}
func (r *WorkspacesResource) GetDiff(ctx context.Context, workspaceId string, params *GetWorkspaceDiffParams, options ...RequestOption) (*WorkspaceDiff, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &GetWorkspaceDiffParams{}}
        call := r.client.WorkspacesAPI.GetWorkspaceDiff(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.BaseCheckpointId != nil {call = call.BaseCheckpointId(*params.BaseCheckpointId)}
if params.Path != nil {call = call.Path(*params.Path)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListCheckpointsParams struct {Cursor *string;Limit *int32}
func (r *WorkspacesResource) ListCheckpoints(ctx context.Context, workspaceId string, params *ListCheckpointsParams, options ...RequestOption) (*ListCheckpoints200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListCheckpointsParams{}}
        call := r.client.WorkspacesAPI.ListCheckpoints(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListFilesParams struct {Path *string;Cursor *string;Limit *int32;Query *string}
func (r *WorkspacesResource) ListFiles(ctx context.Context, workspaceId string, params *ListFilesParams, options ...RequestOption) (*FileListing, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListFilesParams{}}
        call := r.client.WorkspacesAPI.ListFiles(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Path != nil {call = call.Path(*params.Path)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.Query != nil {call = call.Query(*params.Query)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListTransfersParams struct {Cursor *string;Limit *int32}
func (r *WorkspacesResource) ListTransfers(ctx context.Context, workspaceId string, params *ListTransfersParams, options ...RequestOption) (*ListTransfers200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListTransfersParams{}}
        call := r.client.WorkspacesAPI.ListTransfers(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ReadFileParams struct {Path string;Download *bool}
func (r *WorkspacesResource) ReadFile(ctx context.Context, workspaceId string, params *ReadFileParams, options ...RequestOption) (*os.File, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorkspacesAPI.ReadFile(ctx, workspaceId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
if params.Download != nil {call = call.Download(*params.Download)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WorkspacesResource) Restore(ctx context.Context, workspaceId string, input *RestoreRequest, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.WorkspacesAPI.RestoreWorkspace(ctx, workspaceId)
        if input != nil {call = call.RestoreRequest(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkspacesResource) Sync(ctx context.Context, workspaceId string, input *SyncWorkspaceRequest, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.WorkspacesAPI.SyncWorkspace(ctx, workspaceId)
        if input != nil {call = call.SyncWorkspaceRequest(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkspacesResource) Update(ctx context.Context, workspaceId string, input *WorkspacePatch, options ...RequestOption) (*Workspace, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.WorkspacesAPI.UpdateWorkspace(ctx, workspaceId)
        if input != nil {call = call.WorkspacePatch(*input)}
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type WriteFileParams struct {Path string;IfMatch string}
func (r *WorkspacesResource) WriteFile(ctx context.Context, workspaceId string, content *os.File, params *WriteFileParams, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if content == nil {return nil, missingParameter("content")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorkspacesAPI.WriteFile(ctx, workspaceId)
        if content != nil {call = call.Body(content)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type AgentsResource struct {client *APIClient}
func (r *AgentsResource) Create(ctx context.Context, input *AgentCreate, options ...RequestOption) (*Agent, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.AgentsAPI.CreateAgent(ctx)
        if input != nil {call = call.AgentCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *AgentsResource) Delete(ctx context.Context, agentId string, options ...RequestOption) error {
        settings, err := requestOptions(options, false); if err != nil {return err}
        
        
        call := r.client.AgentsAPI.DeleteAgent(ctx, agentId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        response, callError := call.Execute()
        return requestError(callError, response, "")
      }
func (r *AgentsResource) Get(ctx context.Context, agentId string, options ...RequestOption) (*Agent, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.AgentsAPI.GetAgent(ctx, agentId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListAgentsParams struct {Cursor *string;Limit *int32}
func (r *AgentsResource) List(ctx context.Context, params *ListAgentsParams, options ...RequestOption) (*ListAgents200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListAgentsParams{}}
        call := r.client.AgentsAPI.ListAgents(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *AgentsResource) Update(ctx context.Context, agentId string, input *AgentPatch, options ...RequestOption) (*Agent, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.AgentsAPI.UpdateAgent(ctx, agentId)
        if input != nil {call = call.AgentPatch(*input)}
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type SessionsResource struct {client *APIClient}
func (r *SessionsResource) ContinueRun(ctx context.Context, sessionId string, input *MessageCreate, options ...RequestOption) (*RunAccepted, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.SessionsAPI.ContinueSession(ctx, sessionId)
        if input != nil {call = call.MessageCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *SessionsResource) Create(ctx context.Context, input *SessionCreate, options ...RequestOption) (*Session, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.SessionsAPI.CreateSession(ctx)
        if input != nil {call = call.SessionCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *SessionsResource) Get(ctx context.Context, sessionId string, options ...RequestOption) (*Session, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.SessionsAPI.GetSession(ctx, sessionId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListSessionsParams struct {Cursor *string;Limit *int32;WorkspaceId *string}
func (r *SessionsResource) List(ctx context.Context, params *ListSessionsParams, options ...RequestOption) (*ListSessions200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListSessionsParams{}}
        call := r.client.SessionsAPI.ListSessions(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.WorkspaceId != nil {call = call.WorkspaceId(*params.WorkspaceId)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type RunsResource struct {client *APIClient}
func (r *RunsResource) Cancel(ctx context.Context, runId string, options ...RequestOption) (*Run, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.RunsAPI.CancelRun(ctx, runId)
        call = call.RequestBody(map[string]*interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *RunsResource) Create(ctx context.Context, input *RunCreate, options ...RequestOption) (*RunAccepted, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.RunsAPI.CreateRun(ctx)
        if input != nil {call = call.RunCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *RunsResource) Get(ctx context.Context, runId string, options ...RequestOption) (*Run, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.RunsAPI.GetRun(ctx, runId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *RunsResource) GetResult(ctx context.Context, runId string, options ...RequestOption) (*RunResult, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.RunsAPI.GetRunResult(ctx, runId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListArtifactsParams struct {Cursor *string;Limit *int32}
func (r *RunsResource) ListArtifacts(ctx context.Context, runId string, params *ListArtifactsParams, options ...RequestOption) (*ListArtifacts200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListArtifactsParams{}}
        call := r.client.RunsAPI.ListArtifacts(ctx, runId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListRunEventsParams struct {After *string;Cursor *string;Limit *int32}
func (r *RunsResource) ListEvents(ctx context.Context, runId string, params *ListRunEventsParams, options ...RequestOption) (*ListRunEvents200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListRunEventsParams{}}
        call := r.client.RunsAPI.ListRunEvents(ctx, runId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.After != nil {call = call.After(*params.After)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListRunsParams struct {Status *string;ProjectId *string;From *time.Time;To *time.Time;Cursor *string;Limit *int32;WorkspaceId *string;SessionId *string}
func (r *RunsResource) List(ctx context.Context, params *ListRunsParams, options ...RequestOption) (*ListRuns200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListRunsParams{}}
        call := r.client.RunsAPI.ListRuns(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Status != nil {call = call.Status(*params.Status)}
if params.ProjectId != nil {call = call.ProjectId(*params.ProjectId)}
if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.WorkspaceId != nil {call = call.WorkspaceId(*params.WorkspaceId)}
if params.SessionId != nil {call = call.SessionId(*params.SessionId)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *RunsResource) Stream(ctx context.Context, runID, after string, receive func(Event) error, options ...RequestOption) error { return r.client.Stream(ctx,runID,after,receive,options...) }
func (r *RunsResource) SubmitInput(ctx context.Context, runId string, input *RunInput, options ...RequestOption) (*Run, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.RunsAPI.SubmitRunInput(ctx, runId)
        if input != nil {call = call.RunInput(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type ArtifactsResource struct {client *APIClient}
func (r *ArtifactsResource) Download(ctx context.Context, artifactId string, options ...RequestOption) (*Download, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.ArtifactsAPI.DownloadArtifact(ctx, artifactId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ConnectionsResource struct {client *APIClient}
func (r *ConnectionsResource) Authorize(ctx context.Context, connectionId string, input *AuthorizeRequest, options ...RequestOption) (*AuthorizationLink, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ConnectionsAPI.AuthorizeConnection(ctx, connectionId)
        if input != nil {call = call.AuthorizeRequest(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ConnectionsResource) Create(ctx context.Context, input *ConnectionCreate, options ...RequestOption) (*Connection, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ConnectionsAPI.CreateConnection(ctx)
        if input != nil {call = call.ConnectionCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ConnectionsResource) Delete(ctx context.Context, connectionId string, options ...RequestOption) error {
        settings, err := requestOptions(options, false); if err != nil {return err}
        
        
        call := r.client.ConnectionsAPI.DeleteConnection(ctx, connectionId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        response, callError := call.Execute()
        return requestError(callError, response, "")
      }
func (r *ConnectionsResource) Get(ctx context.Context, connectionId string, options ...RequestOption) (*Connection, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.ConnectionsAPI.GetConnection(ctx, connectionId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *ConnectionsResource) GetGrants(ctx context.Context, connectionId string, options ...RequestOption) (*ConnectionGrantSet, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.ConnectionsAPI.GetConnectionGrants(ctx, connectionId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListConnectionsParams struct {Cursor *string;Limit *int32}
func (r *ConnectionsResource) List(ctx context.Context, params *ListConnectionsParams, options ...RequestOption) (*ListConnections200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListConnectionsParams{}}
        call := r.client.ConnectionsAPI.ListConnections(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListConnectionToolsParams struct {Cursor *string;Limit *int32}
func (r *ConnectionsResource) ListTools(ctx context.Context, connectionId string, params *ListConnectionToolsParams, options ...RequestOption) (*ListConnectionTools200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListConnectionToolsParams{}}
        call := r.client.ConnectionsAPI.ListConnectionTools(ctx, connectionId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *ConnectionsResource) ListConnectorCatalog(ctx context.Context, options ...RequestOption) (*ConnectorCatalog, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.ConnectionsAPI.ListConnectorCatalog(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListStdioPackagesParams struct {Cursor *string;Limit *int32}
func (r *ConnectionsResource) ListStdioPackages(ctx context.Context, params *ListStdioPackagesParams, options ...RequestOption) (*StdioPackagePage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListStdioPackagesParams{}}
        call := r.client.ConnectionsAPI.ListStdioPackages(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *ConnectionsResource) SetGrants(ctx context.Context, connectionId string, input *ConnectionGrantSet, options ...RequestOption) (*ConnectionGrantSet, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ConnectionsAPI.SetConnectionGrants(ctx, connectionId)
        if input != nil {call = call.ConnectionGrantSet(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ConnectionsResource) Test(ctx context.Context, connectionId string, options ...RequestOption) (*ConnectionTest, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.ConnectionsAPI.TestConnection(ctx, connectionId)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ConnectionsResource) Update(ctx context.Context, connectionId string, input *ConnectionPatch, options ...RequestOption) (*Connection, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ConnectionsAPI.UpdateConnection(ctx, connectionId)
        if input != nil {call = call.ConnectionPatch(*input)}
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ApiKeysResource struct {client *APIClient}
func (r *ApiKeysResource) Create(ctx context.Context, input *KeyCreate, options ...RequestOption) (*CreatedApiKey, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.ApiKeysAPI.CreateApiKey(ctx)
        if input != nil {call = call.KeyCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type ListApiKeysParams struct {Cursor *string;Limit *int32}
func (r *ApiKeysResource) List(ctx context.Context, params *ListApiKeysParams, options ...RequestOption) (*ListApiKeys200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListApiKeysParams{}}
        call := r.client.ApiKeysAPI.ListApiKeys(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *ApiKeysResource) Revoke(ctx context.Context, keyId string, options ...RequestOption) error {
        settings, err := requestOptions(options, false); if err != nil {return err}
        
        
        call := r.client.ApiKeysAPI.RevokeApiKey(ctx, keyId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        response, callError := call.Execute()
        return requestError(callError, response, "")
      }
type WebhookEndpointsResource struct {client *APIClient}
func (r *WebhookEndpointsResource) Create(ctx context.Context, input *WebhookCreate, options ...RequestOption) (*CreatedWebhook, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.WebhookEndpointsAPI.CreateWebhookEndpoint(ctx)
        if input != nil {call = call.WebhookCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WebhookEndpointsResource) Delete(ctx context.Context, endpointId string, options ...RequestOption) error {
        settings, err := requestOptions(options, false); if err != nil {return err}
        
        
        call := r.client.WebhookEndpointsAPI.DeleteWebhookEndpoint(ctx, endpointId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        response, callError := call.Execute()
        return requestError(callError, response, "")
      }
type ListWebhookEndpointsParams struct {Cursor *string;Limit *int32}
func (r *WebhookEndpointsResource) List(ctx context.Context, params *ListWebhookEndpointsParams, options ...RequestOption) (*ListWebhookEndpoints200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListWebhookEndpointsParams{}}
        call := r.client.WebhookEndpointsAPI.ListWebhookEndpoints(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WebhookEndpointsResource) RotateWebhookSecret(ctx context.Context, endpointId string, options ...RequestOption) (*CreatedWebhook, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.WebhookEndpointsAPI.RotateWebhookSecret(ctx, endpointId)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WebhookEndpointsResource) Update(ctx context.Context, endpointId string, input *WebhookPatch, options ...RequestOption) (*Webhook, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.WebhookEndpointsAPI.UpdateWebhookEndpoint(ctx, endpointId)
        if input != nil {call = call.WebhookPatch(*input)}
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type WebhookDeliveriesResource struct {client *APIClient}
type ListWebhookDeliveriesParams struct {Cursor *string;Limit *int32}
func (r *WebhookDeliveriesResource) List(ctx context.Context, params *ListWebhookDeliveriesParams, options ...RequestOption) (*ListWebhookDeliveries200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListWebhookDeliveriesParams{}}
        call := r.client.WebhookDeliveriesAPI.ListWebhookDeliveries(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WebhookDeliveriesResource) Replay(ctx context.Context, deliveryId string, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.WebhookDeliveriesAPI.ReplayWebhookDelivery(ctx, deliveryId)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type UsageResource struct {client *APIClient}
type GetUsageParams struct {From *time.Time;To *time.Time;GroupBy *string}
func (r *UsageResource) Get(ctx context.Context, params *GetUsageParams, options ...RequestOption) (*Report, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &GetUsageParams{}}
        call := r.client.UsageAPI.GetUsage(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.GroupBy != nil {call = call.GroupBy(*params.GroupBy)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type RequestsResource struct {client *APIClient}
type ListRequestsParams struct {From *time.Time;To *time.Time;Cursor *string;Limit *int32}
func (r *RequestsResource) List(ctx context.Context, params *ListRequestsParams, options ...RequestOption) (*ListRequests200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListRequestsParams{}}
        call := r.client.RequestsAPI.ListRequests(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type BillingResource struct {client *APIClient}
func (r *BillingResource) CreatePortal(ctx context.Context, options ...RequestOption) (*Redirect, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.BillingAPI.CreateBillingPortal(ctx)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *BillingResource) CreateCheckout(ctx context.Context, input *CheckoutCreate, options ...RequestOption) (*Redirect, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.BillingAPI.CreateCheckout(ctx)
        if input != nil {call = call.CheckoutCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *BillingResource) Get(ctx context.Context, options ...RequestOption) (*Billing, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.BillingAPI.GetBilling(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *BillingResource) GetStorage(ctx context.Context, options ...RequestOption) (*Storage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.BillingAPI.GetStorage(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *BillingResource) UpdateStoragePolicy(ctx context.Context, input *StoragePolicy, options ...RequestOption) (*Storage, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.BillingAPI.UpdateStoragePolicy(ctx)
        if input != nil {call = call.StoragePolicy(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type HarnessesResource struct {client *APIClient}
type ListHarnessesParams struct {Cursor *string;Limit *int32}
func (r *HarnessesResource) List(ctx context.Context, params *ListHarnessesParams, options ...RequestOption) (*ListHarnesses200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListHarnessesParams{}}
        call := r.client.HarnessesAPI.ListHarnesses(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ModelsResource struct {client *APIClient}
type ListModelsParams struct {Harness *string;Cursor *string;Limit *int32}
func (r *ModelsResource) List(ctx context.Context, params *ListModelsParams, options ...RequestOption) (*ListModels200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListModelsParams{}}
        call := r.client.ModelsAPI.ListModels(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Harness != nil {call = call.Harness(*params.Harness)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type OperationsResource struct {client *APIClient}
func (r *OperationsResource) Get(ctx context.Context, operationId string, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.OperationsAPI.GetOperation(ctx, operationId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type OperatorResource struct {client *APIClient}
type GetAccountSummaryParams struct {From *time.Time;To *time.Time;IncludeContact *bool}
func (r *OperatorResource) GetAccountSummary(ctx context.Context, accountId string, params *GetAccountSummaryParams, options ...RequestOption) (*AccountSummary, error) {
        
        
        if params == nil {params = &GetAccountSummaryParams{}}
        call := r.client.OperatorAPI.GetAccountSummary(ctx, accountId)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.IncludeContact != nil {call = call.IncludeContact(*params.IncludeContact)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetCapacityReportParams struct {From *time.Time;To *time.Time}
func (r *OperatorResource) GetCapacityReport(ctx context.Context, params *GetCapacityReportParams, options ...RequestOption) (*Report, error) {
        
        
        if params == nil {params = &GetCapacityReportParams{}}
        call := r.client.OperatorAPI.GetCapacityReport(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetGrowthMetricsParams struct {From *time.Time;To *time.Time;GroupBy *string;OrganizationId *string}
func (r *OperatorResource) GetGrowthMetrics(ctx context.Context, params *GetGrowthMetricsParams, options ...RequestOption) (*Report, error) {
        
        
        if params == nil {params = &GetGrowthMetricsParams{}}
        call := r.client.OperatorAPI.GetGrowthMetrics(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.GroupBy != nil {call = call.GroupBy(*params.GroupBy)}
if params.OrganizationId != nil {call = call.OrganizationId(*params.OrganizationId)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetInfrastructureHealthParams struct {From *time.Time;To *time.Time;ServiceId *string}
func (r *OperatorResource) GetInfrastructureHealth(ctx context.Context, params *GetInfrastructureHealthParams, options ...RequestOption) (*Report, error) {
        
        
        if params == nil {params = &GetInfrastructureHealthParams{}}
        call := r.client.OperatorAPI.GetInfrastructureHealth(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.ServiceId != nil {call = call.ServiceId(*params.ServiceId)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetOperatingReportParams struct {From *time.Time;To *time.Time}
func (r *OperatorResource) GetOperatingReport(ctx context.Context, params *GetOperatingReportParams, options ...RequestOption) (*Report, error) {
        
        
        if params == nil {params = &GetOperatingReportParams{}}
        call := r.client.OperatorAPI.GetOperatingReport(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetPlatformUsageMetricsParams struct {From *time.Time;To *time.Time;GroupBy *string;OrganizationId *string}
func (r *OperatorResource) GetPlatformUsageMetrics(ctx context.Context, params *GetPlatformUsageMetricsParams, options ...RequestOption) (*Report, error) {
        
        
        if params == nil {params = &GetPlatformUsageMetricsParams{}}
        call := r.client.OperatorAPI.GetPlatformUsageMetrics(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.GroupBy != nil {call = call.GroupBy(*params.GroupBy)}
if params.OrganizationId != nil {call = call.OrganizationId(*params.OrganizationId)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetRunDiagnosticsParams struct {From *time.Time;To *time.Time}
func (r *OperatorResource) GetRunDiagnostics(ctx context.Context, runId string, params *GetRunDiagnosticsParams, options ...RequestOption) (*Diagnostics, error) {
        
        
        if params == nil {params = &GetRunDiagnosticsParams{}}
        call := r.client.OperatorAPI.GetRunDiagnostics(ctx, runId)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListAccountsParams struct {From *time.Time;To *time.Time;Query *string;IncludeContact *bool;Cursor *string;Limit *int32}
func (r *OperatorResource) ListAccounts(ctx context.Context, params *ListAccountsParams, options ...RequestOption) (*ListAccounts200Response, error) {
        
        
        if params == nil {params = &ListAccountsParams{}}
        call := r.client.OperatorAPI.ListAccounts(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.Query != nil {call = call.Query(*params.Query)}
if params.IncludeContact != nil {call = call.IncludeContact(*params.IncludeContact)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListPlatformRequestsParams struct {From *time.Time;To *time.Time;OrganizationId *string;StatusCode *int32;Route *string;Cursor *string;Limit *int32}
func (r *OperatorResource) ListPlatformRequests(ctx context.Context, params *ListPlatformRequestsParams, options ...RequestOption) (*ListRequests200Response, error) {
        
        
        if params == nil {params = &ListPlatformRequestsParams{}}
        call := r.client.OperatorAPI.ListPlatformRequests(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.OrganizationId != nil {call = call.OrganizationId(*params.OrganizationId)}
if params.StatusCode != nil {call = call.StatusCode(*params.StatusCode)}
if params.Route != nil {call = call.Route(*params.Route)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListReportSnapshotsParams struct {From *time.Time;To *time.Time;Cursor *string;Limit *int32}
func (r *OperatorResource) ListReportSnapshots(ctx context.Context, params *ListReportSnapshotsParams, options ...RequestOption) (*ReportSnapshotPage, error) {
        
        
        if params == nil {params = &ListReportSnapshotsParams{}}
        call := r.client.OperatorAPI.ListReportSnapshots(ctx)
        
        
        
        if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type CheckpointsResource struct {client *APIClient}
func (r *CheckpointsResource) ExportArchive(ctx context.Context, checkpointId string, input *CheckpointExportRequest, options ...RequestOption) (*ExportOperation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.CheckpointsAPI.ExportCheckpoint(ctx, checkpointId)
        if input != nil {call = call.CheckpointExportRequest(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *CheckpointsResource) UpdateRetention(ctx context.Context, checkpointId string, input *CheckpointPatch, options ...RequestOption) (*Checkpoint, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.CheckpointsAPI.UpdateCheckpointRetention(ctx, checkpointId)
        if input != nil {call = call.CheckpointPatch(*input)}
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type MeResource struct {client *APIClient}
func (r *MeResource) Get(ctx context.Context, options ...RequestOption) (*Identity, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.MeAPI.GetIdentity(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type TransfersResource struct {client *APIClient}
func (r *TransfersResource) Apply(ctx context.Context, transferId string, input *TransferApply, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.TransfersAPI.ApplyTransfer(ctx, transferId)
        if input != nil {call = call.TransferApply(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TransfersResource) Get(ctx context.Context, transferId string, options ...RequestOption) (*Transfer, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.TransfersAPI.GetTransfer(ctx, transferId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type IntegrationsResource struct {client *APIClient}
func (r *IntegrationsResource) DisconnectGithub(ctx context.Context, projectId string, options ...RequestOption) (*Project, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.IntegrationsAPI.DisconnectGithub(ctx, projectId)
        
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *IntegrationsResource) ListGithubInstallations(ctx context.Context, options ...RequestOption) (*GithubInstallations, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.IntegrationsAPI.ListGithubInstallations(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListGithubRepositoriesParams struct {InstallationId string}
func (r *IntegrationsResource) ListGithubRepositories(ctx context.Context, params *ListGithubRepositoriesParams, options ...RequestOption) (*GithubRepositories, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {return nil, missingParameter("params")}
        call := r.client.IntegrationsAPI.ListGithubRepositories(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.InstallationId(params.InstallationId)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type OrganizationsResource struct {client *APIClient}
func (r *OrganizationsResource) CreateInvitation(ctx context.Context, input *InvitationCreate, options ...RequestOption) (*Invitation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.OrganizationsAPI.CreateInvitation(ctx)
        if input != nil {call = call.InvitationCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *OrganizationsResource) Create(ctx context.Context, input *OrganizationCreate, options ...RequestOption) (*Organization, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.OrganizationsAPI.CreateOrganization(ctx)
        if input != nil {call = call.OrganizationCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *OrganizationsResource) GetExecutionPolicy(ctx context.Context, options ...RequestOption) (*ExecutionPolicy, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.OrganizationsAPI.GetExecutionPolicy(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *OrganizationsResource) ListInvitations(ctx context.Context, options ...RequestOption) (*ListInvitations200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.OrganizationsAPI.ListInvitations(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *OrganizationsResource) ListMembers(ctx context.Context, options ...RequestOption) (*ListMembers200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.OrganizationsAPI.ListMembers(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *OrganizationsResource) ListAudit(ctx context.Context, options ...RequestOption) (*ListOrganizationAudit200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.OrganizationsAPI.ListOrganizationAudit(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *OrganizationsResource) RemoveMember(ctx context.Context, userId string, options ...RequestOption) error {
        settings, err := requestOptions(options, true); if err != nil {return err}
        
        
        call := r.client.OrganizationsAPI.RemoveMember(ctx, userId)
        
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        response, callError := call.Execute()
        return requestError(callError, response, settings.idempotencyKey)
      }
func (r *OrganizationsResource) RevokeInvitation(ctx context.Context, invitationId string, options ...RequestOption) error {
        settings, err := requestOptions(options, true); if err != nil {return err}
        
        
        call := r.client.OrganizationsAPI.RevokeInvitation(ctx, invitationId)
        
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        response, callError := call.Execute()
        return requestError(callError, response, settings.idempotencyKey)
      }
func (r *OrganizationsResource) UpdateExecutionPolicy(ctx context.Context, input *ExecutionPolicyPatch, options ...RequestOption) (*ExecutionPolicy, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.OrganizationsAPI.UpdateExecutionPolicy(ctx)
        if input != nil {call = call.ExecutionPolicyPatch(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *OrganizationsResource) UpdateMember(ctx context.Context, userId string, input *MemberPatch, options ...RequestOption) error {
        settings, err := requestOptions(options, true); if err != nil {return err}
        if input == nil {return missingParameter("input")}
        
        call := r.client.OrganizationsAPI.UpdateMember(ctx, userId)
        if input != nil {call = call.MemberPatch(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        response, callError := call.Execute()
        return requestError(callError, response, settings.idempotencyKey)
      }
func (r *OrganizationsResource) Update(ctx context.Context, input *OrganizationCreate, options ...RequestOption) (*Organization, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.OrganizationsAPI.UpdateOrganization(ctx)
        if input != nil {call = call.OrganizationCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type TriggersResource struct {client *APIClient}
func (r *TriggersResource) Create(ctx context.Context, input *TriggerCreate, options ...RequestOption) (*CreatedTrigger, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.TriggersAPI.CreateTrigger(ctx)
        if input != nil {call = call.TriggerCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TriggersResource) Delete(ctx context.Context, triggerId string, options ...RequestOption) (*DeleteTrigger200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.TriggersAPI.DeleteTrigger(ctx, triggerId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *TriggersResource) Get(ctx context.Context, triggerId string, options ...RequestOption) (*Trigger, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.TriggersAPI.GetTrigger(ctx, triggerId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListTriggerDeliveriesParams struct {Cursor *string;Limit *int32}
func (r *TriggersResource) ListDeliveries(ctx context.Context, triggerId string, params *ListTriggerDeliveriesParams, options ...RequestOption) (*ListTriggerDeliveries200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListTriggerDeliveriesParams{}}
        call := r.client.TriggersAPI.ListTriggerDeliveries(ctx, triggerId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListTriggersParams struct {Cursor *string;Limit *int32;Kind *string}
func (r *TriggersResource) List(ctx context.Context, params *ListTriggersParams, options ...RequestOption) (*ListTriggers200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListTriggersParams{}}
        call := r.client.TriggersAPI.ListTriggers(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.Kind != nil {call = call.Kind(*params.Kind)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *TriggersResource) RetryReply(ctx context.Context, triggerId string, deliveryId string, options ...RequestOption) (*TriggerDelivery, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.TriggersAPI.RetryTriggerReply(ctx, triggerId, deliveryId)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TriggersResource) RotateSecret(ctx context.Context, triggerId string, options ...RequestOption) (*TriggerSecret, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.TriggersAPI.RotateTriggerSecret(ctx, triggerId)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TriggersResource) Run(ctx context.Context, triggerId string, options ...RequestOption) (*TriggerDelivery, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        
        
        call := r.client.TriggersAPI.RunTrigger(ctx, triggerId)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TriggersResource) Update(ctx context.Context, triggerId string, input *TriggerPatch, options ...RequestOption) (*Trigger, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.TriggersAPI.UpdateTrigger(ctx, triggerId)
        if input != nil {call = call.TriggerPatch(*input)}
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type SlackConnectionsResource struct {client *APIClient}
func (r *SlackConnectionsResource) Create(ctx context.Context, input *SlackConnectionCreate, options ...RequestOption) (*SlackConnection, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        
        call := r.client.SlackConnectionsAPI.CreateSlackConnection(ctx)
        if input != nil {call = call.SlackConnectionCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *SlackConnectionsResource) Delete(ctx context.Context, connectionId string, options ...RequestOption) (*DeleteTrigger200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.SlackConnectionsAPI.DeleteSlackConnection(ctx, connectionId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListSlackConnectionChannelsParams struct {Cursor *string}
func (r *SlackConnectionsResource) ListChannels(ctx context.Context, connectionId string, params *ListSlackConnectionChannelsParams, options ...RequestOption) (*ListSlackConnectionChannels200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        if params == nil {params = &ListSlackConnectionChannelsParams{}}
        call := r.client.SlackConnectionsAPI.ListSlackConnectionChannels(ctx, connectionId)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *SlackConnectionsResource) List(ctx context.Context, options ...RequestOption) (*ListSlackConnections200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        
        
        call := r.client.SlackConnectionsAPI.ListSlackConnections(ctx)
        
        
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
