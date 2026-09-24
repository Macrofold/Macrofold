// Code generated from OpenAPI by pnpm sdk:generate:all; DO NOT EDIT.
package macrofold
import ("context"; "os"; "time")
const DefaultOrigin = "https://app.macrofold.ai"
type Client struct { *APIClient; Workspaces *WorkspacesResource;Worktrees *WorktreesResource;Agents *AgentsResource;Sessions *SessionsResource;Runs *RunsResource;Artifacts *ArtifactsResource;Connections *ConnectionsResource;ApiKeys *ApiKeysResource;WebhookEndpoints *WebhookEndpointsResource;WebhookDeliveries *WebhookDeliveriesResource;Usage *UsageResource;Requests *RequestsResource;Billing *BillingResource;Harnesses *HarnessesResource;Models *ModelsResource;Operations *OperationsResource;Operator *OperatorResource;Checkpoints *CheckpointsResource;Me *MeResource;Transfers *TransfersResource;Integrations *IntegrationsResource;Organizations *OrganizationsResource;Triggers *TriggersResource;SlackConnections *SlackConnectionsResource;CustomerAgents *CustomerAgentsResource;Inferences *InferencesResource;Tasks *TasksResource;Workers *WorkersResource }
func resources(api *APIClient) *Client { return &Client{APIClient:api, Workspaces:&WorkspacesResource{api},Worktrees:&WorktreesResource{api},Agents:&AgentsResource{api},Sessions:&SessionsResource{api},Runs:&RunsResource{api},Artifacts:&ArtifactsResource{api},Connections:&ConnectionsResource{api},ApiKeys:&ApiKeysResource{api},WebhookEndpoints:&WebhookEndpointsResource{api},WebhookDeliveries:&WebhookDeliveriesResource{api},Usage:&UsageResource{api},Requests:&RequestsResource{api},Billing:&BillingResource{api},Harnesses:&HarnessesResource{api},Models:&ModelsResource{api},Operations:&OperationsResource{api},Operator:&OperatorResource{api},Checkpoints:&CheckpointsResource{api},Me:&MeResource{api},Transfers:&TransfersResource{api},Integrations:&IntegrationsResource{api},Organizations:&OrganizationsResource{api},Triggers:&TriggersResource{api},SlackConnections:&SlackConnectionsResource{api},CustomerAgents:&CustomerAgentsResource{api},Inferences:&InferencesResource{api},Tasks:&TasksResource{api},Workers:&WorkersResource{api},} }

