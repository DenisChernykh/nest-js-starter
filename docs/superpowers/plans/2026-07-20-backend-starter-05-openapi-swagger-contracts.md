# NestJS Starter OpenAPI, Swagger UI And Contract Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` inline task-by-task. This repository execution
> explicitly forbids subagents. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Добавить детерминированный code-first OpenAPI contract, управляемый
Swagger UI и полный набор contract gates без отдельного TypeScript compiler
pipeline и без сетевых side effects при генерации.

**Architecture:** Presentation controllers и DTO содержат явную Swagger
metadata и остаются source of truth. Contract bootstrap создаёт тот же
`ApiModule` graph, применяет только route metadata, не открывает listener и не
запускает lifecycle PostgreSQL/Redis. Platform docs adapter строит один
канонический document и обслуживает `/docs`/`/openapi.json`; защищённый режим
зависит от framework-neutral `DocsAccessPolicy`, реализованного auth composition
adapter. Contract scripts работают с локальными файлами, сортируют JSON и
завершаются явным exit code.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, native TypeScript 7, NestJS 11,
`@nestjs/swagger` 11, Redocly CLI 2, OpenAPI Diff, Hey API OpenAPI TypeScript,
Jest 30, Supertest 7.

## Global Constraints

- Выполнять работу inline одним агентом; не использовать SDD, subagents или
  parallel agent work.
- Feature branch создаётся от актуального `stage`; изменения вливаются в
  `stage` обычным merge PR. `main` продвигается только fast-forward от `stage`.
- Перед installation повторить official registry `latest`, Node engines и
  peers. Direct dependencies содержат exact pins без `latest`, `^` и `~`.
- Если refreshed stable version конфликтует с Node 24.18.0, NestJS 11 или
  native TypeScript 7, остановиться для отдельного compatibility-решения;
  молчаливый downgrade и возврат production build на TypeScript 5 запрещены.
- Swagger metadata задаётся явными decorators. Nest Swagger CLI plugin и
  custom transformer не входят ни в production build, ни в contract build.
- Первый dependency commit отделён от behavior commits и меняет только
  manifest/lockfile плюс compatibility evidence.
- Сохранить module-local hexagonal boundaries из
  `docs/architecture/module-boundaries.md`. Platform не импортирует auth;
  bootstrap импортирует module code только через `composition`.
- Не добавлять business CRUD, JWT/OAuth, Redis abstractions, queues, Docker,
  CI/CD, GHCR, Dokploy или deployment mutation.
- Канонический артефакт — `docs/api/openapi.json`; YAML-копия не создаётся.
- Offline generation не слушает port, не подключается к PostgreSQL/Redis и не
  зависит от remote URL, clock, hostname, Git metadata или process secrets.
- OpenAPI generation использует полный controller/DTO graph текущего API.
  Отдельная вручную поддерживаемая копия endpoint schema запрещена.
- Каждый operation получает явный стабильный уникальный `operationId`.
- Enums, formats, examples, nullable semantics, request/response containers,
  security requirements и RFC 9457 responses описываются явно.
- `/health/*`, `/docs`, `/docs/*` и `/openapi.json` остаются вне `/v1`.
- `API_DOCS_MODE=off|public|protected`: development/test default `public`,
  production default `off`, production `public` rejected. Stage deployment в
  Task 7 обязан явно задать `protected`, поскольку `NODE_ENV=production` не
  различает stage и production.
- Protected docs требуют действующую HttpOnly session и permission
  `system.docs.read`. Docs middleware не подменяет guards бизнес-endpoints.
- Swagger UI использует `withCredentials=true`, выключает
  `persistAuthorization` и не содержит JavaScript, читающего/устанавливающего
  session cookie. CSRF вводится пользователем через `X-CSRF-Token` scheme.
- Docs denial публикует finite audit event без cookie/token/email/IP.
- Breaking gate принимает явный target spec/ref. Неуспешное получение base
  contract не превращается в pass.
