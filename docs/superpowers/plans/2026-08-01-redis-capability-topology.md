# Redis Capability Topology Implementation Plan

> **Executor:** one continuous execution task. Milestones 1-2.6 were executed
> by `gpt-5.6-luna` with `max` reasoning. The repeated implementation/typecheck
> blocker recorded in Corrective Milestone 2.7 activates the agreed switch of
> this same task to `gpt-5.6-terra` with `xhigh` reasoning. Do not use
> `subagent-driven-development`, do not create subagents and do not split the
> milestones between execution tasks. Execute one accepted milestone at a time
> in this same task.

**Goal:** Atomically rename the starter's required Redis dependency to
`redis-auth`, add an opt-in physical `redis-queue` and provide a reusable
BullMQ producer/worker foundation without introducing any product queue.

**Canonical design:**
[`docs/superpowers/specs/2026-08-01-redis-capability-topology-design.md`](../specs/2026-08-01-redis-capability-topology-design.md).

**Starting point:** use the existing `feat/durable-jobs-capability` checkout.
Its ancestry must contain design commit `b19e496` and the commit that adds this
plan. Do not recreate the branch from `stage`. Work only in
`nest-js-starter`; `backend-codex` is read-only reference material.

**Tech stack:** Node.js `24.18.0`, pnpm `11.15.1`, NestJS `11.1.28`,
`@nestjs/bullmq@11.0.4`, `bullmq@5.79.0`, `ioredis@5.11.1`, Jest `30.4.2`,
Testcontainers Redis `8.8.0-trixie` at the already pinned digest.

## Global execution contract

Before editing:

1. Run `git status -sb`, `git branch --show-current`, `git rev-parse HEAD`,
   `node --version` and `corepack pnpm@11.15.1 --version`.
2. Stop if the branch is not `feat/durable-jobs-capability`, `b19e496` is not
   an ancestor, Node/pnpm do not match, or overlapping user changes exist.
3. Read `AGENTS.md`, the canonical design and this complete plan.
4. Preserve untracked and unrelated files. Do not edit the developer's local
   `.env`.
5. Add or update TSDoc for every changed hand-written exported TypeScript API.
6. Use RED -> GREEN inside each milestone. A focused test must fail for the
   intended missing behavior before the corresponding implementation is added.

The implementation decisions in this plan are closed. Do not add aliases,
generic services, product examples, an outbox, a generator or a default worker.
Do not substitute dependency versions or redesign the runtime config shape.

After each milestone:

1. run only the milestone's focused checks;
2. create exactly its local commit;
3. show outcome, commands, branch, `HEAD` and `git status -sb`;
4. stop until the user says that milestone is accepted and requests the next
   milestone.

Do not push, open a PR, merge, deploy or edit Amazing EKB. `pnpm check:quick`
runs once after the complete code/infrastructure batch in Milestone 3.
`pnpm check` and `pnpm oci:check` run once in Milestone 4.

## Fixed public contracts

The auth rename uses these exact public names:

```text
REDIS_AUTH_URL
redis-auth
redis-auth-data
REDIS_AUTH_PORT
RedisAuthConnectionManager
RedisAuthConnectionConfig.authUrl
REDIS_AUTH_COMMAND_EXECUTOR
readiness name: redis-auth
key capability segment: auth
```

`RedisRuntimeConfig` and `RuntimeConfigService.redis` remain the configuration
namespace for Redis endpoints. Inside that namespace:

```ts
export interface RedisRuntimeConfig {
  readonly authUrl: string
  readonly queueUrl?: string
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly keyPrefix: string
}
```

`SafeRuntimeConfigSummary` replaces the old field with these declarations:

```ts
readonly redisAuthConfigured: boolean
readonly redisQueueConfigured: boolean
```

The auth value is always `true`; the queue value reflects normalized presence.
The summary never exposes either URL.

The queue foundation exports only these hand-written contracts:

```ts
export interface QueueRuntimeConfig {
  readonly redisUrl: string
  readonly connectTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownGraceMs: number
}

export function requireQueueRuntimeConfig(
  config: ApplicationRuntimeConfig,
): QueueRuntimeConfig

export function createBullmqProducerOptions(
  config: QueueRuntimeConfig,
): RedisOptions

export function createBullmqWorkerOptions(
  config: QueueRuntimeConfig,
): RedisOptions

export class BullmqConnectionModule {
  public static forProducer(config: QueueRuntimeConfig): DynamicModule
  public static forWorker(config: QueueRuntimeConfig): DynamicModule
}

export interface QueueReadinessClient {
  waitUntilReady(): Promise<unknown>
}

export class QueueReadinessIndicator implements ReadinessIndicator
```

`QueueReadinessIndicator` has `name = 'redis-queue'`, `required = true` and
constructor `(client: QueueReadinessClient, timeoutMs: number)`. Its
`check(signal)` returns `up` after `waitUntilReady()` and returns redacted
`down` on rejection or abort. It does not create or close a queue.

The worker helper exports these contracts:

```ts
export interface WorkerApplication {
  close(): Promise<void>
}

export type WorkerTerminationWaiter = (
  close: () => Promise<void>,
) => Promise<void>

export interface RunWorkerApplicationInput {
  readonly application: WorkerApplication
  readonly shutdownGraceMs: number
  readonly onStarted: () => void
  readonly waitForTermination?: WorkerTerminationWaiter
}

export function waitForWorkerTermination(
  close: () => Promise<void>,
): Promise<void>

export function runWorkerApplication(
  input: RunWorkerApplicationInput,
): Promise<void>
```

