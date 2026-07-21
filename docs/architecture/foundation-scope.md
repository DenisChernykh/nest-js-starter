# Foundation scope

The completed foundation proves repository portability, exact compiler/tooling
reproducibility, generated module boundaries and a real executable runtime.

The runtime slice owns the NestJS API bootstrap, typed environment validation,
PostgreSQL/Prisma lifecycle, migrations, transaction boundary, health routes,
hardened HTTP defaults and bounded graceful shutdown. It contains no sample
domain, fake CRUD or hidden migration at API startup.

Redis/auth, normalized errors, structured logging and telemetry, OpenAPI,
container images, CI/GHCR, Dokploy and recipes remain separate later slices.
