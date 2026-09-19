-- Breaking API terminology change. Deploy after draining accepted work; old and
-- new application revisions must not write concurrently. IDs and bytes do not change.
ALTER TABLE workspaces RENAME TO worktrees;
ALTER TABLE projects RENAME TO workspaces;
DO $$ DECLARE c record; BEGIN
 -- Rename checkout columns first to avoid colliding with the new workspace name.
 FOR c IN SELECT table_schema,table_name,column_name FROM information_schema.columns
  WHERE table_schema IN ('public','reporting') AND column_name='workspace_id' LOOP
  IF c.table_schema='reporting' THEN
   EXECUTE format('ALTER VIEW %I.%I RENAME COLUMN workspace_id TO worktree_id',c.table_schema,c.table_name);
  ELSE
   EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN workspace_id TO worktree_id',c.table_schema,c.table_name);
  END IF;
 END LOOP;
 FOR c IN SELECT table_schema,table_name,column_name FROM information_schema.columns
  WHERE table_schema IN ('public','reporting') AND column_name IN ('project_id','project_ids') LOOP
  IF c.table_schema='reporting' THEN
   EXECUTE format('ALTER VIEW %I.%I RENAME COLUMN %I TO %I',c.table_schema,c.table_name,c.column_name,replace(c.column_name,'project','workspace'));
  ELSE
   EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I',c.table_schema,c.table_name,c.column_name,replace(c.column_name,'project','workspace'));
  END IF;
 END LOOP;
END $$;

