# Slice 05 execution evidence: OpenAPI and Swagger contracts

## Tested implementation

- Date: 2026-07-22 (Asia/Yekaterinburg).
- Branch: `feat/openapi-swagger-contracts`.
- `testedImplementationHead`:
  `a8b87a2cc3ce718507b7e9b8898b5a203e067a8c`.
- Target at verification time: `origin/stage` at
  `bc79fab7e042603a4d9f5466b68c29950dee1d5e`.
- The frozen install was already up to date and did not change
  `pnpm-lock.yaml`.
- Node.js: `24.18.0`; pnpm: `11.15.1`; Docker Engine: `29.4.3`.
- Native production `tsc`: `7.0.2`; compatibility CLI/API: `6.0.3` from the
  exact `npm:@typescript/typescript6@6.0.2` package alias.
- Nest Swagger: `11.4.6`; Redocly CLI: `2.40.0`; Hey API OpenAPI TS:
  `0.99.0`; `openapi-diff`: `0.24.1`; `openapi-response-validator`: `12.1.3`.

The existing nvm installation was activated for every verification command; its
global default was not changed.

## Canonical artifact

Two consecutive `openapi:generate` runs produced byte-identical output:

```text
SHA-256: 2213d5ff39ea210c03146b2316172344921414c94619eb3be617732bba06bf81
Bytes:   69360
Lines:   1990
Operations: 11 with stable unique operationId values
```

`openapi:drift`, Redocly lint, operation metadata and the generated Fetch client
smoke check all passed. Generation did not leave an artifact diff. The dedicated
offline e2e suite passed 1 suite/3 tests; its spies prove that generation invoked
neither `Server.listen`, `StartupRegistry.startAll`, Prisma connect nor Redis
connect. The in-memory Nest application is closed on success and failure.

The committed artifact is the first OpenAPI contract in this repository. Its
diff from the target adds 1,894 lines; the exact dependency review adds only
`@nestjs/swagger@11.4.6`, `@hey-api/openapi-ts@0.99.0`,
`@redocly/cli@2.40.0`, `openapi-diff@0.24.1` and
`openapi-response-validator@12.1.3`, plus their frozen transitive lock data.
`starter.manifest.json` has no artifact inventory field, so it required no
change and its gate remained green.

## Breaking-base result

The required target comparison was executed both directly and through full
`check`:

```text
corepack pnpm@11.15.1 openapi:breaking -- --base-ref origin/stage
OPENAPI_BREAKING_BASE_REF=origin/stage corepack pnpm@11.15.1 check

OpenAPI breaking base Git artifact is unavailable
exit code: 1
```

This is the intentional fail-closed result: target commit
`bc79fab7e042603a4d9f5466b68c29950dee1d5e` does not contain
`docs/api/openapi.json`. No implicit base, empty contract, working-tree fallback
or first-contract exception was introduced. After this slice is merged, later
feature branches can compare normally with updated `origin/stage`.

To exercise the remainder of the aggregate chain without misrepresenting that
target result, local cumulative verification used the explicit Git-free file
interface:

```text
OPENAPI_BREAKING_BASE_FILE=docs/api/openapi.json \
  TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
```

This self-file comparison certifies gate wiring and the subsequent suites only;
it is not evidence of compatibility with `origin/stage`.

## Automated acceptance

The final local worktree passed:

```text
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 openapi:generate   # twice
corepack pnpm@11.15.1 openapi:drift
corepack pnpm@11.15.1 openapi:lint
corepack pnpm@11.15.1 openapi:operations
corepack pnpm@11.15.1 openapi:client:check
corepack pnpm@11.15.1 check:quick
OPENAPI_BREAKING_BASE_FILE=docs/api/openapi.json \
  TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 check
git diff --check
```

Final successful gate counts after review hardening:

- unit: 70 suites, 452 tests;
- generator: 3 suites, 52 tests;
- generator golden: 2 suites, 2 tests;
- architecture: 1 suite, 44 tests;
- OpenAPI response conformance: 2 suites, 12 tests;
- real PostgreSQL/Redis integration: 12 suites, 54 tests;
- API/health/auth/docs e2e: 26 suites, 82 tests;
- aggregate runtime coverage: 108 suites, 588 tests.

Coverage exceeded the global 80/80/80/75 gate:

```text
Statements: 90.56% (9225/10186)
Functions:  88.71% (519/585)
Lines:      90.56% (9225/10186)
Branches:   85.97% (1410/1640)
```

The collected-path auth branch thresholds also passed:

```text
auth application:            90.68% (146/161)
auth session infrastructure: 90.91% (80/88)
auth presentation guards:    91.80% (56/61)
```

Architecture checks found no violation across 196 source modules and 581
dependencies. Production build, Prisma validation/generation, TypeScript 7
source/test checks, lint, TSDoc and manifest checks passed inside `check:quick`.

## Runtime and conformance evidence

The response gate validates every canonical health/auth operation by
`operationId`, status and media schema. It covers dynamic health maps, RFC 3339
date-time values, a path parameter, nested session lists and empty 204 bodies.
The problem suite exercises real 400/401/403/404/413/415/422/429/500/503
responses, exact `application/problem+json`, and exhaustive parity between
`PROBLEM_REGISTRY`, `ProblemResponseDto.code`, OpenAPI components and
`docs/api/problem-types.md`.

Runtime e2e proves `off`, `public` and `protected` publication. Protected mode
requires a valid session plus `system.docs.read`; denied requests receive RFC
9457 and one final correlated access log. Swagger UI uses only local assets,
loads `/openapi.json`, sends browser credentials, does not persist authorization
and has no cookie-reading interceptor. Alternate JSON/YAML routes are absent.
Production rejects public mode during environment validation.

## Verification corrections

The first quick run exposed two repository reproducibility issues, both fixed
and rechecked rather than bypassed:

- Prettier reformatted one array in `check-generated-client.ts`; its focused
  client generation/TypeScript 7 compilation passed afterward.
- The golden architecture script used `cd test/...`. With the user's valid
  `CDPATH`, POSIX `sh` searched only configured roots and failed to enter the
  existing fixture. `cd ./test/...` now bypasses `CDPATH`; the exact gate passed
  with the real environment value and again inside both aggregate runs.

Review hardening added five regression boundaries and re-ran the complete gate:

- `authLogin` now declares the real trusted-origin 403 response; non-JSON unsafe
  requests throw a framework 415 that the global problem filter maps to the
  canonical `UNSUPPORTED_MEDIA_TYPE` document.
- Offline generation uses a production-valid immutable configuration, so the
  reviewed cookie security scheme names `__Host-session`.
- The docs permission adapter and its tests live in `presentation`; `composition`
  contains only dependency-injection wiring.
- `check:quick` validates and generates Prisma before loading the OpenAPI
  application graph. The gate passed after the ignored `src/generated/prisma`
  directory was moved out of the checkout, proving the fresh-checkout order.
- `OPENAPI_BREAKING_BASE_REF=40f57e5` reported no breaking changes; the generated
  Fetch client, 12-response conformance suite, integration, e2e and coverage
  gates all exited successfully.

The sandbox also rejected `tsx`'s local IPC Unix socket with `EPERM`. Evidence
commands were rerun outside that sandbox with the same repository, Node and
dependency state; this did not require a code or assertion change.

Dependency/artifact diffs and `git diff --check` were reviewed. After the
separate evidence commit, `git status --short` is expected to be empty. These
review-hardening commits update the existing PR #7; no merge or deployment is
part of this evidence commit.