- Все hand-written exported TypeScript contracts получают TSDoc согласно
  `docs/architecture/tsdoc-guidelines.md` в том же commit.
- `pnpm check:quick` включает generation/drift/lint/operationId gates и
  production build. Полный `pnpm check` дополнительно включает breaking diff,
  response conformance и generated-client compilation.

---

## Planning snapshot на 2026-07-21

Task 0 обязан повторить registry queries перед installation.

| Package                      | Stable candidate | Compatibility evidence                                          |
| ---------------------------- | ---------------: | --------------------------------------------------------------- |
| `@nestjs/swagger`            |         `11.4.6` | peers Nest `^11.0.1`; supplies `swagger-ui-dist` 5.32.8         |
| `@redocly/cli`               |         `2.40.0` | Node `>=22.12`; offline local-file lint                         |
| `openapi-diff`               |         `0.24.1` | Node `>=18`; OpenAPI 3 breaking/non-breaking classification     |
| `openapi-response-validator` |         `12.1.3` | bundled TypeScript declarations; AJV-backed response validation |
| `@hey-api/openapi-ts`        |         `0.99.0` | Node `>=22.18`; TypeScript peer admits `>=6`, including 7       |

`openapi-typescript@7.13.0` исключён: его current peer требует TypeScript `^5`.
`@hey-api/client-fetch@0.13.1` исключён после Task 0 refresh: registry install
metadata помечает package deprecated, потому что Fetch client plugin уже встроен
в `@hey-api/openapi-ts`.
`swagger-ui-express` исключён: Nest Swagger 11 сам поставляет и обслуживает
`swagger-ui-dist`, поэтому отдельный Express wrapper расширил бы dependency
surface без capability gain.

## Result Boundary

После Slice 5 доступны:

- explicit Swagger metadata для health/auth controllers и всех DTO;
- канонический byte-stable `docs/api/openapi.json`;
- offline generation и drift/structural/operationId gates;
- explicit target-branch breaking diff;
- generated Fetch client/type compilation smoke;
- e2e response conformance, включая RFC 9457 content type/schema;
- `/docs` и `/openapi.json` в off/public/protected modes;
- session + `system.docs.read` access policy и docs denial audit.

Не входят frontend client publication, remote spec hosting, CI workflow,
container image, deployment environment mutation или production Swagger enable.

## Normative Contracts

```ts
export type ApiDocsMode = 'off' | 'public' | 'protected'

export interface ApiDocsRuntimeConfig {
  readonly mode: ApiDocsMode
}

export type DocsAccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly problemCode:
        | 'AUTHENTICATION_REQUIRED'
        | 'AUTHORIZATION_DENIED'
        | 'DEPENDENCY_UNAVAILABLE'
    }

export interface DocsAccessPolicy {
  authorize(
    cookieHeader: string | undefined,
    nowMs: number,
  ): Promise<DocsAccessDecision>
}
```

The platform-owned middleware consumes only `DocsAccessPolicy`. Auth composition
owns cookie parsing, session authentication, permission lookup and audit. The
middleware writes the registered RFC 9457 problem using current request ID and
never receives a raw token in its decision result.

Canonical operations:

```text
healthLive
healthStartup
healthReady
authLogin
authLogout
authGetMe
authGetCsrfToken
authChangePassword
authListSessions
authRevokeSession
authLogoutAll
```

Security schemes:

```text
sessionCookie: apiKey in cookie, runtime-configured cookie name
csrfToken: apiKey in header, X-CSRF-Token
```

The committed document uses the starter development cookie name. Runtime
production cookie renaming does not mutate the committed artifact; the HTTP
semantics remain the same and runtime UI documentation is generated from the
validated runtime config.

---

### Task 0: Repeat preflight and dependency compatibility checks

**Files:**

- Read: `AGENTS.md`
- Read: `docs/architecture/module-boundaries.md`
- Read: `docs/architecture/tsdoc-guidelines.md`
- Read: this plan and the approved master design
- Verify: Git, Node, pnpm, registry metadata and official documentation

