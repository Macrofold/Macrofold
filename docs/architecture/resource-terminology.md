# Workspace and worktree terminology

A workspace owns a distinct file tree. Worktrees are its checkouts. Projects are future grouping containers for workspaces and are not implemented.

## Breaking API change

| Previous contract | Current contract |
| --- | --- |
| Project, `project_id`, `/v1/projects` | Workspace, `workspace_id`, `/v1/workspaces` |
| Workspace, `workspace_id`, `/v1/workspaces` | Worktree, `worktree_id`, `/v1/worktrees` |
| `projects:*` API-key scopes | `workspaces:*` scopes |
| `default_workspace_id` | `default_worktree_id` |

IDs do not change. Update SDKs and all request bodies, resource methods, routes and stored application field names together. The previous `/v1/workspaces` route cannot be an alias because it now means the parent resource. Native filesystem paths and persisted snapshot namespaces remain private implementation details, not public resource names. External providers retain their own terminology, such as Vercel projects.

## Migration and rollout

Migration 041 renames tables and relational columns without copying or deleting file/checkpoint bytes. It converts owned resource references, API-key restrictions, stored OAuth grant scopes, operation authority and connector scopes. Existing signed access tokens carry their original scopes: refresh them or sign in again after deploying the matching client. It does not recursively rename arbitrary customer JSON, prompts, tool arguments or model output. Historical migration files remain unchanged.

Drain active work and stop old writers before applying the migration and deploying the matching application/SDK release. Do not run mixed old/new application versions against this schema. Existing client requests and encrypted historical idempotency responses use the old contract; do not replay an old mutation through a newly named route. Reconcile its existing operation/run ID first. Back up database and object storage together before the breaking upgrade. The migration has been exercised with disposable fixtures; hosted databases require a coordinated deployment. The inactive local development database has also been backed up and migrated through 041.
