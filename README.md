# NestJS Starter

Reusable production backend foundation. The repository is intentionally built
slice by slice; the current foundation compiles a NestJS composition shell but
does not start an HTTP process.

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
- `corepack pnpm@11.15.1 check:quick` — run every quick check applicable to the current
  foundation.

## Current boundary

Included: exact toolchain, strict TypeScript, documented five-layer topology,
tested dependency policy, validated starter manifest and safe module generator.

Not included: HTTP runtime, database, Redis, authentication,
errors/logging/telemetry, OpenAPI, containers, deployment and recipes.

## Git flow

Feature branches start from `stage` and merge into `stage` through a regular
merge pull request. `main` is advanced from `stage` with fast-forward only.