- [ ] Confirm clean `stage`, fetch/sync `origin/stage`, ensure `origin/main` is
      an ancestor and create `feat/openapi-swagger-contracts` from updated
      `stage`.
- [ ] Confirm exact Node `24.18.0` and pnpm `11.15.1` without changing global
      defaults unnecessarily.
- [ ] Use Context7 official NestJS OpenAPI docs for `createDocument`, explicit
      decorators, document options, custom JSON URL and Swagger UI options.
- [ ] Query official npm registry for every package in the planning snapshot;
      record stable version, dist-tag, engines and peers.
- [ ] Reject prereleases, TypeScript 5-only generators and any new peer
      mismatch. Update this plan only if a normative compatibility decision
      changes.

Commands:

```bash
git status --short --branch
git fetch origin
git switch stage
git merge --ff-only origin/stage
git merge-base --is-ancestor origin/main stage
node --version
corepack pnpm@11.15.1 --version
npm view @nestjs/swagger version dist-tags peerDependencies engines --json
npm view @redocly/cli version dist-tags peerDependencies engines --json
npm view openapi-diff version dist-tags peerDependencies engines --json
npm view openapi-response-validator version dist-tags peerDependencies engines --json
npm view @hey-api/openapi-ts version dist-tags peerDependencies engines --json
npm view @hey-api/client-fetch version dist-tags peerDependencies engines --json
git switch -c feat/openapi-swagger-contracts
```

Expected: feature branch starts exactly from current `stage`; all chosen direct
dependencies have stable exact compatible versions.

### Task 1: Pin the Swagger and contract toolchain

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify if needed: `scripts/toolchain/check-typescript-bridge.ts`
- Test: `test/unit/toolchain/typescript-bridge.spec.ts`

- [ ] RED: extend toolchain tests to reject a Swagger CLI plugin/transformer
      configuration and to prove all new direct specs are exact stable pins.
- [ ] Install `@nestjs/swagger` as runtime dependency and Redocly, OpenAPI Diff,
      response validator and Hey API generator as dev dependencies.
- [ ] Do not add Nest CLI, Swagger CLI plugin, `swagger-ui-express` or
      `openapi-typescript`.
- [ ] GREEN: run the narrow toolchain test and frozen install.
- [ ] Commit dependency baseline separately.