No barrel file and no global `QueueService` are added.

---

## Milestone 1: Atomic `redis-coordination` to `redis-auth` cutover

### Outcome

The required Node Redis capability, config, health contract, key namespace,
local Compose service, OCI smoke and all maintained tests/docs use auth naming.
The same schema also accepts an absent `REDIS_QUEUE_URL` while rejecting logical
databases and an obvious auth/queue endpoint collision.

### Files

Rename:

- `src/platform/redis/redis-coordination.connection.ts` ->
  `src/platform/redis/redis-auth.connection.ts`
- `test/unit/platform/redis/redis-coordination.connection.spec.ts` ->
  `test/unit/platform/redis/redis-auth.connection.spec.ts`
- `docs/runbooks/coordination-redis-loss.md` ->
  `docs/runbooks/auth-redis-loss.md`

Modify configuration and runtime composition:

- `.env.example`
- `package.json`
- `docker-compose.yml`
- `src/platform/config/runtime-config.types.ts`
- `src/platform/config/runtime-defaults.ts`
- `src/platform/config/runtime-environment.schema.ts`
- `src/platform/config/runtime-environment.ts`
- `src/platform/config/runtime-config.service.ts`
- `src/bootstrap/contracts/openapi-runtime-config.ts`
- `src/platform/redis/redis-command.executor.ts`
- `src/platform/redis/redis-lifecycle.ts`
- `src/platform/redis/redis-readiness.indicator.ts`
- `src/platform/redis/redis.module.ts`
- `src/platform/redis/redis.tokens.ts`
- `src/modules/auth/composition/auth.module.ts`
- `src/modules/auth/application/login-rate-limiter.port.ts`
- `src/modules/auth/application/session-store.port.ts`
- `src/modules/auth/infrastructure/redis-login-rate-limiter.ts`
- `src/modules/auth/infrastructure/redis-session.store.ts`

Modify maintained documentation and runtime fixtures:

- `README.md`
- `docs/architecture/foundation-scope.md`
- `docs/architecture/redis-capabilities.md`
- `docs/architecture/runtime-lifecycle.md`
- `docs/roadmap.md`
- `docs/runbooks/deployment-preparation.md`
- `docs/runbooks/deployment-security.md`
- `docs/runbooks/local-development.md`
- `docs/runbooks/postgres-backup-restore.md`
- `docs/runbooks/session-secret-compromise.md`
- `src/platform/http/health/README.md`
- `src/platform/redis/README.md`
- `scripts/oci/run-image-smoke.ts`
- `test/fixtures/oci/docker-compose.image-smoke.yml`

Modify tests and shared test environment:

- `test/support/required-runtime-environment.ts`
- `test/unit/bootstrap/api.module.spec.ts`
- `test/unit/platform/config/runtime-config.service.spec.ts`
- `test/unit/platform/config/runtime-environment.spec.ts`
- `test/unit/platform/redis/redis-lifecycle.spec.ts`
- `test/unit/platform/redis/redis-readiness.indicator.spec.ts`
- `test/unit/ops/local-compose-runtime-contract.spec.ts`
- `test/unit/ops/oci-image-smoke-compose-contract.spec.ts`
- `test/unit/toolchain/standard-nest-development-start.spec.ts`
- `test/integration/platform/redis/redis-lifecycle.integration.spec.ts`
- `test/integration/platform/redis/redis-script.runner.integration.spec.ts`
- `test/integration/modules/auth/redis-login-rate-limiter.integration.spec.ts`
- `test/integration/modules/auth/redis-session.store.integration.spec.ts`
- `test/integration/modules/auth/create-initial-admin.integration.spec.ts`
- `test/integration/modules/auth/create-user.integration.spec.ts`
- `test/integration/modules/auth/prisma-auth.repository.integration.spec.ts`
- `test/integration/modules/approval-requests/prisma-approval-request.repository.integration.spec.ts`
- `test/e2e/support/create-auth-test-runtime.ts`
- `test/e2e/support/create-test-runtime.ts`
- `test/e2e/auth/dependency-failures.e2e.spec.ts`
- `test/e2e/health/health-contract.e2e.spec.ts`
- `test/e2e/health/occupied-port.e2e.spec.ts`
- `test/e2e/health/redis-outage.e2e.spec.ts`
- `test/e2e/health/startup-failure.e2e.spec.ts`
- `test/e2e/migrations/api-does-not-migrate.e2e.spec.ts`
- `test/e2e/openapi/openapi-response-conformance.e2e.spec.ts`
- `test/e2e/shutdown/graceful-shutdown.e2e.spec.ts`
- `test/e2e/shutdown/process-sigterm.e2e.spec.ts`

### Required behavior

1. Replace every live `REDIS_COORDINATION_URL` with `REDIS_AUTH_URL`; the old
   key is unknown input and never read as an alias.
2. Rename the connection manager/config/token exactly as fixed above. Keep
   `RedisModule`, `RedisLifecycle` and `RedisReadinessIndicator`; update their
   TSDoc and dependencies to auth terminology. Readiness reports
   `redis-auth`.
3. Change `RedisRuntimeConfig.coordinationUrl` to `authUrl` and add optional
   `queueUrl`. Add optional `REDIS_QUEUE_URL` to
   `ValidatedRuntimeEnvironment`. Empty queue input normalizes to absence.
