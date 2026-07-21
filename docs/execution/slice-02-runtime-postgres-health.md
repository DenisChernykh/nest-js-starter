# Slice 02 execution evidence: runtime, PostgreSQL and health

## Tested implementation

- Date: 2026-07-21 (Asia/Yekaterinburg).
- Branch: `feat/runtime-postgres-health`.
- `testedImplementationHead`: `b88fcbe64084f6370cee1465c2cc0ecadbaca7e6`.
- Registry/official release snapshot was refreshed on 2026-07-21 before
  installation. Direct dependencies remain exact pins in `package.json` and the
  frozen lockfile.
- Node.js: `24.18.0`; pnpm: `11.15.1`.
- Native production `tsc`: `7.0.2`.
- Compatibility alias: `npm:@typescript/typescript6@6.0.2`; its installed
  `tsc6` and imported API both report `6.0.3`. The bridge gate verifies that the
  CLI/API agree and that compatibility TypeScript is not the production
  compiler.
- NestJS: `11.1.28`; Prisma CLI/Client/adapter: `7.9.0`;
  typescript-eslint: `8.65.0`.
- PostgreSQL:
  `postgres:18.4-trixie@sha256:3a82e1f56c8f0f5616a11103ac3d47e632c3938698946a7ad26da0df1334744a`;
  the reviewed manifest is multi-architecture for `linux/amd64` and
  `linux/arm64/v8`.

No remote was configured and no branch, commit or artifact was published.

## Automated acceptance

All commands below exited 0 against the tested implementation:

```text
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 toolchain:check
corepack pnpm@11.15.1 check:quick
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
corepack pnpm@11.15.1 build
```

The frozen install reported `Already up to date`; `pnpm-lock.yaml` did not
change. `dist/bootstrap/api/main.js` exists after the clean production build.

Test evidence:

- unit: 18 suites, 92 tests;
- generator: 3 suites, 52 tests;
- generator golden: 2 suites, 2 tests;
- architecture: 1 suite, 44 tests; dependency-cruiser checked 71 modules and
  156 dependencies;
- PostgreSQL integration: 3 suites, 26 tests;
- API e2e: 7 suites, 15 tests;
- aggregate runtime coverage: 28 suites, 133 tests.

Coverage exceeded the required statements/functions/lines/branches
80/80/80/75 gate:

```text
Statements: 93.08% (2061/2214)
Functions:  92.19% (130/141)
Lines:      93.08% (2061/2214)
Branches:   87.43% (341/390)
```

No suite uses Testcontainers reuse, a developer database fallback, `.skip` or
retry-until-green behavior.

## Database and lifecycle evidence

Migration-from-empty applied `20260720000000_baseline`. A second explicit
`prisma migrate deploy` reported `No pending migrations to apply`, proving the
committed deploy path is idempotent. The API-does-not-migrate e2e test proves
that the long-running role performs no schema deployment.

The PostgreSQL outage scenario starts green, freezes all server processes and
the container cgroup, observes readiness `503`, then resumes with CONT and
returns to `200`. Liveness and the startup latch remain `200` throughout the
outage. The red transition is asserted within 2,000 ms against a configured
250 ms database health deadline; recovery is asserted within 3,000 ms.

The startup-failure scenario exposes startup `503`, rejects `/v1`, closes the
partial listener/resources and exits 1 within 2,500 ms with a configured
1,200 ms database deadline. Captured output contains no connection URL.

A compiled child process reached readiness, received a real `SIGTERM` and
exited cleanly with code 0 within 5,000 ms. Unit/runtime tests cover repeated
signals, drain ordering, operation deadlines and the hard-watchdog exit-1 path.
Non-settling ordinary Prisma work is treated as failed shutdown; it is never
described as cancellable.

## Local workflow smoke

Compose validation resolved the exact digest-qualified image. Local port 5432
was already allocated, so the documented recovery path was exercised with
`POSTGRES_PORT=55432`. PostgreSQL became healthy on
`127.0.0.1:55432`, `pg_isready` accepted connections, and the named volume was
retained after `docker compose down`.

The compiled API smoke returned `200` from `/health/live`, `/health/startup`
and `/health/ready`; `/v1/health/live` returned the required `404`. A real
foreground `SIGTERM` produced exit code 0.

## Scope review

Automated tests or the smoke above cover `/v1`, Helmet, exact credentialed
CORS, trusted proxy CIDRs, request/body bounds, strict DTO validation,
infrastructure-only Prisma, migration-from-empty, separate API/migrator roles,
all three unprefixed health routes, startup validation, PostgreSQL
green/red/green and bounded shutdown.

Repository scans found no unfinished production markers, Amazing EKB/MCP
identifiers, Prisma/pg imports outside the allowed database infrastructure, or
migration invocation in API source/startup.

Deferred to later slices: Redis/auth; RFC 9457 errors, logging and OpenTelemetry;
OpenAPI/Swagger; Docker application image, CI and GHCR; Dokploy; recipes.