Commands:

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/toolchain/typescript-bridge.spec.ts
corepack pnpm@11.15.1 add --save-exact @nestjs/swagger@<refreshed>
corepack pnpm@11.15.1 add --save-dev --save-exact @redocly/cli@<refreshed> openapi-diff@<refreshed> openapi-response-validator@<refreshed> @hey-api/openapi-ts@<refreshed>
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 run toolchain:check
git add package.json pnpm-lock.yaml scripts/toolchain/check-typescript-bridge.ts test/unit/toolchain/typescript-bridge.spec.ts
git commit -m "build(openapi): pin contract toolchain"
```

### Task 2: Add typed docs-mode configuration

**Files:**

- Modify: `src/platform/config/runtime-config.types.ts`
- Modify: `src/platform/config/runtime-environment.schema.ts`
- Modify: `src/platform/config/runtime-environment.ts`
- Modify: `src/platform/config/runtime-config.service.ts`
- Modify: `.env.example`
- Modify: `test/support/required-runtime-environment.ts`
- Modify: `test/unit/platform/config/runtime-environment.spec.ts`
- Modify: `test/unit/platform/config/runtime-config.service.spec.ts`

- [ ] RED: test development/test `public`, production `off`, explicit
      `off|public|protected`, invalid value rejection and production-public
      startup rejection without echoing rejected values.
- [ ] Add `ApiDocsMode`, `ApiDocsRuntimeConfig` and `docs` projection to the
      complete runtime config/service with TSDoc.
- [ ] Keep PostgreSQL-only command config free from docs settings.
- [ ] Document stage's required explicit `API_DOCS_MODE=protected`; do not add
      a second deployment-environment variable in this slice.
- [ ] GREEN: run config unit tests, typecheck and format check for touched files.

Commit:

```bash
git commit -m "feat(config): define api documentation modes"
```

### Task 3: Make presentation contracts runtime-visible

**Files:**

- Modify: `src/modules/auth/presentation/auth.dto.ts`
- Modify: `src/modules/auth/presentation/auth.controller.ts`
- Create: `src/modules/auth/presentation/auth-response.dto.ts`
- Modify: `src/platform/http/health/health.controller.ts`
- Create: `src/platform/http/health/health-response.dto.ts`
- Create: `src/platform/http/docs/problem-response.dto.ts`
- Create: `src/platform/http/docs/api-problem-responses.decorator.ts`
- Test: `test/unit/platform/http/docs/presentation-metadata.spec.ts`

- [ ] RED: scan reflected controller metadata and fail for missing explicit
      operationId, response status/schema, request/path schema, tags or security
      declarations.
- [ ] Replace erased response interfaces/inline return shapes at the HTTP
      boundary with decorated response DTO classes while keeping application
      contracts framework-free.
- [ ] Add explicit `ApiProperty` metadata for formats, lengths, examples,
      required/optional fields and date-time strings. Avoid relying on design
      type metadata for arrays, enums or nested objects.
- [ ] Add explicit `ApiOperation({ operationId })`, tags, status/content schemas
      and session/CSRF requirements to every endpoint.
- [ ] Model health 200/503 unions and stable dependency-check map without
      claiming a closed set of future recipe indicators.
- [ ] Model RFC 9457 base/validation DTO and derive reusable response decorators
      from `PROBLEM_REGISTRY`; keep `application/problem+json` explicit.
- [ ] Ensure 204 operations contain no response body schema.
- [ ] GREEN: run the metadata unit test and existing auth/health controller e2e
      tests.

Commit:

```bash
git commit -m "feat(openapi): describe http presentation contracts"
```

### Task 4: Build one deterministic OpenAPI document factory

**Files:**

- Create: `src/platform/http/docs/openapi-document.ts`
- Create: `src/platform/http/docs/openapi-normalizer.ts`
- Create: `src/bootstrap/contracts/openapi-runtime-config.ts`
- Create: `src/bootstrap/contracts/generate-openapi.ts`
- Create: `scripts/openapi/write-openapi.ts`
- Modify: `src/platform/http/docs/README.md`
- Test: `test/unit/platform/http/docs/openapi-normalizer.spec.ts`
- Test: `test/e2e/openapi/offline-generation.e2e.spec.ts`

- [ ] RED: assert recursive object-key sorting, preserved array order, terminal
      newline, explicit exit failure and byte-identical repeated output.
- [ ] Implement one document builder with fixed title/version, OpenAPI 3 output,
      stable tags/security schemes and `autoTagControllers=false`.
- [ ] Apply the production global prefix rules before document creation so
      health remains unprefixed and application endpoints appear under `/v1`.
- [ ] Contract bootstrap uses `ApiModule.forRoot` with fixed non-secret config,
      creates a Nest application without `listen`, never calls startup
      registries, writes canonical JSON and always closes the in-memory app.
- [ ] Prove generation succeeds with PostgreSQL/Redis URLs on closed port 1 and
      that connect methods/listener are never called.
- [ ] Avoid `process.exit()` in reusable functions; CLI entrypoint assigns
      `process.exitCode` after awaited completion/failure.
- [ ] GREEN: run normalizer unit and offline e2e tests twice and compare hashes.

Commands:

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand test/unit/platform/http/docs/openapi-normalizer.spec.ts
corepack pnpm@11.15.1 exec jest --config jest.e2e.config.mjs --runInBand test/e2e/openapi/offline-generation.e2e.spec.ts
corepack pnpm@11.15.1 exec tsx scripts/openapi/write-openapi.ts --output /tmp/nest-js-starter-openapi-a.json
corepack pnpm@11.15.1 exec tsx scripts/openapi/write-openapi.ts --output /tmp/nest-js-starter-openapi-b.json
cmp /tmp/nest-js-starter-openapi-a.json /tmp/nest-js-starter-openapi-b.json
```