4. Rename the safe field to `redisAuthConfigured` and add
   `redisQueueConfigured`. The auth field is always `true`; the queue field
   reflects normalized presence.
5. Redis URL validation accepts only `redis:` and `rediss:`, no query/hash and
   no explicit logical database pathname. Reject `/0` through `/15` in every
   environment for both auth and queue.
6. When queue URL is present, compare endpoint identity as protocol,
   lower-cased hostname and effective port (`6379` when omitted), ignoring
   username/password. Reject equality without retaining or printing either URL.
7. Rename the auth key capability segment from `coordination` to `auth` in both
   auth adapters and integration expectations. Do not change session, rate
   limit, expiry or digest behavior.
8. Rename local Compose service/volume/port input to
   `redis-auth`/`redis-auth-data`/`REDIS_AUTH_PORT`. Use auth-only local
   credentials, keep AOF, `appendfsync always`, `noeviction`, loopback port and
   credential-aware healthcheck. Update API dependency and `dev:down`.
9. Apply the same atomic naming cutover to the OCI fixture/probe. Do not add
   queue Redis to OCI yet.
10. Rename the loss runbook and all maintained links. Historical files under
    `docs/superpowers/specs` and `docs/superpowers/plans` stay unchanged except
    for their existing superseded banners.

### Focused verification

RED/GREEN unit batch:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/config/runtime-environment.spec.ts \
  test/unit/platform/config/runtime-config.service.spec.ts \
  test/unit/platform/redis/redis-auth.connection.spec.ts \
  test/unit/platform/redis/redis-lifecycle.spec.ts \
  test/unit/platform/redis/redis-readiness.indicator.spec.ts \
  test/unit/bootstrap/api.module.spec.ts \
  test/unit/ops/local-compose-runtime-contract.spec.ts \
  test/unit/ops/oci-image-smoke-compose-contract.spec.ts \
  test/unit/toolchain/standard-nest-development-start.spec.ts
```

Focused auth/Redis integration batch:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.integration.config.mjs --runInBand \
  test/integration/platform/redis/redis-lifecycle.integration.spec.ts \
  test/integration/platform/redis/redis-script.runner.integration.spec.ts \
  test/integration/modules/auth/redis-login-rate-limiter.integration.spec.ts \
  test/integration/modules/auth/redis-session.store.integration.spec.ts
```

Focused built-process contract:

```bash
corepack pnpm@11.15.1 run build
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.e2e.config.mjs --runInBand \
  test/e2e/auth/dependency-failures.e2e.spec.ts \
  test/e2e/health/health-contract.e2e.spec.ts \
  test/e2e/health/redis-outage.e2e.spec.ts \
  test/e2e/shutdown/process-sigterm.e2e.spec.ts
```

Negative alias check; expected output is empty:

```bash
rg -n \
  "REDIS_COORDINATION_URL|redis-coordination|RedisCoordination|REDIS_COORDINATION_COMMAND_EXECUTOR|coordinationUrl|coordination:v1|coordination Redis|Redis coordination|coordination-сесс|coordination state|coordination instance" \
  --glob '!docs/superpowers/**' --glob '!node_modules/**'
rg -n "coordination" \
  src/modules/auth src/platform/redis README.md package.json docker-compose.yml \
  .env.example docs/architecture/redis-capabilities.md docs/runbooks
```

Commit when all focused checks are green:

```bash
git add \
  .env.example package.json docker-compose.yml \
  scripts/oci/run-image-smoke.ts \
  src/bootstrap/contracts/openapi-runtime-config.ts \
  src/modules/auth/application/login-rate-limiter.port.ts \
  src/modules/auth/application/session-store.port.ts \
  src/modules/auth/composition/auth.module.ts \
  src/modules/auth/infrastructure/redis-login-rate-limiter.ts \
  src/modules/auth/infrastructure/redis-session.store.ts \
  src/platform/config/runtime-config.types.ts \
  src/platform/config/runtime-defaults.ts \
  src/platform/config/runtime-environment.schema.ts \
  src/platform/config/runtime-environment.ts \
  src/platform/config/runtime-config.service.ts \
  src/platform/http/health/README.md \
  src/platform/redis/README.md \
  src/platform/redis/redis-auth.connection.ts \
  src/platform/redis/redis-coordination.connection.ts \
  src/platform/redis/redis-command.executor.ts \
  src/platform/redis/redis-lifecycle.ts \
  src/platform/redis/redis-readiness.indicator.ts \
  src/platform/redis/redis.module.ts src/platform/redis/redis.tokens.ts \
  README.md docs/architecture docs/roadmap.md docs/runbooks \
  test/e2e test/fixtures/oci/docker-compose.image-smoke.yml \
  test/integration/modules test/integration/platform/redis \
  test/support/required-runtime-environment.ts \
  test/unit/bootstrap/api.module.spec.ts \
  test/unit/ops/local-compose-runtime-contract.spec.ts \
  test/unit/ops/oci-image-smoke-compose-contract.spec.ts \
  test/unit/platform/config/runtime-config.service.spec.ts \
  test/unit/platform/config/runtime-environment.spec.ts \
  test/unit/platform/redis test/unit/toolchain/standard-nest-development-start.spec.ts
git diff --cached --name-only
git commit -m "refactor(redis): rename auth capability"
```

The staged list must contain only paths named by this milestone. If another
path appears, run `git restore --staged -- <exact-unrelated-path>` without
discarding its working-tree content and stop.

