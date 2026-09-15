-- Activate with the matching application after accepted development runs drain.
-- Credential/account identity and accepted run snapshots are deliberately untouched.
ALTER TABLE connections
 ADD COLUMN access_organization_wide boolean NOT NULL DEFAULT false,
 ADD COLUMN access_tools text[] NOT NULL DEFAULT '{}',
 ADD COLUMN access_version bigint NOT NULL DEFAULT 1 CHECK (access_version > 0);
UPDATE connections SET
 access_organization_wide = COALESCE(data->'grants'->>'subject_type' = 'organization', false),
 access_tools = ARRAY(SELECT jsonb_array_elements_text(COALESCE(data->'grants'->'tools','[]'))),
 data = data - 'grants' - 'shared' - 'subject_id' - 'subject_type';

CREATE TABLE connection_access_rules (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 connection_id uuid NOT NULL,
 scope text NOT NULL CHECK (scope IN ('project','agent','project_agent')),
 project_id uuid,
 agent_id uuid,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((scope='project' AND project_id IS NOT NULL AND agent_id IS NULL)
     OR (scope='agent' AND project_id IS NULL AND agent_id IS NOT NULL)
     OR (scope='project_agent' AND project_id IS NOT NULL AND agent_id IS NOT NULL)),
 FOREIGN KEY (organization_id,connection_id) REFERENCES connections(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,agent_id) REFERENCES agents(organization_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX connection_access_project_unique ON connection_access_rules(connection_id,project_id) WHERE scope='project';
CREATE UNIQUE INDEX connection_access_agent_unique ON connection_access_rules(connection_id,agent_id) WHERE scope='agent';
CREATE UNIQUE INDEX connection_access_pair_unique ON connection_access_rules(connection_id,project_id,agent_id) WHERE scope='project_agent';
CREATE INDEX connection_access_project ON connection_access_rules(organization_id,project_id,connection_id);
CREATE INDEX connection_access_agent ON connection_access_rules(organization_id,agent_id,connection_id);
CREATE INDEX connection_access_listing ON connection_access_rules(organization_id,connection_id,created_at,id);
CREATE INDEX connection_access_project_listing ON connection_access_rules(connection_id,project_id,id);
CREATE INDEX connection_access_agent_listing ON connection_access_rules(connection_id,agent_id,id);
ALTER TABLE connection_access_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_access_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connection_access_rules
 USING (organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK (organization_id::text=current_setting('app.organization_id',true));
