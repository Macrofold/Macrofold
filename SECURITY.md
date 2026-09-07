# Security policy

Report vulnerabilities privately to the repository maintainers. Do not post exploit details, credentials, customer files, or private account information in a public issue.

## Submit a report

Use an established private contact with the [repository maintainers](https://github.com/Macrofold). If you do not have one, open an issue requesting a private reporting channel without describing the vulnerability. For an issue specific to a hosted deployment, contact that deployment's published support channel.

Include the affected revision, a minimal synthetic reproduction, the expected security boundary, and the observed impact. Coordinate public disclosure after maintainers have had an opportunity to investigate and address the issue.

## Security boundaries

The platform isolates organizations, scopes credentials and connections, constrains native execution, and verifies persisted file state. These boundaries and their limits are described in [security architecture](docs/features/identity-integrations/implementation.md).

Pull-request workflows use local fixtures and must never receive production tokens, billing secrets, or customer snapshots. If a credential is exposed, revoke it through its provider and follow the deployment's incident and recovery procedure. Preserve financial evidence and retained decryption keys when planning remediation.