Stop and report the milestone packet. Do not continue without acceptance.

---

## Milestone 2: Opt-in BullMQ platform foundation

### Outcome

The starter contains exact BullMQ production dependencies, optional queue
runtime configuration, producer/worker connection policies, queue readiness
and architecture guards. No queue is registered and the default API remains
runtime-inert.

### Files

Modify:

- `package.json`
- `pnpm-lock.yaml`
- `src/platform/config/runtime-defaults.ts`
- `.dependency-cruiser.cjs`
- `test/unit/platform/config/runtime-defaults.spec.ts`
- `test/unit/toolchain/dependency-cruiser-policy.spec.ts`

Create:

- `src/platform/queue/queue-runtime-config.ts`
- `src/platform/queue/bullmq-redis-options.ts`
- `src/platform/queue/bullmq-connection.module.ts`
- `src/platform/queue/queue-readiness.indicator.ts`
- `test/unit/platform/queue/queue-runtime-config.spec.ts`
- `test/unit/platform/queue/bullmq-redis-options.spec.ts`
- `test/unit/platform/queue/bullmq-connection.module.spec.ts`
- `test/unit/platform/queue/queue-readiness.indicator.spec.ts`
- `test/fixtures/dependency-cruiser/application-imports-bullmq/modules/orders/application/use-case.ts`
- `test/fixtures/dependency-cruiser/domain-imports-bullmq/modules/orders/domain/order.ts`
- `test/fixtures/dependency-cruiser/presentation-imports-bullmq/modules/orders/presentation/controller.ts`

### Required behavior

1. Add exact normal production dependencies with:

   ```bash
   corepack pnpm@11.15.1 add --save-exact \
     @nestjs/bullmq@11.0.4 bullmq@5.79.0 ioredis@5.11.1
   ```

2. Add separate immutable queue defaults:
   `connectTimeoutMs = 2_000`, `healthTimeoutMs = 2_500` and
   `shutdownGraceMs = 10_000`. Name the exported interface
   `QueueRuntimeDefaults` and add `readonly queue: QueueRuntimeDefaults` to
   `RuntimeDefaults`. Do not reuse auth shutdown timeout.
3. `requireQueueRuntimeConfig(config)` throws a redacted
   `RuntimeConfigurationError` with issue
   `{ path: 'REDIS_QUEUE_URL', rule: 'any.required' }` when queue URL is absent.
   When present, return a frozen object matching the fixed contract.
4. Parse the already validated URL into ioredis `RedisOptions`: decoded
   username/password, effective port `6379`, and `tls: {}` only for `rediss:`.
   Never return or log the complete URL.
5. Producer options use `maxRetriesPerRequest: 1`; worker options use
   `maxRetriesPerRequest: null`. Both use the queue connect timeout. Do not add
   product attempts, backoff, concurrency, retention or rate limits.
6. `BullmqConnectionModule.forProducer` and `.forWorker` each wrap exactly one
   `BullModule.forRoot({ connection })`. They never call `registerQueue`,
   declare a processor or provide an enqueue service.
7. Queue readiness is required, bounded, redacted and does not own queue
   creation or shutdown.
8. Extend existing dependency-cruiser framework-driver rules so domain,
   application and presentation reject `@nestjs/bullmq`, `bullmq` and
   `ioredis`. Feature infrastructure, feature composition, platform and
   bootstrap may use them.
9. Keep `src/bootstrap/api/api.module.ts` unchanged: it must not import the new
   queue module or require queue configuration.

### Focused verification

Run RED then GREEN:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/queue/queue-runtime-config.spec.ts \
  test/unit/platform/queue/bullmq-redis-options.spec.ts \
  test/unit/platform/queue/bullmq-connection.module.spec.ts \
  test/unit/platform/queue/queue-readiness.indicator.spec.ts \
  test/unit/platform/config/runtime-defaults.spec.ts \
  test/unit/toolchain/dependency-cruiser-policy.spec.ts \
  test/unit/bootstrap/api.module.spec.ts
```

Run a source boundary check; expected queue imports occur only in platform,
bootstrap, feature infrastructure/composition fixtures and tests:

```bash
rg -n "@nestjs/bullmq|from 'bullmq'|from 'ioredis'" src test/fixtures
```

Commit:

```bash
git add package.json pnpm-lock.yaml .dependency-cruiser.cjs \
  src/platform/config/runtime-defaults.ts src/platform/queue \
  test/unit/platform/config/runtime-defaults.spec.ts \
  test/unit/platform/queue test/unit/toolchain/dependency-cruiser-policy.spec.ts \
  test/fixtures/dependency-cruiser/application-imports-bullmq \
  test/fixtures/dependency-cruiser/domain-imports-bullmq \
  test/fixtures/dependency-cruiser/presentation-imports-bullmq
