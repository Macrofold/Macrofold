-- Worktrees are independently persisted clones; several may check out the same branch.
-- NULL display names are intentional until the first run. Named worktrees are unique per project.
DROP INDEX unique_workspace_branch;
CREATE UNIQUE INDEX unique_workspace_name ON workspaces(project_id, lower(btrim(data->>'name')))
WHERE COALESCE(data->>'deleted','false')='false' AND NULLIF(btrim(data->>'name'),'') IS NOT NULL;
