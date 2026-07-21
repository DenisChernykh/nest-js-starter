# NestJS Starter

Production-oriented NestJS backend foundation with a runnable HTTP process,
typed configuration, PostgreSQL/Prisma, explicit migrations, three health
contracts and bounded graceful shutdown. Repository architecture and the exact
toolchain are enforced by executable gates.

Included: HTTP runtime, typed config, PostgreSQL/Prisma, migrations, transaction
boundary, health, graceful shutdown and architecture/toolchain foundation.

Not included yet: Redis/auth, RFC 9457 errors, Pino/OTel, OpenAPI/Swagger,
Docker application image, CI/GHCR, Dokploy and recipes. The starter deliberately
contains no fake CRUD or business model.

## Prerequisites

- Node.js `24.18.0`.
- Corepack with pnpm `11.15.1`.
- Docker for PostgreSQL, integration, e2e and aggregate coverage tests.

Production source is compiled and type-checked by native TypeScript 7
(`@typescript/native` exposed as `tsc`). TypeScript 6 exists only as the exact
compatibility API required by `ts-jest` and related tooling; `toolchain:check`
guards that split.

## Local runtime

```bash
cp .env.example .env
corepack pnpm@11.15.1 install --frozen-lockfile
docker compose up -d --wait postgres
corepack pnpm@11.15.1 start:migrate
corepack pnpm@11.15.1 dev:api
```

The long-running `start:api`/`dev:api` role never migrates. Run the one-shot
`start:migrate` role explicitly before the API. See
`docs/runbooks/local-postgres.md` for verification, failure paths and cleanup.

Health endpoints are outside the `/v1` application prefix:

- `GET /health/live` — process is alive;
- `GET /health/startup` — irreversible startup latch;
- `GET /health/ready` — lifecycle and required dependencies are ready.

## Verification

```bash
corepack pnpm@11.15.1 check:quick
TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
```

`check:quick` is the non-Docker developer gate: formatting, exact toolchain,
Prisma validation/generation, lint, TypeScript 7 checks, unit/generator/
architecture tests, manifest and production build. `check` additionally runs
real PostgreSQL integration/e2e suites and the aggregate 80/80/80/75 runtime
coverage gate.

Useful focused commands:

- `corepack pnpm@11.15.1 test` — unit, generator and architecture suites.
- `corepack pnpm@11.15.1 test:integration` — real PostgreSQL integration tests.
- `corepack pnpm@11.15.1 test:e2e` — clean build and API lifecycle tests.
- `corepack pnpm@11.15.1 test:coverage` — aggregate Docker-backed coverage.
- `corepack pnpm@11.15.1 architecture:check` — dependency graph and public-entrypoint rules.
- `corepack pnpm@11.15.1 generate:module <kebab-case-name>` — subject-neutral module shell.

## Git flow

Feature branches start from `stage` and merge into `stage` through a regular
merge pull request. `main` advances from `stage` by fast-forward only.
