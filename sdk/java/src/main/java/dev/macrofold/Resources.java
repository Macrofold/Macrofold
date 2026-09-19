// Generated from OpenAPI by pnpm sdk:generate:all. Do not edit.
package dev.macrofold;
import dev.macrofold.api.*;
import dev.macrofold.model.*;
import java.io.*;
import java.time.*;
import java.util.*;
import java.util.function.Predicate;
public abstract class Resources extends ApiClient {
  public static final String DEFAULT_ORIGIN = "https://app.macrofold.ai";
  protected Resources(java.net.http.HttpClient.Builder http, com.fasterxml.jackson.databind.ObjectMapper mapper, String origin) {super(http,mapper,origin);}
  public abstract void stream(UUID runId,String after,Predicate<Event> receive) throws IOException,InterruptedException,ApiException;
  protected abstract void streamInOrganization(UUID runId,String after,UUID organization,Predicate<Event> receive) throws IOException,InterruptedException,ApiException;
  protected abstract void streamCustomerInOrganization(String customerId,UUID customerAgentId,UUID runId,String after,UUID organization,Predicate<Event> receive) throws IOException,InterruptedException,ApiException;
  public WorkspacesResource workspaces(){return new WorkspacesResource(this,RequestOptions.defaults());}
public WorktreesResource worktrees(){return new WorktreesResource(this,RequestOptions.defaults());}
public AgentsResource agents(){return new AgentsResource(this,RequestOptions.defaults());}
public SessionsResource sessions(){return new SessionsResource(this,RequestOptions.defaults());}
public RunsResource runs(){return new RunsResource(this,RequestOptions.defaults());}
public ArtifactsResource artifacts(){return new ArtifactsResource(this,RequestOptions.defaults());}
public ConnectionsResource connections(){return new ConnectionsResource(this,RequestOptions.defaults());}
public ApiKeysResource apiKeys(){return new ApiKeysResource(this,RequestOptions.defaults());}
public WebhookEndpointsResource webhookEndpoints(){return new WebhookEndpointsResource(this,RequestOptions.defaults());}
public WebhookDeliveriesResource webhookDeliveries(){return new WebhookDeliveriesResource(this,RequestOptions.defaults());}
public UsageResource usage(){return new UsageResource(this,RequestOptions.defaults());}
public RequestsResource requests(){return new RequestsResource(this,RequestOptions.defaults());}
public BillingResource billing(){return new BillingResource(this,RequestOptions.defaults());}
public HarnessesResource harnesses(){return new HarnessesResource(this,RequestOptions.defaults());}
public ModelsResource models(){return new ModelsResource(this,RequestOptions.defaults());}
public OperationsResource operations(){return new OperationsResource(this,RequestOptions.defaults());}
public OperatorResource operator(){return new OperatorResource(this,RequestOptions.defaults());}
public CheckpointsResource checkpoints(){return new CheckpointsResource(this,RequestOptions.defaults());}
public MeResource me(){return new MeResource(this,RequestOptions.defaults());}
public TransfersResource transfers(){return new TransfersResource(this,RequestOptions.defaults());}
public IntegrationsResource integrations(){return new IntegrationsResource(this,RequestOptions.defaults());}
public OrganizationsResource organizations(){return new OrganizationsResource(this,RequestOptions.defaults());}
public TriggersResource triggers(){return new TriggersResource(this,RequestOptions.defaults());}
public SlackConnectionsResource slackConnections(){return new SlackConnectionsResource(this,RequestOptions.defaults());}
public CustomerAgentsResource customerAgents(){return new CustomerAgentsResource(this,RequestOptions.defaults());}
public InferencesResource inferences(){return new InferencesResource(this,RequestOptions.defaults());}
public TasksResource tasks(){return new TasksResource(this,RequestOptions.defaults());}
public SandboxesResource sandboxes(){return new SandboxesResource(this,RequestOptions.defaults());}

public static final class GetWorkspaceParams {
        private Boolean includeConnections;
private UUID agentId;
private Integer connectionsLimit;
private String connectionsCursor;
        public GetWorkspaceParams(){}
        public GetWorkspaceParams includeConnections(Boolean value){this.includeConnections=value;return this;}
public GetWorkspaceParams agentId(UUID value){this.agentId=value;return this;}
public GetWorkspaceParams connectionsLimit(Integer value){this.connectionsLimit=value;return this;}
public GetWorkspaceParams connectionsCursor(String value){this.connectionsCursor=value;return this;}
      }
public static final class GetWorktreeOptionsParams {
        private String name;
private String branch;
        public GetWorktreeOptionsParams(){}
        public GetWorktreeOptionsParams name(String value){this.name=value;return this;}
public GetWorktreeOptionsParams branch(String value){this.branch=value;return this;}
      }
public static final class ListWorkspacesParams {
        private String cursor;
private Integer limit;
private String query;
private Boolean archived;
        public ListWorkspacesParams(){}
        public ListWorkspacesParams cursor(String value){this.cursor=value;return this;}
public ListWorkspacesParams limit(Integer value){this.limit=value;return this;}
public ListWorkspacesParams query(String value){this.query=value;return this;}
public ListWorkspacesParams archived(Boolean value){this.archived=value;return this;}
      }
public static final class ListWorktreesParams {
        private String cursor;
private Integer limit;
        public ListWorktreesParams(){}
        public ListWorktreesParams cursor(String value){this.cursor=value;return this;}
public ListWorktreesParams limit(Integer value){this.limit=value;return this;}
      }
public static final class WorkspacesResource {
      private final Resources client; private final RequestOptions options;
      private WorkspacesResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public WorkspacesResource withOptions(RequestOptions options){return new WorkspacesResource(client,Objects.requireNonNull(options));}
      public Workspace cancelDeletion(UUID workspaceId) throws ApiException {
        String key=options.identity();

        try {return new WorkspacesApi(client).cancelWorkspaceDeletion(key,workspaceId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Workspace create(WorkspaceCreate input) throws ApiException {
        String key=options.identity();

        try {return new WorkspacesApi(client).createWorkspace(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Operation createWorktree(UUID workspaceId,WorktreeCreate input) throws ApiException {
        String key=options.identity();

        try {return new WorkspacesApi(client).createWorktree(workspaceId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Operation delete(UUID workspaceId) throws ApiException {


        try {return new WorkspacesApi(client).deleteWorkspace(workspaceId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Workspace get(UUID workspaceId) throws ApiException {
        return get(workspaceId,new GetWorkspaceParams());
      }
public Workspace get(UUID workspaceId,GetWorkspaceParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorkspacesApi(client).getWorkspace(workspaceId,options.organization(),params.includeConnections,params.agentId,params.connectionsLimit,params.connectionsCursor);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public WorktreeOptions getWorktreeOptions(UUID workspaceId) throws ApiException {
        return getWorktreeOptions(workspaceId,new GetWorktreeOptionsParams());
      }
public WorktreeOptions getWorktreeOptions(UUID workspaceId,GetWorktreeOptionsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorkspacesApi(client).getWorktreeOptions(workspaceId,options.organization(),params.name,params.branch);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListWorkspaces200Response list() throws ApiException {
        return list(new ListWorkspacesParams());
      }
public ListWorkspaces200Response list(ListWorkspacesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorkspacesApi(client).listWorkspaces(params.cursor,params.limit,options.organization(),params.query,params.archived);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListWorktrees200Response listWorktrees(UUID workspaceId) throws ApiException {
        return listWorktrees(workspaceId,new ListWorktreesParams());
      }
public ListWorktrees200Response listWorktrees(UUID workspaceId,ListWorktreesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorkspacesApi(client).listWorktrees(workspaceId,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Workspace scheduleDeletion(UUID workspaceId,WorkspaceDeletion input) throws ApiException {
        String key=options.identity();

        try {return new WorkspacesApi(client).scheduleWorkspaceDeletion(key,workspaceId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Workspace update(UUID workspaceId,WorkspacePatch input) throws ApiException {


        try {return new WorkspacesApi(client).updateWorkspace(workspaceId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class CreateFolderParams {
        private String ifMatch;
        public CreateFolderParams(String ifMatch){this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public CreateFolderParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class DeleteFileParams {
        private String path;
private String ifMatch;
        public DeleteFileParams(String path,String ifMatch){this.path=Objects.requireNonNull(path,"path");this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public DeleteFileParams path(String value){this.path=value;return this;}
public DeleteFileParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class DuplicateFileParams {
        private String ifMatch;
        public DuplicateFileParams(String ifMatch){this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public DuplicateFileParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class GetWorktreeDiffParams {
        private UUID baseCheckpointId;
private String path;
private String cursor;
private Integer limit;
        public GetWorktreeDiffParams(){}
        public GetWorktreeDiffParams baseCheckpointId(UUID value){this.baseCheckpointId=value;return this;}
public GetWorktreeDiffParams path(String value){this.path=value;return this;}
public GetWorktreeDiffParams cursor(String value){this.cursor=value;return this;}
public GetWorktreeDiffParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListCheckpointsParams {
        private String cursor;
private Integer limit;
        public ListCheckpointsParams(){}
        public ListCheckpointsParams cursor(String value){this.cursor=value;return this;}
public ListCheckpointsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListFilesParams {
        private String path;
private String cursor;
private Integer limit;
private String query;
private Boolean recursive;
        public ListFilesParams(){}
        public ListFilesParams path(String value){this.path=value;return this;}
public ListFilesParams cursor(String value){this.cursor=value;return this;}
public ListFilesParams limit(Integer value){this.limit=value;return this;}
public ListFilesParams query(String value){this.query=value;return this;}
public ListFilesParams recursive(Boolean value){this.recursive=value;return this;}
      }
public static final class ListTransfersParams {
        private String cursor;
private Integer limit;
        public ListTransfersParams(){}
        public ListTransfersParams cursor(String value){this.cursor=value;return this;}
public ListTransfersParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ReadFileParams {
        private String path;
private Boolean download;
        public ReadFileParams(String path){this.path=Objects.requireNonNull(path,"path");}
        public ReadFileParams path(String value){this.path=value;return this;}
public ReadFileParams download(Boolean value){this.download=value;return this;}
      }
public static final class RenameFileParams {
        private String path;
private String ifMatch;
        public RenameFileParams(String path,String ifMatch){this.path=Objects.requireNonNull(path,"path");this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public RenameFileParams path(String value){this.path=value;return this;}
public RenameFileParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class WriteFileParams {
        private String path;
private String ifMatch;
private Boolean createOnly;
        public WriteFileParams(String path,String ifMatch){this.path=Objects.requireNonNull(path,"path");this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public WriteFileParams path(String value){this.path=value;return this;}
public WriteFileParams ifMatch(String value){this.ifMatch=value;return this;}
public WriteFileParams createOnly(Boolean value){this.createOnly=value;return this;}
      }
public static final class WorktreesResource {
      private final Resources client; private final RequestOptions options;
      private WorktreesResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public WorktreesResource withOptions(RequestOptions options){return new WorktreesResource(client,Objects.requireNonNull(options));}
      public Operation createCheckpoint(UUID worktreeId,CheckpointCreate input) throws ApiException {
        String key=options.identity();

        try {return new WorktreesApi(client).createCheckpoint(worktreeId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Operation createFolder(UUID worktreeId,FolderCreate input,CreateFolderParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).createFolder(worktreeId,params.ifMatch,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Transfer createTransfer(UUID worktreeId,TransferCreate input) throws ApiException {
        String key=options.identity();

        try {return new WorktreesApi(client).createTransfer(worktreeId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Operation deleteFile(UUID worktreeId,DeleteFileParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).deleteFile(worktreeId,params.path,params.ifMatch,key,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Operation delete(UUID worktreeId) throws ApiException {


        try {return new WorktreesApi(client).deleteWorktree(worktreeId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Operation duplicateFile(UUID worktreeId,FileDuplicate input,DuplicateFileParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).duplicateFile(worktreeId,params.ifMatch,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public GitSync getSync(UUID worktreeId) throws ApiException {


        try {return new WorktreesApi(client).getSync(worktreeId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Worktree get(UUID worktreeId) throws ApiException {


        try {return new WorktreesApi(client).getWorktree(worktreeId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public WorktreeDiff getDiff(UUID worktreeId) throws ApiException {
        return getDiff(worktreeId,new GetWorktreeDiffParams());
      }
public WorktreeDiff getDiff(UUID worktreeId,GetWorktreeDiffParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).getWorktreeDiff(worktreeId,params.baseCheckpointId,params.path,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListCheckpoints200Response listCheckpoints(UUID worktreeId) throws ApiException {
        return listCheckpoints(worktreeId,new ListCheckpointsParams());
      }
public ListCheckpoints200Response listCheckpoints(UUID worktreeId,ListCheckpointsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).listCheckpoints(worktreeId,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public FileListing listFiles(UUID worktreeId) throws ApiException {
        return listFiles(worktreeId,new ListFilesParams());
      }
public FileListing listFiles(UUID worktreeId,ListFilesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).listFiles(worktreeId,params.path,params.cursor,params.limit,options.organization(),params.query,params.recursive);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListTransfers200Response listTransfers(UUID worktreeId) throws ApiException {
        return listTransfers(worktreeId,new ListTransfersParams());
      }
public ListTransfers200Response listTransfers(UUID worktreeId,ListTransfersParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).listTransfers(worktreeId,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public File readFile(UUID worktreeId,ReadFileParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).readFile(worktreeId,params.path,options.organization(),params.download);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Operation renameFile(UUID worktreeId,FileRename input,RenameFileParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).renameFile(worktreeId,params.path,params.ifMatch,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Operation restore(UUID worktreeId,RestoreRequest input) throws ApiException {
        String key=options.identity();

        try {return new WorktreesApi(client).restoreWorktree(worktreeId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Operation sync(UUID worktreeId,SyncWorktreeRequest input) throws ApiException {
        String key=options.identity();

        try {return new WorktreesApi(client).syncWorktree(worktreeId,key,options.organization(),input);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Worktree update(UUID worktreeId,WorktreePatch input) throws ApiException {


        try {return new WorktreesApi(client).updateWorktree(worktreeId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Operation writeFile(UUID worktreeId,File content,WriteFileParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new WorktreesApi(client).writeFile(worktreeId,params.path,params.ifMatch,key,content,options.organization(),params.createOnly);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
public static final class GetAgentParams {
        private Boolean includeConnections;
private UUID workspaceId;
private Integer connectionsLimit;
private String connectionsCursor;
        public GetAgentParams(){}
        public GetAgentParams includeConnections(Boolean value){this.includeConnections=value;return this;}
public GetAgentParams workspaceId(UUID value){this.workspaceId=value;return this;}
public GetAgentParams connectionsLimit(Integer value){this.connectionsLimit=value;return this;}
public GetAgentParams connectionsCursor(String value){this.connectionsCursor=value;return this;}
      }
public static final class ListAgentsParams {
        private String cursor;
private Integer limit;
private String query;
        public ListAgentsParams(){}
        public ListAgentsParams cursor(String value){this.cursor=value;return this;}
public ListAgentsParams limit(Integer value){this.limit=value;return this;}
public ListAgentsParams query(String value){this.query=value;return this;}
      }
public static final class AgentsResource {
      private final Resources client; private final RequestOptions options;
      private AgentsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public AgentsResource withOptions(RequestOptions options){return new AgentsResource(client,Objects.requireNonNull(options));}
      public Agent create(AgentCreate input) throws ApiException {
        String key=options.identity();

        try {return new AgentsApi(client).createAgent(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public void delete(UUID agentId) throws ApiException {


        try {new AgentsApi(client).deleteAgent(agentId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Agent get(UUID agentId) throws ApiException {
        return get(agentId,new GetAgentParams());
      }
public Agent get(UUID agentId,GetAgentParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new AgentsApi(client).getAgent(agentId,options.organization(),params.includeConnections,params.workspaceId,params.connectionsLimit,params.connectionsCursor);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListAgents200Response list() throws ApiException {
        return list(new ListAgentsParams());
      }
public ListAgents200Response list(ListAgentsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new AgentsApi(client).listAgents(params.cursor,params.limit,options.organization(),params.query);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Agent update(UUID agentId,AgentPatch input) throws ApiException {


        try {return new AgentsApi(client).updateAgent(agentId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListSessionsParams {
        private String cursor;
private Integer limit;
private UUID worktreeId;
        public ListSessionsParams(){}
        public ListSessionsParams cursor(String value){this.cursor=value;return this;}
public ListSessionsParams limit(Integer value){this.limit=value;return this;}
public ListSessionsParams worktreeId(UUID value){this.worktreeId=value;return this;}
      }
public static final class SessionsResource {
      private final Resources client; private final RequestOptions options;
      private SessionsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public SessionsResource withOptions(RequestOptions options){return new SessionsResource(client,Objects.requireNonNull(options));}
      public NativeRunAccepted continueRun(UUID sessionId,MessageCreate input) throws ApiException {
        String key=options.identity();

        try {return new SessionsApi(client).continueSession(sessionId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Session create(SessionCreate input) throws ApiException {
        String key=options.identity();

        try {return new SessionsApi(client).createSession(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Session get(UUID sessionId) throws ApiException {


        try {return new SessionsApi(client).getSession(sessionId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListSessions200Response list() throws ApiException {
        return list(new ListSessionsParams());
      }
public ListSessions200Response list(ListSessionsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new SessionsApi(client).listSessions(params.cursor,params.limit,params.worktreeId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListArtifactsParams {
        private String cursor;
private Integer limit;
        public ListArtifactsParams(){}
        public ListArtifactsParams cursor(String value){this.cursor=value;return this;}
public ListArtifactsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListRunEventsParams {
        private String after;
private String cursor;
private Integer limit;
        public ListRunEventsParams(){}
        public ListRunEventsParams after(String value){this.after=value;return this;}
public ListRunEventsParams cursor(String value){this.cursor=value;return this;}
public ListRunEventsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListRunsParams {
        private String status;
private UUID workspaceId;
private OffsetDateTime from;
private OffsetDateTime to;
private String cursor;
private Integer limit;
private UUID worktreeId;
private UUID sessionId;
        public ListRunsParams(){}
        public ListRunsParams status(String value){this.status=value;return this;}
public ListRunsParams workspaceId(UUID value){this.workspaceId=value;return this;}
public ListRunsParams from(OffsetDateTime value){this.from=value;return this;}
public ListRunsParams to(OffsetDateTime value){this.to=value;return this;}
public ListRunsParams cursor(String value){this.cursor=value;return this;}
public ListRunsParams limit(Integer value){this.limit=value;return this;}
public ListRunsParams worktreeId(UUID value){this.worktreeId=value;return this;}
public ListRunsParams sessionId(UUID value){this.sessionId=value;return this;}
      }
public static final class RunsResource {
      private final Resources client; private final RequestOptions options;
      private RunsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public RunsResource withOptions(RequestOptions options){return new RunsResource(client,Objects.requireNonNull(options));}
      public Run cancel(UUID runId) throws ApiException {
        String key=options.identity();

        try {return new RunsApi(client).cancelRun(runId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public NativeRunAccepted create(RunCreate input) throws ApiException {
        String key=options.identity();

        try {return new RunsApi(client).createRun(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Run get(UUID runId) throws ApiException {


        try {return new RunsApi(client).getRun(runId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public RunResult getResult(UUID runId) throws ApiException {


        try {return new RunsApi(client).getRunResult(runId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListArtifacts200Response listArtifacts(UUID runId) throws ApiException {
        return listArtifacts(runId,new ListArtifactsParams());
      }
public ListArtifacts200Response listArtifacts(UUID runId,ListArtifactsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new RunsApi(client).listArtifacts(runId,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListRunEvents200Response listEvents(UUID runId) throws ApiException {
        return listEvents(runId,new ListRunEventsParams());
      }
public ListRunEvents200Response listEvents(UUID runId,ListRunEventsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new RunsApi(client).listRunEvents(runId,params.after,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListRuns200Response list() throws ApiException {
        return list(new ListRunsParams());
      }
public ListRuns200Response list(ListRunsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new RunsApi(client).listRuns(params.status,params.workspaceId,params.from,params.to,params.cursor,params.limit,params.worktreeId,params.sessionId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public void stream(UUID runId,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {stream(runId,"0",receive);}
          public void stream(UUID runId,String after,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {client.streamInOrganization(runId,after,options.organization(),receive);}
          public void events(UUID runId,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {stream(runId,receive);}
          public void events(UUID runId,String after,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {stream(runId,after,receive);}
          public void streamText(UUID runId,Predicate<String> receive) throws IOException,InterruptedException,ApiException,RunFailedException,WaitTimeoutException {streamText(runId,"0",receive);}
          public void streamText(UUID runId,String after,Predicate<String> receive) throws IOException,InterruptedException,ApiException,RunFailedException,WaitTimeoutException {RunHelpers.streamText(this,runId,after,receive);}
          public RunResult wait(UUID runId) throws ApiException,InterruptedException,RunFailedException,WaitTimeoutException {return wait(runId,null);}
          public RunResult wait(UUID runId,Duration timeout) throws ApiException,InterruptedException,RunFailedException,WaitTimeoutException {return RunHelpers.waitForRun(client,runId,options.organization(),timeout);}
public Run submitInput(UUID runId,RunInput input) throws ApiException {
        String key=options.identity();

        try {return new RunsApi(client).submitRunInput(runId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
public static final class ArtifactsResource {
      private final Resources client; private final RequestOptions options;
      private ArtifactsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public ArtifactsResource withOptions(RequestOptions options){return new ArtifactsResource(client,Objects.requireNonNull(options));}
      public void delete(UUID artifactId) throws ApiException {
        String key=options.identity();

        try {new ArtifactsApi(client).deleteArtifact(artifactId,key,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Download download(UUID artifactId) throws ApiException {


        try {return new ArtifactsApi(client).downloadArtifact(artifactId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class CreateConnectionAccessRuleParams {
        private String ifMatch;
        public CreateConnectionAccessRuleParams(String ifMatch){this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public CreateConnectionAccessRuleParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class DeleteConnectionAccessRuleParams {
        private String ifMatch;
        public DeleteConnectionAccessRuleParams(String ifMatch){this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public DeleteConnectionAccessRuleParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class ListConnectionAccessRulesParams {
        private String cursor;
private Integer limit;
private UUID workspaceId;
private UUID agentId;
private String sort;
private String direction;
        public ListConnectionAccessRulesParams(){}
        public ListConnectionAccessRulesParams cursor(String value){this.cursor=value;return this;}
public ListConnectionAccessRulesParams limit(Integer value){this.limit=value;return this;}
public ListConnectionAccessRulesParams workspaceId(UUID value){this.workspaceId=value;return this;}
public ListConnectionAccessRulesParams agentId(UUID value){this.agentId=value;return this;}
public ListConnectionAccessRulesParams sort(String value){this.sort=value;return this;}
public ListConnectionAccessRulesParams direction(String value){this.direction=value;return this;}
      }
public static final class ListConnectionsParams {
        private String cursor;
private Integer limit;
private UUID workspaceId;
private UUID agentId;
        public ListConnectionsParams(){}
        public ListConnectionsParams cursor(String value){this.cursor=value;return this;}
public ListConnectionsParams limit(Integer value){this.limit=value;return this;}
public ListConnectionsParams workspaceId(UUID value){this.workspaceId=value;return this;}
public ListConnectionsParams agentId(UUID value){this.agentId=value;return this;}
      }
public static final class ListConnectionToolsParams {
        private String cursor;
private Integer limit;
        public ListConnectionToolsParams(){}
        public ListConnectionToolsParams cursor(String value){this.cursor=value;return this;}
public ListConnectionToolsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListStdioPackagesParams {
        private String cursor;
private Integer limit;
        public ListStdioPackagesParams(){}
        public ListStdioPackagesParams cursor(String value){this.cursor=value;return this;}
public ListStdioPackagesParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ResolveConnectionAccessParams {
        private String cursor;
private Integer limit;
        public ResolveConnectionAccessParams(){}
        public ResolveConnectionAccessParams cursor(String value){this.cursor=value;return this;}
public ResolveConnectionAccessParams limit(Integer value){this.limit=value;return this;}
      }
public static final class UpdateConnectionAccessParams {
        private String ifMatch;
        public UpdateConnectionAccessParams(String ifMatch){this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public UpdateConnectionAccessParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class UpdateConnectionAccessRuleParams {
        private String ifMatch;
        public UpdateConnectionAccessRuleParams(String ifMatch){this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public UpdateConnectionAccessRuleParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class ConnectionsResource {
      private final Resources client; private final RequestOptions options;
      private ConnectionsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public ConnectionsResource withOptions(RequestOptions options){return new ConnectionsResource(client,Objects.requireNonNull(options));}
      public AuthorizationLink authorize(UUID connectionId,AuthorizeRequest input) throws ApiException {
        String key=options.identity();

        try {return new ConnectionsApi(client).authorizeConnection(connectionId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Connection create(ConnectionCreate input) throws ApiException {
        String key=options.identity();

        try {return new ConnectionsApi(client).createConnection(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public ConnectionAccessRuleMutation createAccessRule(UUID connectionId,ConnectionAccessRuleInput input,CreateConnectionAccessRuleParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).createConnectionAccessRule(connectionId,params.ifMatch,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public void delete(UUID connectionId) throws ApiException {


        try {new ConnectionsApi(client).deleteConnection(connectionId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ConnectionAccessRuleDeleted deleteAccessRule(UUID connectionId,UUID ruleId,DeleteConnectionAccessRuleParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).deleteConnectionAccessRule(connectionId,ruleId,params.ifMatch,key,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Connection get(UUID connectionId) throws ApiException {


        try {return new ConnectionsApi(client).getConnection(connectionId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ConnectionAccess getAccess(UUID connectionId) throws ApiException {


        try {return new ConnectionsApi(client).getConnectionAccess(connectionId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ConnectionAccessRulePage listAccessRules(UUID connectionId) throws ApiException {
        return listAccessRules(connectionId,new ListConnectionAccessRulesParams());
      }
public ConnectionAccessRulePage listAccessRules(UUID connectionId,ListConnectionAccessRulesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).listConnectionAccessRules(connectionId,options.organization(),params.cursor,params.limit,params.workspaceId,params.agentId,params.sort,params.direction);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ContextualConnectionPage list() throws ApiException {
        return list(new ListConnectionsParams());
      }
public ContextualConnectionPage list(ListConnectionsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).listConnections(params.cursor,params.limit,options.organization(),params.workspaceId,params.agentId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListConnectionTools200Response listTools(UUID connectionId) throws ApiException {
        return listTools(connectionId,new ListConnectionToolsParams());
      }
public ListConnectionTools200Response listTools(UUID connectionId,ListConnectionToolsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).listConnectionTools(connectionId,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ConnectorCatalog listConnectorCatalog() throws ApiException {


        try {return new ConnectionsApi(client).listConnectorCatalog(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public StdioPackagePage listStdioPackages() throws ApiException {
        return listStdioPackages(new ListStdioPackagesParams());
      }
public StdioPackagePage listStdioPackages(ListStdioPackagesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).listStdioPackages(params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ConnectionAccessResolutionPage resolveAccess(ConnectionAccessResolve input) throws ApiException {
        return resolveAccess(input,new ResolveConnectionAccessParams());
      }
public ConnectionAccessResolutionPage resolveAccess(ConnectionAccessResolve input,ResolveConnectionAccessParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).resolveConnectionAccess(input,options.organization(),params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ConnectionTest test(UUID connectionId) throws ApiException {
        String key=options.identity();

        try {return new ConnectionsApi(client).testConnection(connectionId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Connection update(UUID connectionId,ConnectionPatch input) throws ApiException {


        try {return new ConnectionsApi(client).updateConnection(connectionId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ConnectionAccess updateAccess(UUID connectionId,ConnectionAccessPatch input,UpdateConnectionAccessParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).updateConnectionAccess(connectionId,params.ifMatch,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public ConnectionAccessRuleMutation updateAccessRule(UUID connectionId,UUID ruleId,ConnectionAccessRuleInput input,UpdateConnectionAccessRuleParams params) throws ApiException {
        String key=options.identity();
        Objects.requireNonNull(params,"params");
        try {return new ConnectionsApi(client).updateConnectionAccessRule(connectionId,ruleId,params.ifMatch,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
public static final class ListApiKeysParams {
        private String cursor;
private Integer limit;
        public ListApiKeysParams(){}
        public ListApiKeysParams cursor(String value){this.cursor=value;return this;}
public ListApiKeysParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ApiKeysResource {
      private final Resources client; private final RequestOptions options;
      private ApiKeysResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public ApiKeysResource withOptions(RequestOptions options){return new ApiKeysResource(client,Objects.requireNonNull(options));}
      public NewApiKey create(KeyCreate input) throws ApiException {
        String key=options.identity();

        try {return new ApiKeysApi(client).createApiKey(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public ListApiKeys200Response list() throws ApiException {
        return list(new ListApiKeysParams());
      }
public ListApiKeys200Response list(ListApiKeysParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new ApiKeysApi(client).listApiKeys(params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public void revoke(UUID keyId) throws ApiException {


        try {new ApiKeysApi(client).revokeApiKey(keyId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListWebhookEndpointsParams {
        private String cursor;
private Integer limit;
        public ListWebhookEndpointsParams(){}
        public ListWebhookEndpointsParams cursor(String value){this.cursor=value;return this;}
public ListWebhookEndpointsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class WebhookEndpointsResource {
      private final Resources client; private final RequestOptions options;
      private WebhookEndpointsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public WebhookEndpointsResource withOptions(RequestOptions options){return new WebhookEndpointsResource(client,Objects.requireNonNull(options));}
      public NewWebhook create(WebhookCreate input) throws ApiException {
        String key=options.identity();

        try {return new WebhookEndpointsApi(client).createWebhookEndpoint(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public void delete(UUID endpointId) throws ApiException {


        try {new WebhookEndpointsApi(client).deleteWebhookEndpoint(endpointId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListWebhookEndpoints200Response list() throws ApiException {
        return list(new ListWebhookEndpointsParams());
      }
public ListWebhookEndpoints200Response list(ListWebhookEndpointsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WebhookEndpointsApi(client).listWebhookEndpoints(params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public NewWebhook rotateWebhookSecret(UUID endpointId) throws ApiException {
        String key=options.identity();

        try {return new WebhookEndpointsApi(client).rotateWebhookSecret(endpointId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Webhook update(UUID endpointId,WebhookPatch input) throws ApiException {


        try {return new WebhookEndpointsApi(client).updateWebhookEndpoint(endpointId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListWebhookDeliveriesParams {
        private String cursor;
private Integer limit;
        public ListWebhookDeliveriesParams(){}
        public ListWebhookDeliveriesParams cursor(String value){this.cursor=value;return this;}
public ListWebhookDeliveriesParams limit(Integer value){this.limit=value;return this;}
      }
public static final class WebhookDeliveriesResource {
      private final Resources client; private final RequestOptions options;
      private WebhookDeliveriesResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public WebhookDeliveriesResource withOptions(RequestOptions options){return new WebhookDeliveriesResource(client,Objects.requireNonNull(options));}
      public ListWebhookDeliveries200Response list() throws ApiException {
        return list(new ListWebhookDeliveriesParams());
      }
public ListWebhookDeliveries200Response list(ListWebhookDeliveriesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new WebhookDeliveriesApi(client).listWebhookDeliveries(params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Operation replay(UUID deliveryId) throws ApiException {
        String key=options.identity();

        try {return new WebhookDeliveriesApi(client).replayWebhookDelivery(deliveryId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
public static final class GetUsageParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private String groupBy;
        public GetUsageParams(){}
        public GetUsageParams from(OffsetDateTime value){this.from=value;return this;}
public GetUsageParams to(OffsetDateTime value){this.to=value;return this;}
public GetUsageParams groupBy(String value){this.groupBy=value;return this;}
      }
public static final class UsageResource {
      private final Resources client; private final RequestOptions options;
      private UsageResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public UsageResource withOptions(RequestOptions options){return new UsageResource(client,Objects.requireNonNull(options));}
      public Report get() throws ApiException {
        return get(new GetUsageParams());
      }
public Report get(GetUsageParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new UsageApi(client).getUsage(params.from,params.to,params.groupBy,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListRequestsParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private String cursor;
private Integer limit;
        public ListRequestsParams(){}
        public ListRequestsParams from(OffsetDateTime value){this.from=value;return this;}
public ListRequestsParams to(OffsetDateTime value){this.to=value;return this;}
public ListRequestsParams cursor(String value){this.cursor=value;return this;}
public ListRequestsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class RequestsResource {
      private final Resources client; private final RequestOptions options;
      private RequestsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public RequestsResource withOptions(RequestOptions options){return new RequestsResource(client,Objects.requireNonNull(options));}
      public ListRequests200Response list() throws ApiException {
        return list(new ListRequestsParams());
      }
public ListRequests200Response list(ListRequestsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new RequestsApi(client).listRequests(params.from,params.to,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListBillingUsageParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private UUID workspaceId;
private UUID worktreeId;
private UUID runId;
private UUID sessionId;
private String customerId;
private String agentKey;
private String provider;
private String model;
private String kind;
private String billingMode;
private UUID cursor;
private Integer limit;
        public ListBillingUsageParams(OffsetDateTime from,OffsetDateTime to){this.from=Objects.requireNonNull(from,"from");this.to=Objects.requireNonNull(to,"to");}
        public ListBillingUsageParams from(OffsetDateTime value){this.from=value;return this;}
public ListBillingUsageParams to(OffsetDateTime value){this.to=value;return this;}
public ListBillingUsageParams workspaceId(UUID value){this.workspaceId=value;return this;}
public ListBillingUsageParams worktreeId(UUID value){this.worktreeId=value;return this;}
public ListBillingUsageParams runId(UUID value){this.runId=value;return this;}
public ListBillingUsageParams sessionId(UUID value){this.sessionId=value;return this;}
public ListBillingUsageParams customerId(String value){this.customerId=value;return this;}
public ListBillingUsageParams agentKey(String value){this.agentKey=value;return this;}
public ListBillingUsageParams provider(String value){this.provider=value;return this;}
public ListBillingUsageParams model(String value){this.model=value;return this;}
public ListBillingUsageParams kind(String value){this.kind=value;return this;}
public ListBillingUsageParams billingMode(String value){this.billingMode=value;return this;}
public ListBillingUsageParams cursor(UUID value){this.cursor=value;return this;}
public ListBillingUsageParams limit(Integer value){this.limit=value;return this;}
      }
public static final class BillingResource {
      private final Resources client; private final RequestOptions options;
      private BillingResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public BillingResource withOptions(RequestOptions options){return new BillingResource(client,Objects.requireNonNull(options));}
      public Redirect createPortal() throws ApiException {
        String key=options.identity();

        try {return new BillingApi(client).createBillingPortal(key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Redirect createCheckout(CheckoutCreate input) throws ApiException {
        String key=options.identity();

        try {return new BillingApi(client).createCheckout(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Billing get() throws ApiException {


        try {return new BillingApi(client).getBilling(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Storage getStorage() throws ApiException {


        try {return new BillingApi(client).getStorage(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public BillingUsagePage listUsage(ListBillingUsageParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new BillingApi(client).listBillingUsage(params.from,params.to,params.workspaceId,params.worktreeId,params.runId,params.sessionId,params.customerId,params.agentKey,params.provider,params.model,params.kind,params.billingMode,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Storage updateStoragePolicy(StoragePolicy input) throws ApiException {
        String key=options.identity();

        try {return new BillingApi(client).updateStoragePolicy(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
public static final class ListHarnessesParams {
        private String cursor;
private Integer limit;
        public ListHarnessesParams(){}
        public ListHarnessesParams cursor(String value){this.cursor=value;return this;}
public ListHarnessesParams limit(Integer value){this.limit=value;return this;}
      }
public static final class HarnessesResource {
      private final Resources client; private final RequestOptions options;
      private HarnessesResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public HarnessesResource withOptions(RequestOptions options){return new HarnessesResource(client,Objects.requireNonNull(options));}
      public ListHarnesses200Response list() throws ApiException {
        return list(new ListHarnessesParams());
      }
public ListHarnesses200Response list(ListHarnessesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new HarnessesApi(client).listHarnesses(params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListModelsParams {
        private String harness;
private String cursor;
private Integer limit;
        public ListModelsParams(){}
        public ListModelsParams harness(String value){this.harness=value;return this;}
public ListModelsParams cursor(String value){this.cursor=value;return this;}
public ListModelsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ModelsResource {
      private final Resources client; private final RequestOptions options;
      private ModelsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public ModelsResource withOptions(RequestOptions options){return new ModelsResource(client,Objects.requireNonNull(options));}
      public ListModels200Response list() throws ApiException {
        return list(new ListModelsParams());
      }
public ListModels200Response list(ListModelsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new ModelsApi(client).listModels(params.harness,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class OperationsResource {
      private final Resources client; private final RequestOptions options;
      private OperationsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public OperationsResource withOptions(RequestOptions options){return new OperationsResource(client,Objects.requireNonNull(options));}
      public Operation get(UUID operationId) throws ApiException {


        try {return new OperationsApi(client).getOperation(operationId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class GetAccountSummaryParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private Boolean includeContact;
        public GetAccountSummaryParams(){}
        public GetAccountSummaryParams from(OffsetDateTime value){this.from=value;return this;}
public GetAccountSummaryParams to(OffsetDateTime value){this.to=value;return this;}
public GetAccountSummaryParams includeContact(Boolean value){this.includeContact=value;return this;}
      }
public static final class GetCapacityReportParams {
        private OffsetDateTime from;
private OffsetDateTime to;
        public GetCapacityReportParams(){}
        public GetCapacityReportParams from(OffsetDateTime value){this.from=value;return this;}
public GetCapacityReportParams to(OffsetDateTime value){this.to=value;return this;}
      }
public static final class GetGrowthMetricsParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private String groupBy;
private UUID organizationId;
        public GetGrowthMetricsParams(){}
        public GetGrowthMetricsParams from(OffsetDateTime value){this.from=value;return this;}
public GetGrowthMetricsParams to(OffsetDateTime value){this.to=value;return this;}
public GetGrowthMetricsParams groupBy(String value){this.groupBy=value;return this;}
public GetGrowthMetricsParams organizationId(UUID value){this.organizationId=value;return this;}
      }
public static final class GetInfrastructureHealthParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private String serviceId;
        public GetInfrastructureHealthParams(){}
        public GetInfrastructureHealthParams from(OffsetDateTime value){this.from=value;return this;}
public GetInfrastructureHealthParams to(OffsetDateTime value){this.to=value;return this;}
public GetInfrastructureHealthParams serviceId(String value){this.serviceId=value;return this;}
      }
public static final class GetOperatingReportParams {
        private OffsetDateTime from;
private OffsetDateTime to;
        public GetOperatingReportParams(){}
        public GetOperatingReportParams from(OffsetDateTime value){this.from=value;return this;}
public GetOperatingReportParams to(OffsetDateTime value){this.to=value;return this;}
      }
public static final class GetPlatformUsageMetricsParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private String groupBy;
private UUID organizationId;
        public GetPlatformUsageMetricsParams(){}
        public GetPlatformUsageMetricsParams from(OffsetDateTime value){this.from=value;return this;}
public GetPlatformUsageMetricsParams to(OffsetDateTime value){this.to=value;return this;}
public GetPlatformUsageMetricsParams groupBy(String value){this.groupBy=value;return this;}
public GetPlatformUsageMetricsParams organizationId(UUID value){this.organizationId=value;return this;}
      }
public static final class GetRunDiagnosticsParams {
        private OffsetDateTime from;
private OffsetDateTime to;
        public GetRunDiagnosticsParams(){}
        public GetRunDiagnosticsParams from(OffsetDateTime value){this.from=value;return this;}
public GetRunDiagnosticsParams to(OffsetDateTime value){this.to=value;return this;}
      }
public static final class ListAccountsParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private String query;
private Boolean includeContact;
private String cursor;
private Integer limit;
        public ListAccountsParams(){}
        public ListAccountsParams from(OffsetDateTime value){this.from=value;return this;}
public ListAccountsParams to(OffsetDateTime value){this.to=value;return this;}
public ListAccountsParams query(String value){this.query=value;return this;}
public ListAccountsParams includeContact(Boolean value){this.includeContact=value;return this;}
public ListAccountsParams cursor(String value){this.cursor=value;return this;}
public ListAccountsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListPlatformRequestsParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private UUID organizationId;
private Integer statusCode;
private String route;
private String cursor;
private Integer limit;
        public ListPlatformRequestsParams(){}
        public ListPlatformRequestsParams from(OffsetDateTime value){this.from=value;return this;}
public ListPlatformRequestsParams to(OffsetDateTime value){this.to=value;return this;}
public ListPlatformRequestsParams organizationId(UUID value){this.organizationId=value;return this;}
public ListPlatformRequestsParams statusCode(Integer value){this.statusCode=value;return this;}
public ListPlatformRequestsParams route(String value){this.route=value;return this;}
public ListPlatformRequestsParams cursor(String value){this.cursor=value;return this;}
public ListPlatformRequestsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListReportSnapshotsParams {
        private OffsetDateTime from;
private OffsetDateTime to;
private LocalDate cursor;
private Integer limit;
        public ListReportSnapshotsParams(){}
        public ListReportSnapshotsParams from(OffsetDateTime value){this.from=value;return this;}
public ListReportSnapshotsParams to(OffsetDateTime value){this.to=value;return this;}
public ListReportSnapshotsParams cursor(LocalDate value){this.cursor=value;return this;}
public ListReportSnapshotsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class OperatorResource {
      private final Resources client; private final RequestOptions options;
      private OperatorResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public OperatorResource withOptions(RequestOptions options){return new OperatorResource(client,Objects.requireNonNull(options));}
      public AccountSummary getAccountSummary(UUID accountId) throws ApiException {
        return getAccountSummary(accountId,new GetAccountSummaryParams());
      }
public AccountSummary getAccountSummary(UUID accountId,GetAccountSummaryParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).getAccountSummary(accountId,params.from,params.to,params.includeContact);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Report getCapacityReport() throws ApiException {
        return getCapacityReport(new GetCapacityReportParams());
      }
public Report getCapacityReport(GetCapacityReportParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).getCapacityReport(params.from,params.to);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Report getGrowthMetrics() throws ApiException {
        return getGrowthMetrics(new GetGrowthMetricsParams());
      }
public Report getGrowthMetrics(GetGrowthMetricsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).getGrowthMetrics(params.from,params.to,params.groupBy,params.organizationId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Report getInfrastructureHealth() throws ApiException {
        return getInfrastructureHealth(new GetInfrastructureHealthParams());
      }
public Report getInfrastructureHealth(GetInfrastructureHealthParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).getInfrastructureHealth(params.from,params.to,params.serviceId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Report getOperatingReport() throws ApiException {
        return getOperatingReport(new GetOperatingReportParams());
      }
public Report getOperatingReport(GetOperatingReportParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).getOperatingReport(params.from,params.to);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Report getPlatformUsageMetrics() throws ApiException {
        return getPlatformUsageMetrics(new GetPlatformUsageMetricsParams());
      }
public Report getPlatformUsageMetrics(GetPlatformUsageMetricsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).getPlatformUsageMetrics(params.from,params.to,params.groupBy,params.organizationId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Diagnostics getRunDiagnostics(UUID runId) throws ApiException {
        return getRunDiagnostics(runId,new GetRunDiagnosticsParams());
      }
public Diagnostics getRunDiagnostics(UUID runId,GetRunDiagnosticsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).getRunDiagnostics(runId,params.from,params.to);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListAccounts200Response listAccounts() throws ApiException {
        return listAccounts(new ListAccountsParams());
      }
public ListAccounts200Response listAccounts(ListAccountsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).listAccounts(params.from,params.to,params.query,params.includeContact,params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListRequests200Response listPlatformRequests() throws ApiException {
        return listPlatformRequests(new ListPlatformRequestsParams());
      }
public ListRequests200Response listPlatformRequests(ListPlatformRequestsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).listPlatformRequests(params.from,params.to,params.organizationId,params.statusCode,params.route,params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ReportSnapshotPage listReportSnapshots() throws ApiException {
        return listReportSnapshots(new ListReportSnapshotsParams());
      }
public ReportSnapshotPage listReportSnapshots(ListReportSnapshotsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new OperatorApi(client).listReportSnapshots(params.from,params.to,params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class CheckpointsResource {
      private final Resources client; private final RequestOptions options;
      private CheckpointsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public CheckpointsResource withOptions(RequestOptions options){return new CheckpointsResource(client,Objects.requireNonNull(options));}
      public ExportOperation exportArchive(UUID checkpointId,CheckpointExportRequest input) throws ApiException {
        String key=options.identity();

        try {return new CheckpointsApi(client).exportCheckpoint(checkpointId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Checkpoint updateRetention(UUID checkpointId,CheckpointPatch input) throws ApiException {


        try {return new CheckpointsApi(client).updateCheckpointRetention(checkpointId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class MeResource {
      private final Resources client; private final RequestOptions options;
      private MeResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public MeResource withOptions(RequestOptions options){return new MeResource(client,Objects.requireNonNull(options));}
      public Identity get() throws ApiException {


        try {return new MeApi(client).getIdentity(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class TransfersResource {
      private final Resources client; private final RequestOptions options;
      private TransfersResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public TransfersResource withOptions(RequestOptions options){return new TransfersResource(client,Objects.requireNonNull(options));}
      public Operation apply(UUID transferId,TransferApply input) throws ApiException {
        String key=options.identity();

        try {return new TransfersApi(client).applyTransfer(transferId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Transfer get(UUID transferId) throws ApiException {


        try {return new TransfersApi(client).getTransfer(transferId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListGithubRepositoriesParams {
        private String installationId;
        public ListGithubRepositoriesParams(String installationId){this.installationId=Objects.requireNonNull(installationId,"installationId");}
        public ListGithubRepositoriesParams installationId(String value){this.installationId=value;return this;}
      }
public static final class IntegrationsResource {
      private final Resources client; private final RequestOptions options;
      private IntegrationsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public IntegrationsResource withOptions(RequestOptions options){return new IntegrationsResource(client,Objects.requireNonNull(options));}
      public Workspace disconnectGithub(UUID workspaceId) throws ApiException {
        String key=options.identity();

        try {return new IntegrationsApi(client).disconnectGithub(workspaceId,key,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public GithubInstallations listGithubInstallations() throws ApiException {


        try {return new IntegrationsApi(client).listGithubInstallations(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public GithubRepositories listGithubRepositories(ListGithubRepositoriesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new IntegrationsApi(client).listGithubRepositories(params.installationId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class OrganizationsResource {
      private final Resources client; private final RequestOptions options;
      private OrganizationsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public OrganizationsResource withOptions(RequestOptions options){return new OrganizationsResource(client,Objects.requireNonNull(options));}
      public Invitation createInvitation(InvitationCreate input) throws ApiException {
        String key=options.identity();

        try {return new OrganizationsApi(client).createInvitation(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Organization create(OrganizationCreate input) throws ApiException {
        String key=options.identity();

        try {return new OrganizationsApi(client).createOrganization(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public ExecutionPolicy getExecutionPolicy() throws ApiException {


        try {return new OrganizationsApi(client).getExecutionPolicy(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListInvitations200Response listInvitations() throws ApiException {


        try {return new OrganizationsApi(client).listInvitations(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListMembers200Response listMembers() throws ApiException {


        try {return new OrganizationsApi(client).listMembers(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListOrganizationAudit200Response listAudit() throws ApiException {


        try {return new OrganizationsApi(client).listOrganizationAudit(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public void removeMember(UUID userId) throws ApiException {
        String key=options.identity();

        try {new OrganizationsApi(client).removeMember(key,userId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public void revokeInvitation(UUID invitationId) throws ApiException {
        String key=options.identity();

        try {new OrganizationsApi(client).revokeInvitation(key,invitationId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public ExecutionPolicy updateExecutionPolicy(ExecutionPolicyPatch input) throws ApiException {
        String key=options.identity();

        try {return new OrganizationsApi(client).updateExecutionPolicy(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public void updateMember(UUID userId,MemberPatch input) throws ApiException {
        String key=options.identity();

        try {new OrganizationsApi(client).updateMember(key,userId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Organization update(OrganizationCreate input) throws ApiException {
        String key=options.identity();

        try {return new OrganizationsApi(client).updateOrganization(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
public static final class ListTriggerDeliveriesParams {
        private String cursor;
private Integer limit;
        public ListTriggerDeliveriesParams(){}
        public ListTriggerDeliveriesParams cursor(String value){this.cursor=value;return this;}
public ListTriggerDeliveriesParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListTriggersParams {
        private String cursor;
private Integer limit;
private String kind;
        public ListTriggersParams(){}
        public ListTriggersParams cursor(String value){this.cursor=value;return this;}
public ListTriggersParams limit(Integer value){this.limit=value;return this;}
public ListTriggersParams kind(String value){this.kind=value;return this;}
      }
public static final class TriggersResource {
      private final Resources client; private final RequestOptions options;
      private TriggersResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public TriggersResource withOptions(RequestOptions options){return new TriggersResource(client,Objects.requireNonNull(options));}
      public NewTrigger create(TriggerCreate input) throws ApiException {
        String key=options.identity();

        try {return new TriggersApi(client).createTrigger(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public DeleteTrigger200Response delete(UUID triggerId) throws ApiException {


        try {return new TriggersApi(client).deleteTrigger(triggerId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Trigger get(UUID triggerId) throws ApiException {


        try {return new TriggersApi(client).getTrigger(triggerId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListTriggerDeliveries200Response listDeliveries(UUID triggerId) throws ApiException {
        return listDeliveries(triggerId,new ListTriggerDeliveriesParams());
      }
public ListTriggerDeliveries200Response listDeliveries(UUID triggerId,ListTriggerDeliveriesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new TriggersApi(client).listTriggerDeliveries(triggerId,params.cursor,params.limit,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListTriggers200Response list() throws ApiException {
        return list(new ListTriggersParams());
      }
public ListTriggers200Response list(ListTriggersParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new TriggersApi(client).listTriggers(params.cursor,params.limit,params.kind,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public TriggerDelivery retryReply(UUID triggerId,UUID deliveryId) throws ApiException {
        String key=options.identity();

        try {return new TriggersApi(client).retryTriggerReply(triggerId,deliveryId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public TriggerSecret rotateSecret(UUID triggerId) throws ApiException {
        String key=options.identity();

        try {return new TriggersApi(client).rotateTriggerSecret(triggerId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public TriggerDelivery run(UUID triggerId) throws ApiException {
        String key=options.identity();

        try {return new TriggersApi(client).runTrigger(triggerId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Trigger update(UUID triggerId,TriggerPatch input) throws ApiException {


        try {return new TriggersApi(client).updateTrigger(triggerId,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListSlackConnectionChannelsParams {
        private String cursor;
        public ListSlackConnectionChannelsParams(){}
        public ListSlackConnectionChannelsParams cursor(String value){this.cursor=value;return this;}
      }
public static final class SlackConnectionsResource {
      private final Resources client; private final RequestOptions options;
      private SlackConnectionsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public SlackConnectionsResource withOptions(RequestOptions options){return new SlackConnectionsResource(client,Objects.requireNonNull(options));}
      public SlackConnection create(SlackConnectionCreate input) throws ApiException {
        String key=options.identity();

        try {return new SlackConnectionsApi(client).createSlackConnection(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public DeleteTrigger200Response delete(UUID connectionId) throws ApiException {


        try {return new SlackConnectionsApi(client).deleteSlackConnection(connectionId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListSlackConnectionChannels200Response listChannels(UUID connectionId) throws ApiException {
        return listChannels(connectionId,new ListSlackConnectionChannelsParams());
      }
public ListSlackConnectionChannels200Response listChannels(UUID connectionId,ListSlackConnectionChannelsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new SlackConnectionsApi(client).listSlackConnectionChannels(connectionId,params.cursor,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListSlackConnections200Response list() throws ApiException {


        try {return new SlackConnectionsApi(client).listSlackConnections(options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class ListCustomerAgentConnectionsParams {
        private UUID cursor;
private Integer limit;
        public ListCustomerAgentConnectionsParams(){}
        public ListCustomerAgentConnectionsParams cursor(UUID value){this.cursor=value;return this;}
public ListCustomerAgentConnectionsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListCustomerAgentConversationsParams {
        private UUID cursor;
private Integer limit;
        public ListCustomerAgentConversationsParams(){}
        public ListCustomerAgentConversationsParams cursor(UUID value){this.cursor=value;return this;}
public ListCustomerAgentConversationsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListCustomerAgentFilesParams {
        private String path;
private String query;
private Boolean recursive;
private String cursor;
private Integer limit;
        public ListCustomerAgentFilesParams(){}
        public ListCustomerAgentFilesParams path(String value){this.path=value;return this;}
public ListCustomerAgentFilesParams query(String value){this.query=value;return this;}
public ListCustomerAgentFilesParams recursive(Boolean value){this.recursive=value;return this;}
public ListCustomerAgentFilesParams cursor(String value){this.cursor=value;return this;}
public ListCustomerAgentFilesParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListCustomerAgentRunEventsParams {
        private String after;
private String cursor;
private Integer limit;
        public ListCustomerAgentRunEventsParams(){}
        public ListCustomerAgentRunEventsParams after(String value){this.after=value;return this;}
public ListCustomerAgentRunEventsParams cursor(String value){this.cursor=value;return this;}
public ListCustomerAgentRunEventsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ListCustomerAgentsParams {
        private UUID cursor;
private Integer limit;
        public ListCustomerAgentsParams(){}
        public ListCustomerAgentsParams cursor(UUID value){this.cursor=value;return this;}
public ListCustomerAgentsParams limit(Integer value){this.limit=value;return this;}
      }
public static final class ReadCustomerAgentFileParams {
        private String path;
private Boolean download;
        public ReadCustomerAgentFileParams(String path){this.path=Objects.requireNonNull(path,"path");}
        public ReadCustomerAgentFileParams path(String value){this.path=value;return this;}
public ReadCustomerAgentFileParams download(Boolean value){this.download=value;return this;}
      }
public static final class UpdateCustomerAgentConnectionPermissionsParams {
        private String ifMatch;
        public UpdateCustomerAgentConnectionPermissionsParams(String ifMatch){this.ifMatch=Objects.requireNonNull(ifMatch,"ifMatch");}
        public UpdateCustomerAgentConnectionPermissionsParams ifMatch(String value){this.ifMatch=value;return this;}
      }
public static final class CustomerAgentsResource {
      private final Resources client; private final RequestOptions options;
      private CustomerAgentsResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public CustomerAgentsResource withOptions(RequestOptions options){return new CustomerAgentsResource(client,Objects.requireNonNull(options));}
      public CustomerConnectionAuthorization authorizeConnection(String customerId,UUID customerAgentId,UUID connectionId,CustomerConnectionAuthorize input) throws ApiException {
        String key=options.identity();

        try {return new CustomerAgentsApi(client).authorizeCustomerAgentConnection(customerId,customerAgentId,connectionId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Run cancelRun(String customerId,UUID customerAgentId,UUID runId) throws ApiException {
        String key=options.identity();

        try {return new CustomerAgentsApi(client).cancelCustomerAgentRun(customerId,customerAgentId,runId,key,new HashMap<>(),options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public CustomerAgentConnection completeConnection(String customerId,UUID customerAgentId,UUID connectionId,CustomerConnectionComplete input) throws ApiException {
        String key=options.identity();

        try {return new CustomerAgentsApi(client).completeCustomerAgentConnection(customerId,customerAgentId,connectionId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public CustomerAgentConnection createConnection(String customerId,UUID customerAgentId,CustomerAgentConnectionCreate input) throws ApiException {
        String key=options.identity();

        try {return new CustomerAgentsApi(client).createCustomerAgentConnection(customerId,customerAgentId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public void deleteConnection(String customerId,UUID customerAgentId,UUID connectionId) throws ApiException {


        try {new CustomerAgentsApi(client).deleteCustomerAgentConnection(customerId,customerAgentId,connectionId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public CustomerAgentBinding ensure(String customerId,CustomerAgentEnsure input) throws ApiException {
        String key=options.identity();

        try {return new CustomerAgentsApi(client).ensureCustomerAgent(customerId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public CustomerAgentBinding get(String customerId,UUID customerAgentId) throws ApiException {


        try {return new CustomerAgentsApi(client).getCustomerAgent(customerId,customerAgentId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Run getRun(String customerId,UUID customerAgentId,UUID runId) throws ApiException {


        try {return new CustomerAgentsApi(client).getCustomerAgentRun(customerId,customerAgentId,runId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public RunResult getRunResult(String customerId,UUID customerAgentId,UUID runId) throws ApiException {


        try {return new CustomerAgentsApi(client).getCustomerAgentRunResult(customerId,customerAgentId,runId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public CustomerAgentConnectionPage listConnections(String customerId,UUID customerAgentId) throws ApiException {
        return listConnections(customerId,customerAgentId,new ListCustomerAgentConnectionsParams());
      }
public CustomerAgentConnectionPage listConnections(String customerId,UUID customerAgentId,ListCustomerAgentConnectionsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new CustomerAgentsApi(client).listCustomerAgentConnections(customerId,customerAgentId,options.organization(),params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListSessions200Response listConversations(String customerId,UUID customerAgentId) throws ApiException {
        return listConversations(customerId,customerAgentId,new ListCustomerAgentConversationsParams());
      }
public ListSessions200Response listConversations(String customerId,UUID customerAgentId,ListCustomerAgentConversationsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new CustomerAgentsApi(client).listCustomerAgentConversations(customerId,customerAgentId,options.organization(),params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public FileListing listFiles(String customerId,UUID customerAgentId) throws ApiException {
        return listFiles(customerId,customerAgentId,new ListCustomerAgentFilesParams());
      }
public FileListing listFiles(String customerId,UUID customerAgentId,ListCustomerAgentFilesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new CustomerAgentsApi(client).listCustomerAgentFiles(customerId,customerAgentId,options.organization(),params.path,params.query,params.recursive,params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ListRunEvents200Response listRunEvents(String customerId,UUID customerAgentId,UUID runId) throws ApiException {
        return listRunEvents(customerId,customerAgentId,runId,new ListCustomerAgentRunEventsParams());
      }
public ListRunEvents200Response listRunEvents(String customerId,UUID customerAgentId,UUID runId,ListCustomerAgentRunEventsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new CustomerAgentsApi(client).listCustomerAgentRunEvents(customerId,customerAgentId,runId,options.organization(),params.after,params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public CustomerAgentPage list(String customerId) throws ApiException {
        return list(customerId,new ListCustomerAgentsParams());
      }
public CustomerAgentPage list(String customerId,ListCustomerAgentsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new CustomerAgentsApi(client).listCustomerAgents(customerId,options.organization(),params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public File readFile(String customerId,UUID customerAgentId,ReadCustomerAgentFileParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new CustomerAgentsApi(client).readCustomerAgentFile(customerId,customerAgentId,params.path,options.organization(),params.download);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public NativeRunAccepted sendMessage(String customerId,UUID customerAgentId,CustomerAgentMessage input) throws ApiException {
        String key=options.identity();

        try {return new CustomerAgentsApi(client).sendCustomerAgentMessage(customerId,customerAgentId,key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public void streamRun(String customerId,UUID customerAgentId,UUID runId,String after,Predicate<Event> receive) throws IOException,InterruptedException,ApiException {client.streamCustomerInOrganization(customerId,customerAgentId,runId,after,options.organization(),receive);}
public CustomerAgentConnection updateConnectionPermissions(String customerId,UUID customerAgentId,UUID connectionId,CustomerAgentConnectionPermissions input,UpdateCustomerAgentConnectionPermissionsParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new CustomerAgentsApi(client).updateCustomerAgentConnectionPermissions(customerId,customerAgentId,connectionId,params.ifMatch,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class InferencesResource {
      private final Resources client; private final RequestOptions options;
      private InferencesResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public InferencesResource withOptions(RequestOptions options){return new InferencesResource(client,Objects.requireNonNull(options));}
      public RunAccepted createBoundedAgentRun(BoundedAgentCreate input) throws ApiException {
        String key=options.identity();

        try {return new InferencesApi(client).createBoundedAgentRun(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public ContextArtifact createContextArtifact(ContextArtifactCreate input) throws ApiException {
        String key=options.identity();

        try {return new InferencesApi(client).createContextArtifact(key,input);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public DecisionDefinition createDecisionDefinition(DecisionDefinitionCreate input) throws ApiException {
        String key=options.identity();

        try {return new InferencesApi(client).createDecisionDefinition(key,input);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public RunAccepted create(InferenceCreate input) throws ApiException {
        String key=options.identity();

        try {return new InferencesApi(client).createInference(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public ContextArtifact deleteContextArtifact(UUID artifactId) throws ApiException {


        try {return new InferencesApi(client).deleteContextArtifact(artifactId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public DecisionDefinition deleteDecisionDefinition(UUID definitionId) throws ApiException {


        try {return new InferencesApi(client).deleteDecisionDefinition(definitionId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public ContextArtifact getContextArtifact(UUID artifactId) throws ApiException {


        try {return new InferencesApi(client).getContextArtifact(artifactId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public DecisionDefinition getDecisionDefinition(UUID definitionId) throws ApiException {


        try {return new InferencesApi(client).getDecisionDefinition(definitionId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
    }
public static final class TasksResource {
      private final Resources client; private final RequestOptions options;
      private TasksResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public TasksResource withOptions(RequestOptions options){return new TasksResource(client,Objects.requireNonNull(options));}
      public DecisionTask closeDecision(UUID taskId) throws ApiException {
        String key=options.identity();

        try {return new TasksApi(client).closeDecisionTask(key,taskId);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public DecisionTask createDecision(DecisionTaskCreate input) throws ApiException {
        String key=options.identity();

        try {return new TasksApi(client).createDecisionTask(key,input);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public DecisionTask getDecision(UUID taskId) throws ApiException {


        try {return new TasksApi(client).getDecisionTask(taskId);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public DecisionTask recordOutcome(UUID taskId,ApplicationOutcome input) throws ApiException {
        String key=options.identity();

        try {return new TasksApi(client).recordTaskOutcome(key,taskId,input);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public DecisionTask wakeDecision(UUID taskId,DecisionTaskWake input) throws ApiException {
        String key=options.identity();

        try {return new TasksApi(client).wakeDecisionTask(key,taskId,input);}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
public static final class ListSandboxesParams {
        private UUID worktreeId;
private UUID cursor;
private Integer limit;
        public ListSandboxesParams(){}
        public ListSandboxesParams worktreeId(UUID value){this.worktreeId=value;return this;}
public ListSandboxesParams cursor(UUID value){this.cursor=value;return this;}
public ListSandboxesParams limit(Integer value){this.limit=value;return this;}
      }
public static final class SandboxesResource {
      private final Resources client; private final RequestOptions options;
      private SandboxesResource(Resources client,RequestOptions options){this.client=client;this.options=options;}
      public SandboxesResource withOptions(RequestOptions options){return new SandboxesResource(client,Objects.requireNonNull(options));}
      public Sandbox create(SandboxCreate input) throws ApiException {
        String key=options.identity();

        try {return new SandboxesApi(client).createSandbox(key,input,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Sandbox destroy(UUID sandboxId) throws ApiException {
        String key=options.identity();

        try {return new SandboxesApi(client).destroySandbox(sandboxId,key,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Sandbox get(UUID sandboxId) throws ApiException {


        try {return new SandboxesApi(client).getSandbox(sandboxId,options.organization());}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public SandboxPage list() throws ApiException {
        return list(new ListSandboxesParams());
      }
public SandboxPage list(ListSandboxesParams params) throws ApiException {

        Objects.requireNonNull(params,"params");
        try {return new SandboxesApi(client).listSandboxes(options.organization(),params.worktreeId,params.cursor,params.limit);}
        catch(ApiException error) {throw new RequestException(error,null);}
      }
public Sandbox pause(UUID sandboxId) throws ApiException {
        String key=options.identity();

        try {return new SandboxesApi(client).pauseSandbox(sandboxId,key,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
public Sandbox resume(UUID sandboxId) throws ApiException {
        String key=options.identity();

        try {return new SandboxesApi(client).resumeSandbox(sandboxId,key,options.organization());}
        catch(ApiException error) {throw new RequestException(error,key);}
      }
    }
}