git commit -m "feat(queue): add BullMQ platform foundation"
```

Stop and report the milestone packet. Do not continue without acceptance.

---

## Corrective Milestone 2.5: Restore deterministic install and formatting gates

### Why this correction exists

Milestone 2 introduced `msgpackr-extract@3.0.4` transitively through BullMQ,
but did not record the required pnpm 11 build-script decision. Milestone 1
also left three tracked test files outside the repository's Prettier format,
while local ignored `.superpowers/sdd` reports are still discovered by the
root Prettier scan. These are plan/baseline defects, not Milestone 3
implementation failures and not grounds for a model switch.

Preserve the complete uncommitted Milestone 3 working tree. Do not discard,
stash, stage or rewrite any Milestone 3 path while completing this correction.

### Files

Modify only:

- `pnpm-workspace.yaml`
- `.prettierignore`
- `test/unit/platform/config/runtime-config.service.spec.ts`
- `test/unit/platform/config/runtime-environment.spec.ts`
- `test/unit/platform/redis/redis-auth.connection.spec.ts`

### Required correction

1. Add `msgpackr-extract: false` to `allowBuilds`. It is an optional native
   string-extraction accelerator; the starter does not require native
   acceleration for BullMQ correctness. Do not use `ignore-scripts`,
   `verify-deps-before-run=warn`, an uncommitted pnpm placeholder or
   `msgpackr-extract: true` as a substitute for the explicit deny decision.
2. Add `.superpowers/sdd/` to the root `.prettierignore`. Preserve every local
   file below that directory; do not format, delete or stage those ignored
   agent reports.
3. Run Prettier write on exactly the three tracked Milestone 1 test files named
   above. No semantic edit is allowed.
4. Run the complete root formatting check with the project-pinned Node and
   pnpm. It must pass before the correction commit.

### Verification and commit

Use the project Node binary by prepending its directory to the existing
`PATH`; never replace `PATH` or remove `/usr/local/bin`.

```bash
corepack pnpm@11.15.1 exec prettier --write \
  test/unit/platform/config/runtime-config.service.spec.ts \
  test/unit/platform/config/runtime-environment.spec.ts \
  test/unit/platform/redis/redis-auth.connection.spec.ts
corepack pnpm@11.15.1 run format:check
git diff --check
```

Before committing, the unstaged Milestone 3 paths must still match the state
reported at the end of the failed Milestone 3 attempt. Stage only the five
corrective files:

```bash
git add pnpm-workspace.yaml .prettierignore \
  test/unit/platform/config/runtime-config.service.spec.ts \
  test/unit/platform/config/runtime-environment.spec.ts \
  test/unit/platform/redis/redis-auth.connection.spec.ts
git diff --cached --name-only
git commit -m "chore(toolchain): restore deterministic checks"
```

After that commit, prove the install policy from a disposable clean checkout
at the corrective commit with Node `24.18.0` and pnpm `11.15.1`:

```bash
corepack pnpm@11.15.1 ci
```

Run this proof in a host environment with registry access. Do not run `pnpm
ci` against the dirty implementation checkout because it recreates
`node_modules`. Do not weaken the command with `--ignore-scripts`,
`verify-deps-before-run=warn` or a non-frozen install. Preserve the exact
output; a registry or sandbox failure is an environment boundary and permits
one identical host retry, not a policy change.

Once the clean install passes, return to the preserved implementation checkout,
confirm the Milestone 3 diff is intact, report the corrective milestone packet
and stop. Do not run `check:quick` or resume Milestone 3 until this corrective
milestone is accepted. When M3 resumes, do not repeat its already-green focused
tests unless a corrective file overlaps them.

---

## Corrective Milestone 2.6: Close the committed M2 strict-lint baseline

### Why this correction exists

The first real `check:quick` after Corrective Milestone 2.5 reached ESLint and
found four strict-lint errors in three committed Milestone 2 test files. Keep
those baseline repairs separate from the still-uncommitted Milestone 3 test
repairs. This is the first bounded correction for this lint blocker; Luna
remains the executor.

Preserve the complete uncommitted Milestone 3 working tree. Do not discard,
stash, stage or rewrite any Milestone 3 path while completing this correction.

### Files

Modify only:

- `test/unit/platform/queue/bullmq-connection.module.spec.ts`
- `test/unit/platform/queue/queue-runtime-config.spec.ts`
- `test/unit/toolchain/dependency-cruiser-policy.spec.ts`

### Required correction

1. In `bullmq-connection.module.spec.ts`, replace both unsafe
   `providers: expect.any(Array)` matchers with one typed local assertion
   helper. Import `DynamicModule` as a type and use this exact shape:

   ```ts
   function expectSingleBullRootModule(dynamicModule: DynamicModule): void {
     const imports: readonly unknown[] = dynamicModule.imports ?? []
     expect(imports).toHaveLength(1)
     const rootImport = imports[0]
     if (
       typeof rootImport !== 'object' ||
       rootImport === null ||
       !('module' in rootImport) ||
       !('providers' in rootImport)
     ) {
       throw new Error('Expected one BullMQ root dynamic module')
     }
     expect(rootImport.module).toBe(BullModule)
     expect(Array.isArray(rootImport.providers)).toBe(true)
   }
   ```

   Each producer/worker test calls the helper and retains its assertion that
   the outer `BullmqConnectionModule` has no providers. Do not change the
   production module.

2. In `queue-runtime-config.spec.ts`, import `ApplicationRuntimeConfig` as a
   type and declare `createConfig(queueUrl?: string): ApplicationRuntimeConfig`.
3. In `dependency-cruiser-policy.spec.ts`, import
   `SpawnSyncReturns` as a type from `node:child_process` and declare
   `runFixture(fixtureName: string): SpawnSyncReturns<string>`.
4. Make no expectation, fixture, runtime or production behavior change.

### Focused verification and commit

Run with Node `24.18.0` and the complete inherited `PATH`:

```bash
node node_modules/eslint/bin/eslint.js --max-warnings=0 \
  test/unit/platform/queue/bullmq-connection.module.spec.ts \
  test/unit/platform/queue/queue-runtime-config.spec.ts \
  test/unit/toolchain/dependency-cruiser-policy.spec.ts
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/queue/bullmq-connection.module.spec.ts \
  test/unit/platform/queue/queue-runtime-config.spec.ts \
  test/unit/toolchain/dependency-cruiser-policy.spec.ts
