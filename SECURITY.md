# Security reports

Do not post credentials, customer content, or exploit details in a public issue. Before publishing this repository, its operator must configure a private vulnerability-reporting channel and enable GitHub private vulnerability reporting. Use that channel for authorization, isolation, secret-handling and financial-integrity issues.

Until a private channel is configured, contact the repository owner privately through an existing trusted channel. No security response-time guarantee is offered before an operator publishes one. Reports should include the affected revision, minimal synthetic reproduction, expected boundary and observed impact.

Default acceptance runs only local fixtures. Production operator tokens, model keys, billing secrets and customer snapshots must never be supplied to a pull-request workflow. Review dependency upgrades and native-image changes with the appropriate adapter/failure tests. Rotate exposed keys, preserve financial evidence and follow the incident/recovery guidance in docs/18-launch-guide.md.