Commit:

```bash
git commit -m "feat(openapi): generate deterministic contract offline"
```

### Task 5: Commit the canonical artifact and fast contract gates

**Files:**

- Create: `docs/api/openapi.json`
- Create: `redocly.yaml`
- Create: `scripts/openapi/check-openapi-drift.ts`
- Create: `scripts/openapi/check-openapi-operations.ts`
- Modify: `package.json`
- Test: `test/unit/scripts/openapi/check-openapi-drift.spec.ts`
- Test: `test/unit/scripts/openapi/check-openapi-operations.spec.ts`

- [ ] RED: drift test rejects a one-byte artifact change; operation test rejects
      missing/duplicate IDs, undocumented method objects and unstable IDs.
- [ ] Add scripts `openapi:generate`, `openapi:drift`, `openapi:lint` and
      `openapi:operations`; use local binaries only.
- [ ] Configure Redocly recommended rules plus explicit operationId, tags,
      response and security expectations. No ignore file or remote registry.
- [ ] Generate and commit the canonical artifact.
- [ ] Run generator twice from clean temp outputs and require exact bytes.
- [ ] Add generation/drift/lint/operations to `check:quick` before build.
- [ ] GREEN: prove positive gate and intentional negative fixtures.

Commit:

```bash
git commit -m "test(openapi): enforce deterministic contract gates"
```

### Task 6: Add explicit target-branch breaking diff

**Files:**

- Create: `scripts/openapi/read-breaking-base.ts`
- Create: `scripts/openapi/check-breaking-openapi.ts`
- Create: `test/fixtures/openapi/breaking/**`
- Test: `test/unit/scripts/openapi/check-breaking-openapi.spec.ts`
- Modify: `package.json`

- [ ] RED: fixtures prove removed path/method/response and tightened request are
      breaking; additive endpoint/property cases are non-breaking.
- [ ] Accept exactly one explicit source: `--base-file <path>`,
      `--base-ref <git-ref>`, `OPENAPI_BREAKING_BASE_FILE` or
      `OPENAPI_BREAKING_BASE_REF`. Reject multiple sources, no source, missing
      artifact and failed `git show`.
- [ ] Materialize base bytes in a private temp directory and invoke the pinned
      OpenAPI Diff Node API without shell interpolation.
- [ ] Keep unclassified differences visible and fail them until reviewed; do
      not silently treat unknown classification as compatible.
- [ ] Add `openapi:breaking` but do not hide a default branch inside the script.
      Local/PR verification passes `--base-ref origin/stage`; aggregate
      `pnpm check` receives `OPENAPI_BREAKING_BASE_REF=origin/stage`; Git-free
      template certification may pass an explicit base file.
- [ ] GREEN: run fixtures and the real stage comparison.

Commit:

```bash
git commit -m "test(openapi): detect breaking contract changes"
```

### Task 7: Compile a generated Fetch client

**Files:**

- Create: `openapi-ts.config.ts`
- Create: `test/fixtures/openapi-client/consumer.ts`
- Create: `test/fixtures/openapi-client/tsconfig.json`
- Create: `scripts/openapi/check-generated-client.ts`
- Test: `test/unit/scripts/openapi/check-generated-client.spec.ts`
- Modify: `package.json`

- [ ] RED: smoke fails for stale/missing output and for a consumer using a
      nonexistent operation or wrong request/response contract.
- [ ] Configure Hey API with local `docs/api/openapi.json`, its bundled Fetch
      client plugin and TypeScript output in an ignored temporary directory.
- [ ] Generate from local bytes only, compile the generated client plus a small
      consumer with native TypeScript 7, then remove output in `finally`.
- [ ] Do not commit generated consumer code; only config and handwritten smoke
      remain tracked.
- [ ] Reject generation that mutates the canonical OpenAPI artifact or any
      source file.
- [ ] GREEN: run client generation/compilation twice.

Commit:

```bash
git commit -m "test(openapi): compile generated fetch client"
```