git diff --check
```

Stage only these three files and commit:

```bash
git add test/unit/platform/queue/bullmq-connection.module.spec.ts \
  test/unit/platform/queue/queue-runtime-config.spec.ts \
  test/unit/toolchain/dependency-cruiser-policy.spec.ts
git diff --cached --name-only
git commit -m "test(queue): close strict lint baseline"
```

Confirm the preserved Milestone 3 diff is still unstaged, report the corrective
milestone packet and stop. Do not fix M3 lint, rerun `check:quick` or start
Milestone 4 until Corrective Milestone 2.6 is accepted.

---

## Corrective Milestone 2.7: Align the BullMQ ioredis type identity

### Why this correction exists

After the focused Milestone 3 checks passed, the repaired `check:quick` reached
`typecheck:src` and exposed a committed Milestone 2 dependency mismatch.
The starter directly installs `ioredis@5.11.1`, while `bullmq@5.79.0` installs
its own `ioredis@5.10.1`. TypeScript therefore sees two distinct protected
`AbstractConnector` type identities when `RedisOptions` is passed to
`BullModule.forRoot` in `bullmq-connection.module.ts`. The two `TS2322` errors
at lines 24 and 41 are a dependency-graph defect, not a Milestone 3 behavior
failure.

This is the repeated implementation/typecheck blocker defined by the
escalation contract. Continue this same execution task with
`gpt-5.6-terra`/`xhigh`; do not create or hand the work to another task.

Preserve the complete uncommitted Milestone 3 working tree. Do not discard,
stash, stage or rewrite any Milestone 3 path while completing this correction.

### Files

Modify only:

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`

### Required correction

1. Add these exact root pnpm overrides alongside the existing targeted
   override:

   ```yaml
   overrides:
     '@nestjs/swagger>js-yaml': 5.2.2
     'bullmq>ioredis': 5.11.1
     'eslint-plugin-tsdoc@0.5.2>@typescript-eslint/utils': 8.65.0
     find-my-way: 9.7.0
   ```

   Keep the direct exact dependency `ioredis@5.11.1`. Do not downgrade it,
   change BullMQ/Nest versions, add a cast, import BullMQ's private nested
   package, weaken TypeScript or use `skipLibCheck`.

   The TSDoc override aligns the plugin's private
   `@typescript-eslint/utils@8.56.1`, whose peer range excludes TypeScript 6,
   with the repository's existing `@typescript-eslint/utils@8.65.0`, whose
   peer range includes the pinned TypeScript `6.0.2`. Do not add another
   TypeScript version, downgrade TypeScript or replace the TSDoc plugin.

2. Keep `strictPeerDependencies: true` and record the backend starter's exact
   intentional peer omission:

   ```yaml
   peerDependencyRules:
     ignoreMissing:
       - react
       - react-dom
   ```

   These missing peers belong to Prisma Studio's Radix/Visx dependency tree;
   the backend starter does not run or ship that UI. Do not install React in
   the backend, disable strict peer checking globally or ignore any other peer.

3. Regenerate `pnpm-lock.yaml` with Node `24.18.0` and pnpm `11.15.1`.
   The resolved graph must contain one `ioredis@5.11.1` package and no
   `ioredis@5.10.1` package. It must contain
   `@typescript-eslint/utils@8.65.0` and no `8.56.1` package.
4. Treat both dependency overrides as compatibility hypotheses until source
   typecheck, strict lint and the existing real-Redis integration proof pass.
5. Make no source, test, Compose, environment or product behavior change.

### Verification and commit

Use the project Node binary by prepending its directory to the inherited
`PATH`. First update the dependency graph in the implementation checkout:

```bash
corepack pnpm@11.15.1 install --lockfile-only
rg -n "ioredis@5\\.10\\.1|ioredis@5\\.11\\.1" pnpm-lock.yaml
rg -n "@typescript-eslint/utils@8\\.(56\\.1|65\\.0)" pnpm-lock.yaml
corepack pnpm@11.15.1 why ioredis
corepack pnpm@11.15.1 why @typescript-eslint/utils
corepack pnpm@11.15.1 peers check
corepack pnpm@11.15.1 run lint
corepack pnpm@11.15.1 run typecheck:src
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/queue/bullmq-redis-options.spec.ts \
  test/unit/platform/queue/bullmq-connection.module.spec.ts
corepack pnpm@11.15.1 exec jest \
  --config jest.integration.config.mjs --runInBand \
  test/integration/platform/queue/bullmq-connection.integration.spec.ts
git diff --check
```

If Docker/Testcontainers is unavailable, retain the exact output and retry the
identical integration command once in a capable host environment. Do not
replace the real Redis proof with a mock.

