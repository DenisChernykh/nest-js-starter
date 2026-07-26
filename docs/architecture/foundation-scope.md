# Production foundation scope

This starter keeps a small production boundary: configuration, PostgreSQL,
coordination Redis, HTTP lifecycle/health, auth/RBAC, structured logging and
trace-only OpenTelemetry. The five local module layers remain
`domain`, `application`, `infrastructure`, `presentation` and `composition`;
their boundaries are documented in `module-boundaries.md`.

Runtime defaults live in one typed immutable `runtime-defaults.ts` object.
Deployment environment variables describe connectivity, public URLs, process
identity and four auth secrets; internal deadlines and tuning stay in code.

The repository gate uses Prettier, Prisma, non-mutating OpenAPI drift/lint,
ESLint, TypeScript 6.0.2, unit tests, standard dependency-cruiser and the
compiled build. Integration and e2e suites are added by `check`; OCI smoke is
separate and runs during stage publication.

The foundation intentionally excludes a generator/manifest system, generic
cache or pub/sub services, queues, object storage, self-service auth, runtime
metrics and custom OCI evidence machinery. Product modules own their ports and
adapters; shared infrastructure is introduced only after a real consumer and
failure model are known.

`docs/roadmap.md` is the canonical source for remaining deployment/recovery
work and optional capability adoption. Product repositories may provide proven
patterns, but they do not define starter scope.