### Task 8: Implement the protected docs access boundary

**Files:**

- Create: `src/platform/http/docs/docs-access.contracts.ts`
- Create: `src/platform/http/docs/docs-access.middleware.ts`
- Create: `src/modules/auth/composition/docs-access-policy.adapter.ts`
- Modify: `src/modules/auth/composition/auth.module.ts`
- Refactor: `src/modules/auth/presentation/authentication.guard.ts`
- Create or modify: canonical session-cookie parser in auth presentation
- Modify: `src/modules/auth/application/auth-audit.port.ts`
- Modify: `src/platform/logging/auth-audit.logger.ts`
- Test: `test/unit/platform/http/docs/docs-access.middleware.spec.ts`
- Test: `test/unit/modules/auth/composition/docs-access-policy.adapter.spec.ts`
- Modify: `test/unit/platform/logging/auth-audit.logger.spec.ts`

- [ ] RED: cover missing/malformed/duplicate cookie, expired session,
      dependency outage, valid session without permission and authorized admin.
- [ ] Extract canonical cookie parsing so the global guard and docs adapter use
      exactly the same token rules.
- [ ] Auth adapter calls `AuthenticateSessionUseCase`, checks the branded
      `system.docs.read` permission and returns only the finite decision.
- [ ] Emit `docs_access|denied|AUTHENTICATION_REQUIRED`,
      `AUTHORIZATION_DENIED` or `DEPENDENCY_UNAVAILABLE`; include actor/session
      only after successful authentication.
- [ ] Platform middleware matches `/docs`, `/docs/` and descendants plus exact
      `/openapi.json`; near misses such as `/documentation` do not match.
- [ ] Middleware writes RFC 9457 with the current request ID and
      `application/problem+json`, without leaking cookie or auth exception.
- [ ] Public mode bypasses policy construction/use; off mode registers no docs
      middleware or routes.
- [ ] GREEN: run policy, middleware, audit and existing auth guard tests.

Commit:

```bash
git commit -m "feat(openapi): protect documentation routes"
```

### Task 9: Serve Swagger UI and raw JSON by mode

**Files:**

- Create: `src/platform/http/docs/configure-api-docs.ts`
- Modify: `src/bootstrap/api/configure-api.ts`
- Modify: `src/bootstrap/api/api.module.ts` if composition export is needed
- Test: `test/e2e/openapi/docs-access.e2e.spec.ts`
- Test: `test/e2e/openapi/swagger-ui.e2e.spec.ts`

- [ ] RED: prove off returns 404, public serves all exact docs routes,
      protected returns 401/403/503 correctly and authorized admin receives UI
      and JSON.
- [ ] Configure docs after request context/access logging middleware and before
      `app.init`; never open an extra listener.
- [ ] Serve raw JSON only at `/openapi.json`; disable Nest's default YAML and
      `<path>-json` routes.
- [ ] Configure `withCredentials=true`, `persistAuthorization=false`, no
      request interceptor that reads cookies, and no external CDN assets.
- [ ] Verify Swagger HTML references `/openapi.json`, contains no session token
      or secret and exposes the CSRF header scheme.
- [ ] Verify docs access requests receive request IDs and one final access log.
- [ ] GREEN: run docs access/UI e2e suites in each mode.

Commit:

```bash
git commit -m "feat(openapi): serve policy-controlled swagger ui"
```

### Task 10: Prove response conformance and RFC 9457 coverage

**Files:**

- Create: `test/e2e/openapi/openapi-response-conformance.e2e.spec.ts`
- Create: `test/e2e/openapi/openapi-problem-conformance.e2e.spec.ts`
- Create: `test/e2e/openapi/openapi-test-harness.ts`
- Modify: `docs/api/problem-types.md`
- Modify: `package.json`

- [ ] Build a validator from the committed local document and validate real
      health/auth success responses against operation/status/content schemas.
- [ ] Validate representative 400/401/403/404/413/415/422/429/500/503 responses
      and exact `application/problem+json` content type.
