# Maintainer documentation

Release work and verification evidence live here, separate from user guides. Start with the [release TODO](TODO.md) for unresolved work and [implementation status](../status/README.md) for measured behavior.

## Release and acceptance

- [Pre-deployment checklist](../operations/pre-deployment.md): reusable release gates.
- [Delivery scope](../engineering/delivery.md): application boundaries and release artifacts.
- [Testing and CI](../engineering/testing.md): coverage, mutation testing, and reproducible commands.
- [Connector catalog evidence](evidence/connectors.md) and [tool security evidence](evidence/tools-security.md).
- [Search integration evidence](evidence/search.md) and [Composio evidence](evidence/composio.md).
- [Live provider acceptance](../engineering/testing/live-integrations.md), [database evidence](../operations/neon/verification.md), and [dashboard stream evidence](../features/dashboard/live-refresh/verification.md).

## Product and documentation decisions

- [Documentation architecture](../engineering/documentation.md) and [research references](../engineering/documentation/research.md).
- [Product scope](../product/README.md), [historical naming exploration](../product/naming.md), and [architecture research](../architecture/research.md).
- [Requirements map](../requirements.csv): feature-to-implementation traceability.

Keep secrets, personal contact details, account identifiers, and machine-specific deployment records in a private operator vault. Public maintainer documentation records the check and its outcome without publishing credentials or assuming access to a developer's local files.