type WorkspacesResource struct {client *APIClient}
func (r *WorkspacesResource) CancelDeletion(ctx context.Context, workspaceId string, options ...RequestOption) (*Workspace, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.WorkspacesAPI.CancelWorkspaceDeletion(ctx, workspaceId)

        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkspacesResource) Create(ctx context.Context, input *WorkspaceCreate, options ...RequestOption) (*Workspace, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorkspacesAPI.CreateWorkspace(ctx)
        if input != nil {call = call.WorkspaceCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkspacesResource) CreateWorktree(ctx context.Context, workspaceId string, input *WorktreeCreate, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorkspacesAPI.CreateWorktree(ctx, workspaceId)
        if input != nil {call = call.WorktreeCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

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
type GetWorkspaceParams struct {IncludeConnections *bool;AgentId *string;ConnectionsLimit *int32;ConnectionsCursor *string}
func (r *WorkspacesResource) Get(ctx context.Context, workspaceId string, params *GetWorkspaceParams, options ...RequestOption) (*Workspace, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &GetWorkspaceParams{}}
        call := r.client.WorkspacesAPI.GetWorkspace(ctx, workspaceId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.IncludeConnections != nil {call = call.IncludeConnections(*params.IncludeConnections)}
if params.AgentId != nil {call = call.AgentId(*params.AgentId)}
if params.ConnectionsLimit != nil {call = call.ConnectionsLimit(*params.ConnectionsLimit)}
if params.ConnectionsCursor != nil {call = call.ConnectionsCursor(*params.ConnectionsCursor)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetWorktreeOptionsParams struct {Name *string;Branch *string}
func (r *WorkspacesResource) GetWorktreeOptions(ctx context.Context, workspaceId string, params *GetWorktreeOptionsParams, options ...RequestOption) (*WorktreeOptions, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &GetWorktreeOptionsParams{}}
        call := r.client.WorkspacesAPI.GetWorktreeOptions(ctx, workspaceId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Name != nil {call = call.Name(*params.Name)}
if params.Branch != nil {call = call.Branch(*params.Branch)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListWorkspacesParams struct {Cursor *string;Limit *int32;Query *string;Archived *bool}
func (r *WorkspacesResource) List(ctx context.Context, params *ListWorkspacesParams, options ...RequestOption) (*ListWorkspaces200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListWorkspacesParams{}}
        call := r.client.WorkspacesAPI.ListWorkspaces(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.Query != nil {call = call.Query(*params.Query)}
if params.Archived != nil {call = call.Archived(*params.Archived)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListWorktreesParams struct {Cursor *string;Limit *int32}
func (r *WorkspacesResource) ListWorktrees(ctx context.Context, workspaceId string, params *ListWorktreesParams, options ...RequestOption) (*ListWorktrees200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListWorktreesParams{}}
        call := r.client.WorkspacesAPI.ListWorktrees(ctx, workspaceId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WorkspacesResource) ScheduleDeletion(ctx context.Context, workspaceId string, input *WorkspaceDeletion, options ...RequestOption) (*Workspace, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorkspacesAPI.ScheduleWorkspaceDeletion(ctx, workspaceId)
        if input != nil {call = call.WorkspaceDeletion(*input)}
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
type WorktreesResource struct {client *APIClient}
func (r *WorktreesResource) CreateCheckpoint(ctx context.Context, worktreeId string, input *CheckpointCreate, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorktreesAPI.CreateCheckpoint(ctx, worktreeId)
        if input != nil {call = call.CheckpointCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type CreateFolderParams struct {IfMatch string}
func (r *WorktreesResource) CreateFolder(ctx context.Context, worktreeId string, input *FolderCreate, params *CreateFolderParams, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorktreesAPI.CreateFolder(ctx, worktreeId)
        if input != nil {call = call.FolderCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorktreesResource) CreateTransfer(ctx context.Context, worktreeId string, input *TransferCreate, options ...RequestOption) (*Transfer, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorktreesAPI.CreateTransfer(ctx, worktreeId)
        if input != nil {call = call.TransferCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type DeleteFileParams struct {Path string;IfMatch string}
func (r *WorktreesResource) DeleteFile(ctx context.Context, worktreeId string, params *DeleteFileParams, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}

        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorktreesAPI.DeleteFile(ctx, worktreeId)

        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorktreesResource) Delete(ctx context.Context, worktreeId string, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.WorktreesAPI.DeleteWorktree(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type DuplicateFileParams struct {IfMatch string}
func (r *WorktreesResource) DuplicateFile(ctx context.Context, worktreeId string, input *FileDuplicate, params *DuplicateFileParams, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorktreesAPI.DuplicateFile(ctx, worktreeId)
        if input != nil {call = call.FileDuplicate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorktreesResource) GetSync(ctx context.Context, worktreeId string, options ...RequestOption) (*GitSync, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.WorktreesAPI.GetSync(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WorktreesResource) Get(ctx context.Context, worktreeId string, options ...RequestOption) (*Worktree, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.WorktreesAPI.GetWorktree(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type GetWorktreeDiffParams struct {BaseCheckpointId *string;Path *string;Cursor *string;Limit *int32}
func (r *WorktreesResource) GetDiff(ctx context.Context, worktreeId string, params *GetWorktreeDiffParams, options ...RequestOption) (*WorktreeDiff, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &GetWorktreeDiffParams{}}
        call := r.client.WorktreesAPI.GetWorktreeDiff(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.BaseCheckpointId != nil {call = call.BaseCheckpointId(*params.BaseCheckpointId)}
if params.Path != nil {call = call.Path(*params.Path)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListCheckpointsParams struct {Cursor *string;Limit *int32}
func (r *WorktreesResource) ListCheckpoints(ctx context.Context, worktreeId string, params *ListCheckpointsParams, options ...RequestOption) (*ListCheckpoints200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListCheckpointsParams{}}
        call := r.client.WorktreesAPI.ListCheckpoints(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListFilesParams struct {Path *string;Cursor *string;Limit *int32;Query *string;Recursive *bool}
func (r *WorktreesResource) ListFiles(ctx context.Context, worktreeId string, params *ListFilesParams, options ...RequestOption) (*FileListing, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListFilesParams{}}
        call := r.client.WorktreesAPI.ListFiles(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Path != nil {call = call.Path(*params.Path)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.Query != nil {call = call.Query(*params.Query)}
if params.Recursive != nil {call = call.Recursive(*params.Recursive)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListTransfersParams struct {Cursor *string;Limit *int32}
func (r *WorktreesResource) ListTransfers(ctx context.Context, worktreeId string, params *ListTransfersParams, options ...RequestOption) (*ListTransfers200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListTransfersParams{}}
        call := r.client.WorktreesAPI.ListTransfers(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ReadFileParams struct {Path string;Download *bool}
func (r *WorktreesResource) ReadFile(ctx context.Context, worktreeId string, params *ReadFileParams, options ...RequestOption) (*os.File, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorktreesAPI.ReadFile(ctx, worktreeId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
if params.Download != nil {call = call.Download(*params.Download)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type RenameFileParams struct {Path string;IfMatch string}
func (r *WorktreesResource) RenameFile(ctx context.Context, worktreeId string, input *FileRename, params *RenameFileParams, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorktreesAPI.RenameFile(ctx, worktreeId)
        if input != nil {call = call.FileRename(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorktreesResource) Restore(ctx context.Context, worktreeId string, input *RestoreRequest, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorktreesAPI.RestoreWorktree(ctx, worktreeId)
        if input != nil {call = call.RestoreRequest(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorktreesResource) Sync(ctx context.Context, worktreeId string, input *SyncWorktreeRequest, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.WorktreesAPI.SyncWorktree(ctx, worktreeId)
        if input != nil {call = call.SyncWorktreeRequest(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorktreesResource) Update(ctx context.Context, worktreeId string, input *WorktreePatch, options ...RequestOption) (*Worktree, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorktreesAPI.UpdateWorktree(ctx, worktreeId)
        if input != nil {call = call.WorktreePatch(*input)}

        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type WriteFileParams struct {Path string;IfMatch string;CreateOnly *bool}
func (r *WorktreesResource) WriteFile(ctx context.Context, worktreeId string, content *os.File, params *WriteFileParams, options ...RequestOption) (*Operation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if content == nil {return nil, missingParameter("content")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.WorktreesAPI.WriteFile(ctx, worktreeId)
        if content != nil {call = call.Body(content)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
call = call.IfMatch(params.IfMatch)
if params.CreateOnly != nil {call = call.CreateOnly(*params.CreateOnly)}
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
type GetAgentParams struct {IncludeConnections *bool;WorkspaceId *string;ConnectionsLimit *int32;ConnectionsCursor *string}
func (r *AgentsResource) Get(ctx context.Context, agentId string, params *GetAgentParams, options ...RequestOption) (*Agent, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &GetAgentParams{}}
        call := r.client.AgentsAPI.GetAgent(ctx, agentId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.IncludeConnections != nil {call = call.IncludeConnections(*params.IncludeConnections)}
if params.WorkspaceId != nil {call = call.WorkspaceId(*params.WorkspaceId)}
if params.ConnectionsLimit != nil {call = call.ConnectionsLimit(*params.ConnectionsLimit)}
if params.ConnectionsCursor != nil {call = call.ConnectionsCursor(*params.ConnectionsCursor)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListAgentsParams struct {Cursor *string;Limit *int32;Query *string}
func (r *AgentsResource) List(ctx context.Context, params *ListAgentsParams, options ...RequestOption) (*ListAgents200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListAgentsParams{}}
        call := r.client.AgentsAPI.ListAgents(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.Query != nil {call = call.Query(*params.Query)}
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
func (r *SessionsResource) ContinueRun(ctx context.Context, sessionId string, input *MessageCreate, options ...RequestOption) (*NativeRunAccepted, error) {
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
type ListSessionsParams struct {Cursor *string;Limit *int32;WorktreeId *string}
func (r *SessionsResource) List(ctx context.Context, params *ListSessionsParams, options ...RequestOption) (*ListSessions200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListSessionsParams{}}
        call := r.client.SessionsAPI.ListSessions(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.WorktreeId != nil {call = call.WorktreeId(*params.WorktreeId)}
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
func (r *RunsResource) Create(ctx context.Context, input *RunCreate, options ...RequestOption) (*NativeRunAccepted, error) {
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
type ListRunsParams struct {Status *string;WorkspaceId *string;From *time.Time;To *time.Time;Cursor *string;Limit *int32;WorktreeId *string;SessionId *string;WorkerId *string}
func (r *RunsResource) List(ctx context.Context, params *ListRunsParams, options ...RequestOption) (*ListRuns200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListRunsParams{}}
        call := r.client.RunsAPI.ListRuns(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Status != nil {call = call.Status(*params.Status)}
if params.WorkspaceId != nil {call = call.WorkspaceId(*params.WorkspaceId)}
if params.From != nil {call = call.From(*params.From)}
if params.To != nil {call = call.To(*params.To)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.WorktreeId != nil {call = call.WorktreeId(*params.WorktreeId)}
if params.SessionId != nil {call = call.SessionId(*params.SessionId)}
if params.WorkerId != nil {call = call.WorkerId(*params.WorkerId)}
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
func (r *ArtifactsResource) Delete(ctx context.Context, artifactId string, options ...RequestOption) error {
        settings, err := requestOptions(options, true); if err != nil {return err}


        call := r.client.ArtifactsAPI.DeleteArtifact(ctx, artifactId)

        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        response, callError := call.Execute()
        return requestError(callError, response, settings.idempotencyKey)
      }
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
type CreateConnectionAccessRuleParams struct {IfMatch string}
func (r *ConnectionsResource) CreateAccessRule(ctx context.Context, connectionId string, input *ConnectionAccessRuleInput, params *CreateConnectionAccessRuleParams, options ...RequestOption) (*ConnectionAccessRuleMutation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.ConnectionsAPI.CreateConnectionAccessRule(ctx, connectionId)
        if input != nil {call = call.ConnectionAccessRuleInput(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.IfMatch(params.IfMatch)
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
type DeleteConnectionAccessRuleParams struct {IfMatch string}
func (r *ConnectionsResource) DeleteAccessRule(ctx context.Context, connectionId string, ruleId string, params *DeleteConnectionAccessRuleParams, options ...RequestOption) (*ConnectionAccessRuleDeleted, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}

        if params == nil {return nil, missingParameter("params")}
        call := r.client.ConnectionsAPI.DeleteConnectionAccessRule(ctx, connectionId, ruleId)

        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *ConnectionsResource) Get(ctx context.Context, connectionId string, options ...RequestOption) (*Connection, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.ConnectionsAPI.GetConnection(ctx, connectionId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *ConnectionsResource) GetAccess(ctx context.Context, connectionId string, options ...RequestOption) (*ConnectionAccess, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.ConnectionsAPI.GetConnectionAccess(ctx, connectionId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListConnectionAccessRulesParams struct {Cursor *string;Limit *int32;WorkspaceId *string;AgentId *string;Sort *string;Direction *string}
func (r *ConnectionsResource) ListAccessRules(ctx context.Context, connectionId string, params *ListConnectionAccessRulesParams, options ...RequestOption) (*ConnectionAccessRulePage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListConnectionAccessRulesParams{}}
        call := r.client.ConnectionsAPI.ListConnectionAccessRules(ctx, connectionId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.WorkspaceId != nil {call = call.WorkspaceId(*params.WorkspaceId)}
if params.AgentId != nil {call = call.AgentId(*params.AgentId)}
if params.Sort != nil {call = call.Sort(*params.Sort)}
if params.Direction != nil {call = call.Direction(*params.Direction)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListConnectionsParams struct {Cursor *string;Limit *int32;WorkspaceId *string;AgentId *string}
func (r *ConnectionsResource) List(ctx context.Context, params *ListConnectionsParams, options ...RequestOption) (*ContextualConnectionPage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListConnectionsParams{}}
        call := r.client.ConnectionsAPI.ListConnections(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.WorkspaceId != nil {call = call.WorkspaceId(*params.WorkspaceId)}
if params.AgentId != nil {call = call.AgentId(*params.AgentId)}
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
type ResolveConnectionAccessParams struct {Cursor *string;Limit *int32}
func (r *ConnectionsResource) ResolveAccess(ctx context.Context, input *ConnectionAccessResolve, params *ResolveConnectionAccessParams, options ...RequestOption) (*ConnectionAccessResolutionPage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {params = &ResolveConnectionAccessParams{}}
        call := r.client.ConnectionsAPI.ResolveConnectionAccess(ctx)
        if input != nil {call = call.ConnectionAccessResolve(*input)}

        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
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
type UpdateConnectionAccessParams struct {IfMatch string}
func (r *ConnectionsResource) UpdateAccess(ctx context.Context, connectionId string, input *ConnectionAccessPatch, params *UpdateConnectionAccessParams, options ...RequestOption) (*ConnectionAccess, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.ConnectionsAPI.UpdateConnectionAccess(ctx, connectionId)
        if input != nil {call = call.ConnectionAccessPatch(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type UpdateConnectionAccessRuleParams struct {IfMatch string}
func (r *ConnectionsResource) UpdateAccessRule(ctx context.Context, connectionId string, ruleId string, input *ConnectionAccessRuleInput, params *UpdateConnectionAccessRuleParams, options ...RequestOption) (*ConnectionAccessRuleMutation, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.ConnectionsAPI.UpdateConnectionAccessRule(ctx, connectionId, ruleId)
        if input != nil {call = call.ConnectionAccessRuleInput(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
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
type ListBillingUsageParams struct {From time.Time;To time.Time;WorkspaceId *string;WorktreeId *string;RunId *string;SessionId *string;CustomerId *string;AgentKey *string;Provider *string;Model *string;Kind *string;BillingMode *string;Cursor *string;Limit *int32;WorkerId *string}
func (r *BillingResource) ListUsage(ctx context.Context, params *ListBillingUsageParams, options ...RequestOption) (*BillingUsagePage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {return nil, missingParameter("params")}
        call := r.client.BillingAPI.ListBillingUsage(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.From(params.From)
call = call.To(params.To)
if params.WorkspaceId != nil {call = call.WorkspaceId(*params.WorkspaceId)}
if params.WorktreeId != nil {call = call.WorktreeId(*params.WorktreeId)}
if params.RunId != nil {call = call.RunId(*params.RunId)}
if params.SessionId != nil {call = call.SessionId(*params.SessionId)}
if params.CustomerId != nil {call = call.CustomerId(*params.CustomerId)}
if params.AgentKey != nil {call = call.AgentKey(*params.AgentKey)}
if params.Provider != nil {call = call.Provider(*params.Provider)}
if params.Model != nil {call = call.Model(*params.Model)}
if params.Kind != nil {call = call.Kind(*params.Kind)}
if params.BillingMode != nil {call = call.BillingMode(*params.BillingMode)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
if params.WorkerId != nil {call = call.WorkerId(*params.WorkerId)}
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
func (r *IntegrationsResource) DisconnectGithub(ctx context.Context, workspaceId string, options ...RequestOption) (*Workspace, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.IntegrationsAPI.DisconnectGithub(ctx, workspaceId)

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
type CustomerAgentsResource struct {client *APIClient}
func (r *CustomerAgentsResource) AuthorizeConnection(ctx context.Context, customerId string, customerAgentId string, connectionId string, input *CustomerConnectionAuthorize, options ...RequestOption) (*CustomerConnectionAuthorization, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.CustomerAgentsAPI.AuthorizeCustomerAgentConnection(ctx, customerId, customerAgentId, connectionId)
        if input != nil {call = call.CustomerConnectionAuthorize(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *CustomerAgentsResource) CancelRun(ctx context.Context, customerId string, customerAgentId string, runId string, options ...RequestOption) (*Run, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.CustomerAgentsAPI.CancelCustomerAgentRun(ctx, customerId, customerAgentId, runId)
        call = call.Body(map[string]interface{}{})
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *CustomerAgentsResource) CompleteConnection(ctx context.Context, customerId string, customerAgentId string, connectionId string, input *CustomerConnectionComplete, options ...RequestOption) (*CustomerAgentConnection, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.CustomerAgentsAPI.CompleteCustomerAgentConnection(ctx, customerId, customerAgentId, connectionId)
        if input != nil {call = call.CustomerConnectionComplete(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *CustomerAgentsResource) CreateConnection(ctx context.Context, customerId string, customerAgentId string, input *CustomerAgentConnectionCreate, options ...RequestOption) (*CustomerAgentConnection, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.CustomerAgentsAPI.CreateCustomerAgentConnection(ctx, customerId, customerAgentId)
        if input != nil {call = call.CustomerAgentConnectionCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *CustomerAgentsResource) DeleteConnection(ctx context.Context, customerId string, customerAgentId string, connectionId string, options ...RequestOption) error {
        settings, err := requestOptions(options, false); if err != nil {return err}


        call := r.client.CustomerAgentsAPI.DeleteCustomerAgentConnection(ctx, customerId, customerAgentId, connectionId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        response, callError := call.Execute()
        return requestError(callError, response, "")
      }
func (r *CustomerAgentsResource) Ensure(ctx context.Context, customerId string, input *CustomerAgentEnsure, options ...RequestOption) (*CustomerAgentBinding, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.CustomerAgentsAPI.EnsureCustomerAgent(ctx, customerId)
        if input != nil {call = call.CustomerAgentEnsure(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *CustomerAgentsResource) Get(ctx context.Context, customerId string, customerAgentId string, options ...RequestOption) (*CustomerAgentBinding, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.CustomerAgentsAPI.GetCustomerAgent(ctx, customerId, customerAgentId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *CustomerAgentsResource) GetRun(ctx context.Context, customerId string, customerAgentId string, runId string, options ...RequestOption) (*Run, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.CustomerAgentsAPI.GetCustomerAgentRun(ctx, customerId, customerAgentId, runId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *CustomerAgentsResource) GetRunResult(ctx context.Context, customerId string, customerAgentId string, runId string, options ...RequestOption) (*RunResult, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.CustomerAgentsAPI.GetCustomerAgentRunResult(ctx, customerId, customerAgentId, runId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListCustomerAgentConnectionsParams struct {Cursor *string;Limit *int32}
func (r *CustomerAgentsResource) ListConnections(ctx context.Context, customerId string, customerAgentId string, params *ListCustomerAgentConnectionsParams, options ...RequestOption) (*CustomerAgentConnectionPage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListCustomerAgentConnectionsParams{}}
        call := r.client.CustomerAgentsAPI.ListCustomerAgentConnections(ctx, customerId, customerAgentId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListCustomerAgentConversationsParams struct {Cursor *string;Limit *int32}
func (r *CustomerAgentsResource) ListConversations(ctx context.Context, customerId string, customerAgentId string, params *ListCustomerAgentConversationsParams, options ...RequestOption) (*ListSessions200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListCustomerAgentConversationsParams{}}
        call := r.client.CustomerAgentsAPI.ListCustomerAgentConversations(ctx, customerId, customerAgentId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListCustomerAgentFilesParams struct {Path *string;Query *string;Recursive *bool;Cursor *string;Limit *int32}
func (r *CustomerAgentsResource) ListFiles(ctx context.Context, customerId string, customerAgentId string, params *ListCustomerAgentFilesParams, options ...RequestOption) (*FileListing, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListCustomerAgentFilesParams{}}
        call := r.client.CustomerAgentsAPI.ListCustomerAgentFiles(ctx, customerId, customerAgentId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Path != nil {call = call.Path(*params.Path)}
if params.Query != nil {call = call.Query(*params.Query)}
if params.Recursive != nil {call = call.Recursive(*params.Recursive)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListCustomerAgentRunEventsParams struct {After *string;Cursor *string;Limit *int32}
func (r *CustomerAgentsResource) ListRunEvents(ctx context.Context, customerId string, customerAgentId string, runId string, params *ListCustomerAgentRunEventsParams, options ...RequestOption) (*ListRunEvents200Response, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListCustomerAgentRunEventsParams{}}
        call := r.client.CustomerAgentsAPI.ListCustomerAgentRunEvents(ctx, customerId, customerAgentId, runId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.After != nil {call = call.After(*params.After)}
if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListCustomerAgentsParams struct {Cursor *string;Limit *int32}
func (r *CustomerAgentsResource) List(ctx context.Context, customerId string, params *ListCustomerAgentsParams, options ...RequestOption) (*CustomerAgentPage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListCustomerAgentsParams{}}
        call := r.client.CustomerAgentsAPI.ListCustomerAgents(ctx, customerId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ReadCustomerAgentFileParams struct {Path string;Download *bool}
func (r *CustomerAgentsResource) ReadFile(ctx context.Context, customerId string, customerAgentId string, params *ReadCustomerAgentFileParams, options ...RequestOption) (*os.File, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {return nil, missingParameter("params")}
        call := r.client.CustomerAgentsAPI.ReadCustomerAgentFile(ctx, customerId, customerAgentId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.Path(params.Path)
if params.Download != nil {call = call.Download(*params.Download)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *CustomerAgentsResource) SendMessage(ctx context.Context, customerId string, customerAgentId string, input *CustomerAgentMessage, options ...RequestOption) (*NativeRunAccepted, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.CustomerAgentsAPI.SendCustomerAgentMessage(ctx, customerId, customerAgentId)
        if input != nil {call = call.CustomerAgentMessage(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *CustomerAgentsResource) StreamRun(ctx context.Context, customerID, customerAgentID, runID, after string, receive func(Event) error, options ...RequestOption) error { return r.client.streamTarget(ctx,runID,after,customerID,customerAgentID,receive,options...) }
type UpdateCustomerAgentConnectionPermissionsParams struct {IfMatch string}
func (r *CustomerAgentsResource) UpdateConnectionPermissions(ctx context.Context, customerId string, customerAgentId string, connectionId string, input *CustomerAgentConnectionPermissions, params *UpdateCustomerAgentConnectionPermissionsParams, options ...RequestOption) (*CustomerAgentConnection, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {return nil, missingParameter("params")}
        call := r.client.CustomerAgentsAPI.UpdateCustomerAgentConnectionPermissions(ctx, customerId, customerAgentId, connectionId)
        if input != nil {call = call.CustomerAgentConnectionPermissions(*input)}

        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        call = call.IfMatch(params.IfMatch)
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type InferencesResource struct {client *APIClient}
func (r *InferencesResource) CreateBoundedAgentRun(ctx context.Context, input *BoundedAgentCreate, options ...RequestOption) (*RunAccepted, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.InferencesAPI.CreateBoundedAgentRun(ctx)
        if input != nil {call = call.BoundedAgentCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *InferencesResource) CreateContextArtifact(ctx context.Context, input *ContextArtifactCreate, options ...RequestOption) (*ContextArtifact, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.InferencesAPI.CreateContextArtifact(ctx)
        if input != nil {call = call.ContextArtifactCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)


        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *InferencesResource) CreateDecisionDefinition(ctx context.Context, input *DecisionDefinitionCreate, options ...RequestOption) (*DecisionDefinition, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.InferencesAPI.CreateDecisionDefinition(ctx)
        if input != nil {call = call.DecisionDefinitionCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)


        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type CreateInferenceParams struct {Prefer *string}
func (r *InferencesResource) Create(ctx context.Context, input *InferenceCreate, params *CreateInferenceParams, options ...RequestOption) (*InferenceResponse, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}
        if params == nil {params = &CreateInferenceParams{}}
        call := r.client.InferencesAPI.CreateInference(ctx)
        if input != nil {call = call.InferenceCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Prefer != nil {call = call.Prefer(*params.Prefer)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *InferencesResource) DeleteContextArtifact(ctx context.Context, artifactId string, options ...RequestOption) (*ContextArtifact, error) {



        call := r.client.InferencesAPI.DeleteContextArtifact(ctx, artifactId)




        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *InferencesResource) DeleteDecisionDefinition(ctx context.Context, definitionId string, options ...RequestOption) (*DecisionDefinition, error) {



        call := r.client.InferencesAPI.DeleteDecisionDefinition(ctx, definitionId)




        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *InferencesResource) GetContextArtifact(ctx context.Context, artifactId string, options ...RequestOption) (*ContextArtifact, error) {



        call := r.client.InferencesAPI.GetContextArtifact(ctx, artifactId)




        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *InferencesResource) GetDecisionDefinition(ctx context.Context, definitionId string, options ...RequestOption) (*DecisionDefinition, error) {



        call := r.client.InferencesAPI.GetDecisionDefinition(ctx, definitionId)




        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type TasksResource struct {client *APIClient}
func (r *TasksResource) CloseDecision(ctx context.Context, taskId string, options ...RequestOption) (*DecisionTask, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.TasksAPI.CloseDecisionTask(ctx, taskId)

        call = call.IdempotencyKey(settings.idempotencyKey)


        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TasksResource) CreateDecision(ctx context.Context, input *DecisionTaskCreate, options ...RequestOption) (*DecisionTask, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.TasksAPI.CreateDecisionTask(ctx)
        if input != nil {call = call.DecisionTaskCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)


        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TasksResource) GetDecision(ctx context.Context, taskId string, options ...RequestOption) (*DecisionTask, error) {



        call := r.client.TasksAPI.GetDecisionTask(ctx, taskId)




        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *TasksResource) RecordOutcome(ctx context.Context, taskId string, input *ApplicationOutcome, options ...RequestOption) (*DecisionTask, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.TasksAPI.RecordTaskOutcome(ctx, taskId)
        if input != nil {call = call.ApplicationOutcome(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)


        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *TasksResource) WakeDecision(ctx context.Context, taskId string, input *DecisionTaskWake, options ...RequestOption) (*DecisionTask, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.TasksAPI.WakeDecisionTask(ctx, taskId)
        if input != nil {call = call.DecisionTaskWake(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)


        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
type WorkersResource struct {client *APIClient}
func (r *WorkersResource) Create(ctx context.Context, input *WorkerCreate, options ...RequestOption) (*Worker, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorkersAPI.CreateWorker(ctx)
        if input != nil {call = call.WorkerCreate(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkersResource) Destroy(ctx context.Context, workerId string, input *WorkerAction, options ...RequestOption) (*Worker, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.WorkersAPI.DestroyWorker(ctx, workerId)
        if input != nil {call = call.WorkerAction(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkersResource) Get(ctx context.Context, workerId string, options ...RequestOption) (*Worker, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.WorkersAPI.GetWorker(ctx, workerId)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WorkersResource) ListOfferings(ctx context.Context, options ...RequestOption) (*WorkerOfferings, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}


        call := r.client.WorkersAPI.ListWorkerOfferings(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
type ListWorkersParams struct {Cursor *string;Limit *int32}
func (r *WorkersResource) List(ctx context.Context, params *ListWorkersParams, options ...RequestOption) (*WorkerPage, error) {
        settings, err := requestOptions(options, false); if err != nil {return nil, err}

        if params == nil {params = &ListWorkersParams{}}
        call := r.client.WorkersAPI.ListWorkers(ctx)


        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}
        if params.Cursor != nil {call = call.Cursor(*params.Cursor)}
if params.Limit != nil {call = call.Limit(*params.Limit)}
        result, response, callError := call.Execute()
        return result, requestError(callError, response, "")
      }
func (r *WorkersResource) Patch(ctx context.Context, workerId string, input *WorkerPatch, options ...RequestOption) (*Worker, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}
        if input == nil {return nil, missingParameter("input")}

        call := r.client.WorkersAPI.PatchWorker(ctx, workerId)
        if input != nil {call = call.WorkerPatch(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkersResource) Pause(ctx context.Context, workerId string, input *WorkerAction, options ...RequestOption) (*Worker, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.WorkersAPI.PauseWorker(ctx, workerId)
        if input != nil {call = call.WorkerAction(*input)}
        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
func (r *WorkersResource) Resume(ctx context.Context, workerId string, options ...RequestOption) (*Worker, error) {
        settings, err := requestOptions(options, true); if err != nil {return nil, err}


        call := r.client.WorkersAPI.ResumeWorker(ctx, workerId)

        call = call.IdempotencyKey(settings.idempotencyKey)
        if settings.organization != "" {call = call.XOrganizationId(settings.organization)}

        result, response, callError := call.Execute()
        return result, requestError(callError, response, settings.idempotencyKey)
      }
