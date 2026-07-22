# Foundation scope

The completed foundation proves repository portability, exact compiler/tooling
reproducibility, generated module boundaries and a real executable runtime.

The runtime slice owns the NestJS API bootstrap, typed environment validation,
PostgreSQL/Prisma lifecycle, migrations, transaction boundary, health routes,
hardened HTTP defaults and bounded graceful shutdown. It contains no sample
domain, fake CRUD or hidden migration at API startup.

Redis/auth, normalized errors, structured logging and telemetry, and OpenAPI
are completed foundation slices. OCI image, PR CI and stage GHCR publication
are also part of the foundation: they prove one-role image behavior, build-once
digest identity, registry attestations and vulnerability evidence without
performing a deployment.

Dokploy environments, database privilege provisioning, backup, rollback,
production promotion and recipes remain separate later slices. The
`starter.manifest.json remains schema v1` because no current consumer needs OCI
fields; publication state is execution evidence, not starter recipe state.