Stage only the two corrective files and commit:

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git diff --cached --name-only
git commit -m "fix(queue): align BullMQ ioredis dependency"
```

After the commit, prove the lockfile from a disposable clean checkout at the
corrective commit:

```bash
corepack pnpm@11.15.1 ci
corepack pnpm@11.15.1 peers check
corepack pnpm@11.15.1 run prisma:generate
corepack pnpm@11.15.1 run lint
corepack pnpm@11.15.1 run typecheck:src
```

Do not run clean-checkout lint or typecheck before `prisma:generate`. The
generated client is intentionally absent from a clean Git checkout; without
that step, ESLint reports cascading `error`-typed Prisma contracts that do not
represent source defects.

Do not run `pnpm ci` in the dirty implementation checkout. Confirm the
uncommitted Milestone 3 paths are unchanged and unstaged, report the corrective
milestone packet and stop. Do not rerun the aggregate `check:quick`, commit M3
or start Milestone 4 until Corrective Milestone 2.7 is accepted.

---

## Milestone 3: Worker lifecycle and real physical queue proof

### Outcome

A test-only producer and standalone worker exchange jobs through a real Redis
container; worker shutdown is bounded; local Compose exposes independent
`redis-auth` and opt-in `redis-queue`; OCI proves dependencies without changing
the default API command.

### Files

Create:

- `src/bootstrap/workers/run-worker-application.ts`
- `test/unit/bootstrap/workers/run-worker-application.spec.ts`
- `test/integration/platform/queue/bullmq-connection.integration.spec.ts`

Modify:

- `.env.example`
- `docker-compose.yml`
- `test/unit/ops/local-compose-runtime-contract.spec.ts`
- `scripts/oci/run-image-smoke.ts`

### Required behavior

1. `runWorkerApplication` owns only application-context lifecycle. It imports
   no Prisma, HTTP, queue name, `WorkerHost` or product module.
2. Latch one `application.close()` promise; repeated close callbacks return the
   same promise. Call `onStarted()` exactly once before waiting.
3. Bound close with `shutdownGraceMs`. A startup/waiter failure attempts close
   but preserves the original failure. A normal close failure/timeout is
   surfaced for a non-zero worker exit.
4. `waitForWorkerTermination` installs one-shot `SIGINT` and `SIGTERM`
   listeners, accepts only the first signal, removes both listeners after close
   settles and never calls `process.exit()`.
5. The real-Redis integration test defines its queue name, payload, producer
   module and `@Processor` inside the test file only. Create independent Nest
   producer and worker application contexts using the fixed platform methods.
6. Enqueue two jobs with different BullMQ IDs and the same logical payload ID;
   observe both deliveries. This proves that product idempotency is not supplied
   by the platform.
7. Close both contexts with a deadline and stop the Testcontainers Redis in
   `finally`. Do not replace Redis with a mock if Docker is unavailable.
8. Add local `redis-queue` with profile `queues`, pinned existing Redis image,
   password `local-development-queue-only`, AOF, `appendfsync always`,
   `noeviction`, loopback `${REDIS_QUEUE_PORT:-6380}:6379`, dedicated
   `redis-queue-data` volume and credential-aware healthcheck.
9. Default Compose resolution has no queue service, API queue environment or
   queue dependency. Resolution with profile `queues` proves the exact queue
   service contract. Do not add queue to default `dev` or API `depends_on`.
10. Add `REDIS_QUEUE_PORT=6380` and a commented opt-in URL to `.env.example`.
    Do not put an active `REDIS_QUEUE_URL` in default API environment.
11. OCI runtime probe resolves exactly `@nestjs/bullmq`, `bullmq` and `ioredis`
    inside `/app`. Keep image command `node dist/bootstrap/api/main.js`; add no
    worker entrypoint or queue environment to the default smoke.
12. After Corrective Milestone 2.6 is accepted, close the M3 strict-lint
    findings without changing test behavior:
    - `TestOnlyProcessor.process` is non-`async`, pushes the delivery and returns
      `Promise.resolve()`;
    - import `WorkerTerminationWaiter` as a type and type the stateful
      `waitForTermination` Jest mock as
      `jest.MockedFunction<WorkerTerminationWaiter>`;
    - replace every `async` callback with no `await` by `Promise.resolve()`,
      `Promise.reject(error)` or direct `closeOnce()` return as appropriate.
      Do not disable or suppress ESLint rules.

### Focused verification

Strict lint correction:

```bash
node node_modules/eslint/bin/eslint.js --max-warnings=0 \
  test/integration/platform/queue/bullmq-connection.integration.spec.ts \
  test/unit/bootstrap/workers/run-worker-application.spec.ts
```

Worker lifecycle RED/GREEN:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/bootstrap/workers/run-worker-application.spec.ts
```

Real Redis proof:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.integration.config.mjs --runInBand \
  test/integration/platform/queue/bullmq-connection.integration.spec.ts
```

Compose contract:

```bash
corepack pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs --runInBand \
  test/unit/ops/local-compose-runtime-contract.spec.ts
```

After Milestones 1-2 and Corrective Milestones 2.5-2.7 are committed and the
Milestone 3 focused checks are green, run the repaired implementation-batch
gate once:

```bash
corepack pnpm@11.15.1 run check:quick
```

Run the exact command without `ignore-scripts` and without
`verify-deps-before-run=warn`. A successful command must prove both pnpm
preflight and the complete `check:quick` pipeline.

If Docker/Testcontainers is unavailable, retain the exact output and classify
it as an environment boundary. It is not permission to weaken the integration
test or upgrade the model.

Commit after the focused checks and `check:quick` pass:

```bash
git add .env.example docker-compose.yml scripts/oci/run-image-smoke.ts \
  src/bootstrap/workers test/unit/bootstrap/workers \
  test/integration/platform/queue/bullmq-connection.integration.spec.ts \
  test/unit/ops/local-compose-runtime-contract.spec.ts
