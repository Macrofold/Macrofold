-- The same GitHub installation can be explicitly authorized by owners of more than one tenant.
-- Each tenant still proves the user's write permission for each connected repository.
ALTER TABLE github_installations DROP CONSTRAINT github_installations_pkey;
ALTER TABLE github_installations ADD PRIMARY KEY(organization_id,installation_id);
