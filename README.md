# NestJS Starter

Reusable production backend foundation. The repository is intentionally built
slice by slice; the current foundation compiles a NestJS composition shell but
does not start an HTTP process.

## Foundation commands

- `corepack pnpm@11.15.1 install --frozen-lockfile` — reproduce exact dependencies.
- `corepack pnpm@11.15.1 test:unit` — verify the compile-only composition shell.
- `corepack pnpm@11.15.1 typecheck` — check production and tooling/test TypeScript.
- `corepack pnpm@11.15.1 build` — compile production source.

## Current boundary

Included at this commit: exact toolchain, strict TypeScript and documented
module topology. The remaining tasks in this slice add the tested architecture
policy, starter manifest and module generator.

Not included in this slice: HTTP runtime, database, Redis, authentication,
errors/logging/telemetry, OpenAPI, containers, deployment and recipes.

## Git flow

Feature branches start from `stage` and merge into `stage` through a regular
merge pull request. `main` is advanced from `stage` with fast-forward only.