git commit -m "feat(queue): prove opt-in worker runtime"
```

Stop and report the milestone packet. Do not continue without acceptance.

---

## Milestone 4: Adoption docs and final verification

### Outcome

The starter explains the auth/queue topology, gives one linear queue adoption
path and a queue-loss recovery contract. All final gates have fresh evidence
and the checkout is ready for one Sol whole-feature review.

### Files

Create:

- `src/platform/queue/README.md`
- `docs/architecture/durable-jobs.md`
- `docs/runbooks/queue-redis-loss.md`

Modify:

- `README.md`
- `docs/architecture/foundation-scope.md`
- `docs/architecture/redis-capabilities.md`
- `docs/architecture/runtime-lifecycle.md`
- `docs/roadmap.md`

### Documentation contract

`docs/architecture/durable-jobs.md` contains this linear adoption path:

```text
feature application producer port
  -> feature infrastructure BullMQ adapter
  -> feature-owned queue/job constants and discriminated payload
  -> API composition: forProducer + registerQueue
  -> worker composition: forWorker + registerQueue + @Processor
  -> NestFactory.createApplicationContext
  -> runWorkerApplication
  -> feature use case and authoritative durable state
```

The guide identifies where a copied product adds its module, bootstrap `main`,
package command and focused integration test, without adding those artifacts to
the starter. Every adopter must define attempts, backoff, retention,
concurrency, rate limits, retryable/terminal errors, idempotency, authoritative
business state, commit-to-enqueue policy and allowlisted diagnostics.

`queue-redis-loss.md` covers detection, producer failure, worker pause,
readiness, AOF/volume recovery, verification before resume and possible
duplicate delivery. It never suggests fallback to `redis-auth` and never treats
BullMQ state as product history.

The README and architecture docs state that `pnpm dev` starts required
`redis-auth` but no queue Redis, and link the explicit `queues` profile,
adoption guide and both Redis loss runbooks. The roadmap marks only the starter
queue foundation complete; product queues, outbox, scheduling, dashboards and
deployment remain deferred.

### Final verification

First check the negative architecture assertions:

```bash
git diff --check
rg -n \
  "REDIS_COORDINATION_URL|redis-coordination|RedisCoordination|REDIS_COORDINATION_COMMAND_EXECUTOR|coordinationUrl|coordination:v1|coordination Redis|Redis coordination|coordination-сесс|coordination state|coordination instance" \
  --glob '!docs/superpowers/**' --glob '!node_modules/**'
rg -n "coordination" \
  src/modules/auth src/platform/redis README.md package.json docker-compose.yml \
  .env.example docs/architecture/redis-capabilities.md docs/runbooks
rg -n "QueueService|Job<|@Processor" src/modules src/platform/queue
git status -sb
```

Expected results:

- the coordination search prints nothing;
- there is no product queue, payload or processor in starter modules;
- `@Processor` exists only in the integration test, not under `src`;
- no default API import of `BullmqConnectionModule` exists;
- every changed exported TypeScript API has current TSDoc.

Run the aggregate gates exactly once:

```bash
corepack pnpm@11.15.1 run check
corepack pnpm@11.15.1 run oci:check
```

`pnpm check` must include the real Redis integration suite. `oci:check` must
prove exact runtime dependencies and the unchanged API image command. If Docker
is unavailable, report `check` and OCI separately; do not claim full PASS.

Commit the verified documentation:

```bash
git add README.md \
  docs/architecture/durable-jobs.md \
  docs/architecture/foundation-scope.md \
  docs/architecture/redis-capabilities.md \
  docs/architecture/runtime-lifecycle.md \
  docs/roadmap.md docs/runbooks/queue-redis-loss.md \
  src/platform/queue/README.md
git commit -m "docs(queue): document Redis capability adoption"
git status -sb
```

Stop and return the complete handoff package. Do not push or begin backend
alignment.

## One-attempt escalation rule

For a blocker, diagnose and make one bounded correction attempt that stays
inside the milestone's fixed contract. If the same blocker remains, stop and
report:

1. milestone and expected invariant;
2. branch, full HEAD and `git status -sb`;
3. exact failing command and complete relevant error;
4. the one attempted correction and its result;
5. changed files and whether the last milestone commit is intact;
6. the exact plan decision that cannot be completed safely.

Return to the Sol planning/review task for classification:

- plan ambiguity or contradiction -> revise the plan; Luna remains executor;
- repeated implementation/integration blocker -> switch this same execution
  task to `Terra xhigh`;
- architecture or scope change -> revise the design before more edits;
- Docker, network, registry, port or host restriction -> environment boundary,
  not a model switch.

Many files, long output, mechanical TypeScript errors and the existence of four
milestones are not escalation conditions.

## Handoff after Milestone 4

The continuous execution task returns:

1. final branch and full HEAD;
2. one-line result and commit for each milestone, including Corrective
   Milestones 2.5, 2.6 and 2.7;
3. exact focused, `check:quick`, `check` and OCI commands with fresh outcomes;
4. any environment boundary or unverified gate;
5. confirmation that no push, PR, merge, deployment or backend edit occurred.

Then `Sol xhigh` performs one read-only whole-feature review against the design
and this plan. Confirmed findings return as one batch to the same execution task
for one fix wave, followed by final verification here. Do not create parallel
implementers or per-milestone reviewers.
