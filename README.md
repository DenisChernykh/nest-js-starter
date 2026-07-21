# NestJS Starter

Reusable production backend foundation. The current runtime exposes a hardened
NestJS API process with typed configuration, PostgreSQL/Prisma lifecycle,
transaction boundaries and explicit health contracts.

## Foundation commands

- `corepack pnpm@11.15.1 install --frozen-lockfile` — reproduce exact dependencies.
- `corepack pnpm@11.15.1 test` — run unit, generator and architecture policy suites.
- `corepack pnpm@11.15.1 typecheck` — check production and tooling/test TypeScript.
- `corepack pnpm@11.15.1 architecture:check` — validate the real dependency graph and module
  public-entrypoint rules.
- `corepack pnpm@11.15.1 manifest:check` — validate portable starter metadata without Git.
- `corepack pnpm@11.15.1 generate:module <kebab-case-name>` — create a subject-neutral
  five-layer module shell.
- `corepack pnpm@11.15.1 build` — compile production source.
- `corepack pnpm@11.15.1 dev:api` — generate Prisma Client and run the API watcher.
- `corepack pnpm@11.15.1 start:migrate` — deploy committed migrations as a separate job.
- `corepack pnpm@11.15.1 start:api` — run the compiled API without hidden migration work.
- `corepack pnpm@11.15.1 check:quick` — run every quick check applicable to the current
  foundation.

## Current boundary

Included: exact toolchain, strict TypeScript, documented five-layer topology,
tested dependency policy, validated starter manifest, safe module generator,
typed runtime configuration, explicit PostgreSQL lifecycle, transaction port,
health endpoints and hardened HTTP bootstrap.

Not included: Amazing EKB business logic, Redis, authentication,
errors/logging/telemetry, OpenAPI, containers, deployment and recipes.

## Git flow

Feature branches start from `stage` and merge into `stage` through a regular
merge pull request. `main` is advanced from `stage` with fast-forward only.
