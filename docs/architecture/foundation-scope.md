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