- [ ] Assert every `PROBLEM_REGISTRY` definition appears in OpenAPI components
      and `docs/api/problem-types.md`, and no undocumented code appears.
- [ ] Exercise date-time, path parameter, nested session lists, empty 204 and
      dynamic health check maps.
- [ ] Keep real auth dependency scenarios in existing Testcontainers suites;
      reuse their harness rather than creating another database/Redis lifecycle.
- [ ] Add conformance and generated-client checks to full `pnpm check`.
- [ ] GREEN: run narrow OpenAPI e2e, then all e2e.

Commit:

```bash
git commit -m "test(openapi): verify live response conformance"
```

### Task 11: Documentation, cumulative verification and evidence

**Files:**

- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/api/problem-types.md`
- Create: `docs/architecture/openapi-contracts.md`
- Create: `docs/execution/slice-05-openapi-swagger-contracts.md`
- Modify: `starter.manifest.json` only if its documented artifact inventory
  requires the OpenAPI file

- [ ] Document normal developer commands separately from CI/internal scripts:
      generation, drift, lint, target-base diff and client smoke.
- [ ] Document public/protected/off behavior, stage explicit protected setting,
      production prohibition and secure Try it out flow.
- [ ] Explain controller/DTO source of truth, offline graph, artifact review and
      frontend pinning to a commit/release/sibling path.
- [ ] Run TSDoc/lint/format/type/build and architecture gates.
- [ ] Run `pnpm check:quick` and full `pnpm check` with explicit
      `origin/stage` breaking base.
- [ ] Run generation twice and record byte hash, test counts, build result and
      proof that no listener/database/Redis connection occurred.
- [ ] Review `git diff --check`, dependency diff, artifact diff and clean status.
- [ ] Commit reproducible evidence separately.

Commands:

```bash
corepack pnpm@11.15.1 run openapi:generate
corepack pnpm@11.15.1 run openapi:drift
corepack pnpm@11.15.1 run openapi:lint
corepack pnpm@11.15.1 run openapi:operations
corepack pnpm@11.15.1 run openapi:breaking -- --base-ref origin/stage
corepack pnpm@11.15.1 run openapi:client:check
corepack pnpm@11.15.1 run check:quick
OPENAPI_BREAKING_BASE_REF=origin/stage corepack pnpm@11.15.1 run check
git diff --check
git status --short
```

Commit:

```bash
git commit -m "docs(openapi): record slice 5 evidence"
```

## Final Review Checklist

- [ ] Explicit decorators are the only Swagger metadata source; no Nest CLI
      plugin/transformer or TypeScript 5 build was introduced.
- [ ] Every operation has one stable unique operationId and explicit response
      contract/security metadata.
- [ ] Canonical JSON generation is byte-identical, offline and listener-free.
- [ ] PostgreSQL/Redis startup registries are not invoked by generation.
- [ ] Drift, Redocly lint, operationId, explicit-base breaking diff, generated
      client and response conformance gates all fail on reviewed negative cases.
- [ ] RFC 9457 registry, documentation and OpenAPI components are exhaustive.
- [ ] Off/public/protected modes and production-public rejection are tested.
- [ ] Protected docs require session + `system.docs.read`; denied access is
      audited without secrets.
- [ ] Swagger UI sends credentials, accepts explicit CSRF header and neither
      reads nor persists the HttpOnly session cookie.
- [ ] Platform does not import auth; bootstrap imports auth only through
      composition; application/domain remain framework-free.
- [ ] Every hand-written exported TypeScript contract has accurate TSDoc.
- [ ] Frozen install, `pnpm check:quick`, full `pnpm check`, coverage, build and
      clean Git status are recorded from the implementation branch.
- [ ] Push `feat/openapi-swagger-contracts`, create a regular PR into `stage`,
      copy concise evidence into PR and do not merge/deploy without a separate
      user request.

## Plan Approval Checkpoint

Implementation begins only after this plan is committed, published in a regular
PR to `stage`, merged, and explicitly approved for inline execution.
