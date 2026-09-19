CREATE TABLE decision_tasks (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
 recipe jsonb NOT NULL, principal jsonb NOT NULL,
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','running','needs_investigation','publishing','proposal','stopped','closed')),
 close_requested boolean NOT NULL DEFAULT false,
 latest_wake_id uuid, proposal_artifact_id uuid REFERENCES artifacts(id), failure_code text,
 evidence_expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE decision_task_wakes (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, task_id uuid NOT NULL,
 event_id text NOT NULL, fingerprint text NOT NULL, input_ciphertext text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,event_id),
 FOREIGN KEY(organization_id,task_id) REFERENCES decision_tasks(organization_id,id)
);
CREATE TABLE decision_task_runs (
 organization_id uuid NOT NULL, task_id uuid NOT NULL, wake_id uuid NOT NULL REFERENCES decision_task_wakes(id),
 run_id uuid PRIMARY KEY, step text NOT NULL CHECK(step IN ('decide','investigate')),
 allocated_micro_usd bigint NOT NULL CHECK(allocated_micro_usd>=0), committed_micro_usd bigint CHECK(committed_micro_usd>=0),
 UNIQUE(wake_id,step), FOREIGN KEY(organization_id,task_id) REFERENCES decision_tasks(organization_id,id),
 FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id)
);
CREATE TABLE decision_task_evidence (
 organization_id uuid NOT NULL, task_id uuid NOT NULL, artifact_id uuid NOT NULL REFERENCES artifacts(id),
 PRIMARY KEY(task_id,artifact_id), FOREIGN KEY(organization_id,task_id) REFERENCES decision_tasks(organization_id,id)
);
CREATE TABLE decision_task_outcomes (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, task_id uuid NOT NULL, wake_id uuid NOT NULL REFERENCES decision_task_wakes(id),
 event_id text NOT NULL, fingerprint text NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,event_id), FOREIGN KEY(organization_id,task_id) REFERENCES decision_tasks(organization_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['decision_tasks','decision_task_wakes','decision_task_runs','decision_task_evidence','decision_task_outcomes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(organization_id::text=current_setting(''app.organization_id'',true)) WITH CHECK(organization_id::text=current_setting(''app.organization_id'',true))',t);
 END LOOP;
END $$;