-- Shallow structural conversion only. Never recurse into customer content,
-- instructions, arbitrary metadata, schemas, tool arguments, or output.
CREATE FUNCTION pg_temp.rename_resource_fields(value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN jsonb_typeof(value)='object' THEN
  COALESCE((SELECT jsonb_object_agg(CASE key
   WHEN 'project_id' THEN 'workspace_id' WHEN 'workspace_id' THEN 'worktree_id'
   WHEN 'project_ids' THEN 'workspace_ids' WHEN 'projectIds' THEN 'workspaceIds'
   WHEN 'default_workspace_id' THEN 'default_worktree_id'
   WHEN 'project_name' THEN 'workspace_name' WHEN 'workspace_name' THEN 'worktree_name'
   ELSE key END, val) FROM jsonb_each(value) AS fields(key,val)), '{}'::jsonb)
 ELSE value END
$$;
CREATE FUNCTION pg_temp.rename_resource_scopes(value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN jsonb_typeof(value)='array' THEN
  COALESCE((SELECT jsonb_agg(CASE WHEN item #>> '{}' LIKE 'projects:%'
   THEN to_jsonb(replace(item #>> '{}','projects:','workspaces:')) ELSE item END)
   FROM jsonb_array_elements(value) item),'[]'::jsonb) ELSE value END
$$;
CREATE FUNCTION pg_temp.rename_authority(value jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN value ? 'scopes' THEN jsonb_set(pg_temp.rename_resource_fields(value),'{scopes}',pg_temp.rename_resource_scopes(value->'scopes'))
 ELSE pg_temp.rename_resource_fields(value) END
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspaces','worktrees','agents','sessions','checkpoints','artifacts','operations','transfers'] LOOP
  EXECUTE format('UPDATE %I SET data=pg_temp.rename_resource_fields(data)',t);
 END LOOP;
END $$;
UPDATE sessions SET data=jsonb_set(data,'{config}',pg_temp.rename_resource_fields(data->'config')) WHERE data ? 'config';
UPDATE worktrees SET data=jsonb_set(data,'{sync}',pg_temp.rename_resource_fields(data->'sync')) WHERE data ? 'sync';
UPDATE operations SET data=jsonb_set(data,'{result}',pg_temp.rename_resource_fields(data->'result')) WHERE data ? 'result';
UPDATE operations SET data=jsonb_set(data,'{actor}',pg_temp.rename_authority(data->'actor')) WHERE data ? 'actor';
UPDATE operations SET data=jsonb_set(data,'{required_scopes}',pg_temp.rename_resource_scopes(data->'required_scopes')) WHERE data ? 'required_scopes';
UPDATE operations SET data=jsonb_set(data,'{kind}',to_jsonb(CASE data->>'kind'
 WHEN 'project_archive' THEN 'workspace_archive'
 WHEN 'workspace_create' THEN 'worktree_create'
 WHEN 'workspace_delete' THEN 'worktree_delete'
 WHEN 'workspace_restore' THEN 'worktree_restore' END))
 WHERE data->>'kind' IN ('project_archive','workspace_create','workspace_delete','workspace_restore');
UPDATE runs SET config=pg_temp.rename_authority(config),result=pg_temp.rename_resource_fields(result);
UPDATE decision_tasks SET principal=pg_temp.rename_authority(principal);
UPDATE customer_connection_authorizations SET principal=pg_temp.rename_authority(principal);
UPDATE api_keys SET scopes=ARRAY(SELECT CASE WHEN s LIKE 'projects:%' THEN replace(s,'projects:','workspaces:') ELSE s END FROM unnest(scopes) s);

ALTER TABLE connection_access_rules DROP CONSTRAINT connection_access_rules_scope_check;
ALTER TABLE connection_access_rules DROP CONSTRAINT connection_access_rules_check;
DROP INDEX connection_access_project_unique;
DROP INDEX connection_access_pair_unique;
UPDATE connection_access_rules SET scope=CASE scope WHEN 'project' THEN 'workspace' WHEN 'project_agent' THEN 'workspace_agent' ELSE scope END;
ALTER TABLE connection_access_rules ADD CONSTRAINT connection_access_rules_scope_check CHECK(scope IN ('workspace','agent','workspace_agent'));
ALTER TABLE connection_access_rules ADD CONSTRAINT connection_access_rules_check CHECK(
 (scope='workspace' AND workspace_id IS NOT NULL AND agent_id IS NULL) OR
 (scope='agent' AND workspace_id IS NULL AND agent_id IS NOT NULL) OR
 (scope='workspace_agent' AND workspace_id IS NOT NULL AND agent_id IS NOT NULL));
CREATE UNIQUE INDEX connection_access_workspace_unique ON connection_access_rules(connection_id,workspace_id) WHERE scope='workspace';
CREATE UNIQUE INDEX connection_access_pair_unique ON connection_access_rules(connection_id,workspace_id,agent_id) WHERE scope='workspace_agent';


-- Existing OAuth grants retain the same authority under the renamed scopes.
-- Fresh installations create auth tables after domain migrations, so they have
-- no old grants to convert. Already-issued signed tokens require refresh/login.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT table_name,column_name FROM information_schema.columns
  WHERE table_schema='auth' AND table_name IN ('oauthClient','oauthRefreshToken','oauthAccessToken','oauthConsent')
  AND column_name IN ('scopes','clientCredentialsScopes') AND data_type='jsonb' LOOP
  EXECUTE format('UPDATE auth.%I SET %I=pg_temp.rename_resource_scopes(%I)',c.table_name,c.column_name,c.column_name);
 END LOOP;
END $$;
UPDATE operations SET data=jsonb_set(data,'{result,sync}',pg_temp.rename_resource_fields(data#>'{result,sync}')) WHERE jsonb_typeof(data#>'{result,sync}')='object';
-- Access snapshots are platform evidence; their source enum is not customer text.
UPDATE runs SET config=jsonb_set(config,'{connection_access}',
 (SELECT coalesce(jsonb_agg(CASE WHEN item->>'source' IN ('project','project_agent')
  THEN jsonb_set(item,'{source}',to_jsonb(replace(item->>'source','project','workspace'))) ELSE item END),'[]'::jsonb)
  FROM jsonb_array_elements(config->'connection_access') item))
 WHERE jsonb_typeof(config->'connection_access')='array';
