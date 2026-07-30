# Deployment Operator CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, testable TypeScript operator CLI that promotes and explicitly rolls back exact GHCR digests through Dokploy while keeping policy decisions in runbooks and making no hosted claim without a real drill.

**Architecture:** A toolchain-only `scripts/deployment` package owns strict manifest/environment validation, orchestration ports, live Docker/Dokploy/smoke adapters and redacted evidence publication. The orchestration core is deterministic and injected; dry-run never instantiates external adapters, apply is explicit, migration precedes every Dokploy mutation, and rollback remains a separate human-authorized command.

**Tech Stack:** Node.js `24.18.0`, pnpm `11.15.1`, TypeScript `7.0.2` production compiler, Joi `18.2.3`, built-in `fetch`, `node:child_process`, Jest `30.4.2`, ts-jest, tsx.

## Global Constraints

- Work only in `/Users/denischernykh/projects/starters/nest-js-starter/.worktrees/deployment-operator-cli` on `feat/deployment-operator-cli`, based on `stage` revision `a38476856f1e6448bb8141bab35c94fa77c06752`.
- Do not push, open a pull request, merge, publish GHCR, mutate Dokploy/VPS/DNS/PostgreSQL/Redis/S3, or claim hosted PASS.
- Keep all executable deployment tooling under `scripts/deployment`; do not add imports from `src` into the tool or imports from `scripts` into `src`.
- Add TSDoc to every hand-written exported TypeScript contract according to `docs/architecture/tsdoc-guidelines.md`.
- Add no dependency: use exact existing Joi `18.2.3`, built-in Node APIs and built-in `fetch`.
- Never accept secret-valued CLI flags or write inherited environment, credentials, connection URLs, headers, cookies or complete Dokploy environment text to output/evidence.
- `promote` defaults to offline dry-run; only explicit `--apply --evidence <path>` may instantiate live adapters.
- Promotion never invokes rollback automatically. Rollback is a separate `rollback --apply --evidence <path>` command and requires schema-compatibility evidence.
- Use immutable lowercase `ghcr.io/...@sha256:<64-hex>` references only; candidate and rollback must differ.
- Run the narrowest focused test after each red/green step and `pnpm check:quick` before completing the slice.

---

## File Structure

Create these focused units:

- `scripts/deployment/manifest.ts` — strict non-secret release manifest parsing and file loading.
- `scripts/deployment/cli-options.ts` — command-line grammar without secret-valued flags.
- `scripts/deployment/live-environment.ts` — apply-only secret environment validation and cross-field checks.
- `scripts/deployment/ports.ts` — TSDoc-documented orchestration contracts and bounded result types.
- `scripts/deployment/deployment-orchestrator.ts` — dry-run, promotion, rollback, polling, restoration and evidence state machine.
- `scripts/deployment/command-runner.ts` — bounded `execFile` adapter with stdin/environment support.
- `scripts/deployment/docker-deployment.adapter.ts` — isolated GHCR auth, pull/revision verification and one-shot migrator.
- `scripts/deployment/dokploy-http.adapter.ts` — typed HTTPS Dokploy requests and strict response parsing.
- `scripts/deployment/external-smoke.adapter.ts` — bounded public health/auth contract verification.
- `scripts/deployment/evidence-file.adapter.ts` — `0600`, atomic no-overwrite JSON evidence publication.
- `scripts/deployment/cli.ts` — process composition, redacted console output and exit status.
- `docs/runbooks/release-manifest.example.json` — deliberately non-approved version-1 manifest example.
- `docs/runbooks/backend-codex-deployment-operator-adoption.md` — documentation-only atomic future adoption.

Create matching tests under `test/unit/scripts/deployment/`. Keep test-only
fakes in each spec unless at least three specs need the same helper; only then
create `test/unit/scripts/deployment/support/`.

---

### Task 1: Strict release manifest and CLI grammar

**Files:**

- Create: `scripts/deployment/manifest.ts`
- Create: `scripts/deployment/cli-options.ts`
- Create: `docs/runbooks/release-manifest.example.json`
- Create: `test/unit/scripts/deployment/manifest.spec.ts`
- Create: `test/unit/scripts/deployment/cli-options.spec.ts`

**Interfaces:**

- Produces:

```ts
export interface DeploymentImageReference {
  readonly imageRef: string
  readonly revision: string
}

export interface DeploymentReleaseManifest {
  readonly schemaVersion: 1
  readonly environment: string
  readonly repository: string
  readonly candidate: DeploymentImageReference & {
    readonly workflowRunUrl: string
  }
  readonly rollback: DeploymentImageReference & {
    readonly schemaCompatibilityEvidence: string
  }
  readonly publicApiUrl: string
}

export interface DeploymentInputIssue {
  readonly path: string
  readonly rule: string
}

export class DeploymentInputError extends Error {
  readonly issues: readonly DeploymentInputIssue[]
}

export function parseDeploymentManifest(
  input: unknown,
): DeploymentReleaseManifest

export function readDeploymentManifest(
  path: string,
): Promise<DeploymentReleaseManifest>

export type DeploymentCommand = 'preflight' | 'promote' | 'rollback'

export interface DeploymentCliOptions {
  readonly command: DeploymentCommand
  readonly manifestPath: string
  readonly apply: boolean
  readonly evidencePath?: string
}

export function parseDeploymentCliOptions(
  arguments_: readonly string[],
): DeploymentCliOptions
```

- Consumers: all later CLI/orchestration tasks.

- [ ] **Step 1: Write failing strict-manifest tests**

Add tests that prove a valid manifest parses and that unknown/secret-looking
keys, mutable tags, mixed-case GHCR coordinates, a credential-bearing URL,
candidate/rollback equality and a workflow URL for another repository fail
with path/rule issues only:

```ts
import {
  DeploymentInputError,
  parseDeploymentManifest,
} from '@scripts/deployment/manifest'

const validManifest = {
  schemaVersion: 1,
  environment: 'stage',
  repository: 'DenisChernykh/nest-js-starter',
  candidate: {
    imageRef:
      'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    revision: '1'.repeat(40),
    workflowRunUrl:
      'https://github.com/DenisChernykh/nest-js-starter/actions/runs/123456789',
  },
  rollback: {
    imageRef:
      'ghcr.io/denischernykh/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    revision: '2'.repeat(40),
    schemaCompatibilityEvidence: 'review/rollback-compatible',
  },
  publicApiUrl: 'https://stage-api.example.com',
} as const

it('parses one strict non-secret release manifest', () => {
  expect(parseDeploymentManifest(validManifest)).toEqual(validManifest)
})

it('rejects unknown secret-bearing fields without returning their value', () => {
  const secret = 'postgresql://operator:do-not-print@example.invalid/db'
  expect(() =>
    parseDeploymentManifest({ ...validManifest, DATABASE_URL: secret }),
  ).toThrow(DeploymentInputError)

  try {
    parseDeploymentManifest({ ...validManifest, DATABASE_URL: secret })
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain(secret)
  }
})
```

- [ ] **Step 2: Run the focused manifest test and verify RED**

Run:

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/manifest.spec.ts
```

Expected: FAIL because `@scripts/deployment/manifest` does not exist.

- [ ] **Step 3: Implement the strict Joi manifest parser**

Use strict Joi objects with conversion disabled and map errors to redacted
issues:

```ts
const imageRefPattern =
  /^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?@sha256:[0-9a-f]{64}$/u
const revisionPattern = /^[0-9a-f]{40}$/u

const manifestSchema = Joi.object({
  schemaVersion: Joi.number().valid(1).required(),
  environment: Joi.string().trim().min(1).max(64).required(),
  repository: Joi.string()
    .pattern(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/u)
    .required(),
  candidate: Joi.object({
    imageRef: Joi.string().pattern(imageRefPattern).required(),
    revision: Joi.string().pattern(revisionPattern).required(),
    workflowRunUrl: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
  })
    .unknown(false)
    .required(),
  rollback: Joi.object({
    imageRef: Joi.string().pattern(imageRefPattern).required(),
    revision: Joi.string().pattern(revisionPattern).required(),
    schemaCompatibilityEvidence: Joi.string().trim().min(1).max(512).required(),
  })
    .unknown(false)
    .required(),
  publicApiUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .required(),
})
  .unknown(false)
  .required()
```

After structural validation, normalize URLs with `new URL`, reject credentials,
query/fragment and non-root public API paths, bind both image repositories and
the workflow URL to `repository`, and reject equal image refs. Freeze the
returned object and nested objects. `DeploymentInputError.toJSON()` returns only
`name`, `message` and `issues`.

- [ ] **Step 4: Run the focused manifest test and verify GREEN**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Write failing CLI grammar tests**

Cover:

```ts
expect(
  parseDeploymentCliOptions(['promote', '--manifest', 'release.json']),
).toEqual({
  command: 'promote',
  manifestPath: 'release.json',
  apply: false,
})

expect(
  parseDeploymentCliOptions([
    'promote',
    '--manifest',
    'release.json',
    '--apply',
    '--evidence',
    'evidence.json',
  ]),
).toEqual({
  command: 'promote',
  manifestPath: 'release.json',
  apply: true,
  evidencePath: 'evidence.json',
})

expect(() =>
  parseDeploymentCliOptions(['rollback', '--manifest', 'release.json']),
).toThrow('rollback requires --apply')
```

Also reject `--token`, `--database-url`, duplicated flags, `preflight --apply`,
apply without evidence, evidence without apply and positional extras.

- [ ] **Step 6: Run the focused CLI test and verify RED**

Run:

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/cli-options.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 7: Implement the minimal explicit CLI parser**

Parse one command followed only by `--manifest <path>`, optional `--apply` and
optional `--evidence <path>`. Filter only the single pnpm separator `--`; do not
silently ignore arbitrary separators or flags. Emit the fixed usage text:

```text
Usage:
  deployment:preflight --manifest <path>
  deployment:promote --manifest <path> [--apply --evidence <path>]
  deployment:rollback --manifest <path> --apply --evidence <path>
```

- [ ] **Step 8: Add the deliberately non-approved example manifest**

Use exactly the symbolic values from the design spec. Add top-level
`"schemaVersion": 1`, distinct `a...`/`b...` digests, `1...`/`2...` revisions
and `https://stage-api.example.com`; never use a current successful digest.

- [ ] **Step 9: Run both focused tests and formatting**

Run:

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/manifest.spec.ts test/unit/scripts/deployment/cli-options.spec.ts
corepack pnpm@11.15.1 exec prettier --check scripts/deployment/manifest.ts scripts/deployment/cli-options.ts test/unit/scripts/deployment/manifest.spec.ts test/unit/scripts/deployment/cli-options.spec.ts docs/runbooks/release-manifest.example.json
```

Expected: PASS.

- [ ] **Step 10: Commit the manifest contract**

```sh
git add scripts/deployment/manifest.ts scripts/deployment/cli-options.ts test/unit/scripts/deployment/manifest.spec.ts test/unit/scripts/deployment/cli-options.spec.ts docs/runbooks/release-manifest.example.json
git commit -m "feat(deployment): add strict release manifest"
```

---

### Task 2: Apply environment and orchestration ports

**Files:**

- Create: `scripts/deployment/live-environment.ts`
- Create: `scripts/deployment/ports.ts`
- Create: `test/unit/scripts/deployment/live-environment.spec.ts`

**Interfaces:**

- Consumes: `DeploymentReleaseManifest`.
- Produces:

```ts
export interface DeploymentLiveEnvironment {
  readonly dokployBaseUrl: string
  readonly dokployApiKey: string
  readonly dokployApplicationId: string
  readonly dokployApplicationEnvironment: string
  readonly dokployPreviousApplicationEnvironment: string
  readonly ghcrRegistryUrl: 'https://ghcr.io'
  readonly ghcrUsername: string
  readonly ghcrPassword: string
  readonly migrationDatabaseUrl: string
  readonly runtimeDatabaseUrl: string
}

export function parseDeploymentLiveEnvironment(
  input: NodeJS.ProcessEnv,
  revision: string,
): DeploymentLiveEnvironment
```

```ts
export interface ImageVerificationPort {
  verifyImage(input: {
    readonly imageRef: string
    readonly revision: string
    readonly registryUrl: string
    readonly username: string
    readonly password: string
  }): Promise<void>
}

export interface MigratorPort {
  migrate(input: {
    readonly imageRef: string
    readonly databaseUrl: string
  }): Promise<{ readonly exitCode: number }>
}

export type DokployDeploymentStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface DokployDeploymentRecord {
  readonly deploymentId: string
  readonly status: string
  readonly title?: string
}

export interface DokployPort {
  listDeployments(
    applicationId: string,
  ): Promise<readonly DokployDeploymentRecord[]>
  saveEnvironment(applicationId: string, environment: string): Promise<void>
  saveDockerProvider(input: {
    readonly applicationId: string
    readonly imageRef: string
    readonly registryUrl: string
    readonly username: string
    readonly password: string
  }): Promise<void>
  deploy(input: {
    readonly applicationId: string
    readonly title: string
    readonly description: string
  }): Promise<void>
}

export interface ExternalSmokePort {
  verify(publicApiUrl: string): Promise<ExternalSmokeResult>
}

export interface ClockPort {
  nowMs(): number
  sleep(milliseconds: number): Promise<void>
}

export type DeploymentOperation = 'promote' | 'rollback'
export type DeploymentOutcome = 'succeeded' | 'failed'

export interface ExternalSmokeResult {
  readonly live: boolean
  readonly startup: boolean
  readonly ready: boolean
  readonly unauthenticatedAuthProblem: boolean
}

export interface DeploymentEvidenceStep {
  readonly name: string
  readonly outcome: DeploymentOutcome
  readonly completedAt: string
}

export interface DeploymentEvidence {
  readonly schemaVersion: 1
  readonly operation: DeploymentOperation
  readonly environment: string
  readonly repository: string
  readonly candidate: DeploymentImageReference
  readonly rollback: DeploymentImageReference
  readonly workflowRunUrl: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly steps: readonly DeploymentEvidenceStep[]
  readonly deploymentId?: string
  readonly terminalStatus?: string
  readonly migrationOutcome: 'not-run' | DeploymentOutcome
  readonly restorationAttempted: boolean
  readonly restorationSucceeded: boolean
  readonly smoke?: ExternalSmokeResult
  readonly outcome: DeploymentOutcome
}

export interface EvidencePort {
  write(path: string, evidence: DeploymentEvidence): Promise<void>
}
```

- [ ] **Step 1: Write failing live-environment tests**

Create one valid input and cover:

- missing every required key;
- non-HTTPS or credential-bearing `DOKPLOY_BASE_URL`;
- `GHCR_REGISTRY_URL` other than `https://ghcr.io`;
- duplicated/missing `DATABASE_URL` and `SERVICE_REVISION` lines;
- runtime URL mismatch;
- candidate revision mismatch;
- error JSON does not contain API key, password, either DB URL or environment
  text.

Use environment strings with values containing `=` to prove parsing splits at
the first equals sign only.

- [ ] **Step 2: Run the focused test and verify RED**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/live-environment.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement redacted strict environment validation**

Use Joi for presence/string validation, but construct error issues from
`detail.path` and `detail.type` only. Parse `DOKPLOY_APPLICATION_ENV` with:

```ts
function findAssignments(environment: string, key: string): readonly string[] {
  return environment
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1))
}
```

Require exactly one `DATABASE_URL` and one `SERVICE_REVISION`; compare
byte-for-byte to runtime URL and revision. Freeze the returned projection.

- [ ] **Step 4: Define and document all ports**

Add precise TSDoc describing secret ownership, failure behavior and allowed
status semantics. Ports may receive secrets in memory but must never promise
logging or persistence. `DokployDeploymentRecord.status` remains `string`
because unknown server states must reach the fail-closed orchestrator.

- [ ] **Step 5: Run focused tests, typecheck and lint**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/live-environment.spec.ts
corepack pnpm@11.15.1 run typecheck:test
corepack pnpm@11.15.1 exec eslint scripts/deployment/live-environment.ts scripts/deployment/ports.ts test/unit/scripts/deployment/live-environment.spec.ts --max-warnings=0
```

Expected: PASS.

- [ ] **Step 6: Commit environment and ports**

```sh
git add scripts/deployment/live-environment.ts scripts/deployment/ports.ts test/unit/scripts/deployment/live-environment.spec.ts
git commit -m "feat(deployment): define operator ports"
```

---

### Task 3: Deterministic promotion and rollback orchestration

**Files:**

- Create: `scripts/deployment/deployment-orchestrator.ts`
- Create: `test/unit/scripts/deployment/deployment-orchestrator.spec.ts`

**Interfaces:**

- Consumes all Task 2 ports plus manifest/live environment.
- Produces:

```ts
export interface DeploymentOrchestratorDependencies {
  readonly image: ImageVerificationPort
  readonly migrator: MigratorPort
  readonly dokploy: DokployPort
  readonly smoke: ExternalSmokePort
  readonly clock: ClockPort
  readonly evidence: EvidencePort
}

export interface ApplyDeploymentInput {
  readonly manifest: DeploymentReleaseManifest
  readonly live: DeploymentLiveEnvironment
  readonly evidencePath: string
}

export function createDryRunPlan(
  manifest: DeploymentReleaseManifest,
): readonly string[]

export class DeploymentOrchestrator {
  promote(input: ApplyDeploymentInput): Promise<DeploymentEvidence>
  rollback(input: ApplyDeploymentInput): Promise<DeploymentEvidence>
}
```

- [ ] **Step 1: Write the failing dry-run and happy-path tests**

Use event-recording fakes:

```ts
const events: string[] = []

expect(createDryRunPlan(manifest)).toEqual([
  'validate release manifest',
  'verify candidate GHCR digest and OCI revision',
  'run one-shot Prisma migrator',
  'save complete Dokploy runtime environment',
  'save exact candidate Docker provider',
  'deploy and identify one Dokploy record',
  'poll identified deployment to done',
  'run external health/auth smoke',
  'write redacted evidence',
])
expect(events).toEqual([])
```

For promotion, configure fakes to return:

```ts
before = [{ deploymentId: 'old', status: 'done', title: 'old' }]
after = [
  ...before,
  {
    deploymentId: 'new',
    status: 'running',
    title: `stage-${manifest.candidate.revision}`,
  },
]
poll = ['running', 'done']
```

Assert exact ordering:

```text
verify:candidate
migrate:candidate
list:before
save-environment:candidate
save-provider:candidate
deploy:candidate
list:after
sleep:5000
list:poll
smoke
evidence
```

- [ ] **Step 2: Run the orchestrator test and verify RED**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/deployment-orchestrator.spec.ts
```

Expected: FAIL because the orchestrator does not exist.

- [ ] **Step 3: Implement the minimal happy-path orchestrator**

Use constants:

```ts
const pollIntervalMs = 5_000
const pollDeadlineMs = 600_000
```

Snapshot before mutation, save environment, save provider, deploy, fetch the
after snapshot and select exactly one new record with the exact
`stage-${revision}` title whose ID was not present before. Poll only that ID.
Accept only `done`; sleep only for `running`.

Create evidence with UTC ISO timestamps derived from `clock.nowMs()`, immutable
image/revision fields and fixed step names. Do not include live values.

- [ ] **Step 4: Write failing failure-order tests**

Add table-driven tests for:

- image verification failure: no migrate/Dokploy/smoke;
- migrator exit `1`: no Dokploy/smoke;
- zero or two matching new records: restore previous environment after
  mutation, no smoke;
- `error`, `cancelled`, unknown, missing or duplicated poll record;
- deadline reached while `running`;
- environment-save, provider, deploy or list request failure;
- external smoke failure after `done`;
- restoration failure recorded as critical without replacing the original
  failure;
- no failure invokes a rollback image or a second migration.

- [ ] **Step 5: Implement bounded failure/restoration behavior**

Set `environmentMutationStarted` immediately before calling
`saveEnvironment`, because a timed-out or non-2xx request can still have
mutated the remote application. In a single `catch`, attempt exactly one:

```ts
await dokploy.saveEnvironment(
  live.dokployApplicationId,
  live.dokployPreviousApplicationEnvironment,
)
```

when mutation started. Append only attempted/succeeded booleans to evidence,
write failure evidence once, then throw a redacted `DeploymentExecutionError`
that contains step and category, not the original response body or secret
input.

- [ ] **Step 6: Write failing rollback tests**

Assert rollback ordering:

```text
verify:rollback
list:before
save-environment:previous
save-provider:rollback
deploy:rollback
list:after
poll
smoke
evidence
```

Assert no `migrate` event and verify empty
`schemaCompatibilityEvidence` is rejected before `verify:rollback` even if a
forged in-memory manifest bypasses the normal parser.

- [ ] **Step 7: Implement rollback and shared deployment polling**

Extract only private helpers shared by promote/rollback:

- `identifyNewDeployment`;
- `pollDeployment`;
- `restorePreviousEnvironment`;
- `createEvidenceRecorder`.

Do not create a generic workflow engine or public framework.

- [ ] **Step 8: Run focused tests and static checks**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/deployment-orchestrator.spec.ts
corepack pnpm@11.15.1 run typecheck:test
corepack pnpm@11.15.1 exec eslint scripts/deployment/deployment-orchestrator.ts test/unit/scripts/deployment/deployment-orchestrator.spec.ts --max-warnings=0
```

Expected: PASS.

- [ ] **Step 9: Commit orchestration**

```sh
git add scripts/deployment/deployment-orchestrator.ts test/unit/scripts/deployment/deployment-orchestrator.spec.ts
git commit -m "feat(deployment): orchestrate exact digest promotion"
```

---

### Task 4: Bounded Docker and migrator adapters

**Files:**

- Create: `scripts/deployment/command-runner.ts`
- Create: `scripts/deployment/docker-deployment.adapter.ts`
- Create: `test/unit/scripts/deployment/command-runner.spec.ts`
- Create: `test/unit/scripts/deployment/docker-deployment.adapter.spec.ts`

**Interfaces:**

```ts
export interface CommandInput {
  readonly file: string
  readonly arguments: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly stdin?: string
  readonly timeoutMs: number
}

export interface CommandOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface CommandRunner {
  run(input: CommandInput): Promise<CommandOutcome>
}

export class NodeCommandRunner implements CommandRunner

export class DockerDeploymentAdapter
  implements ImageVerificationPort, MigratorPort
```

- [ ] **Step 1: Write failing command-runner tests**

Use `process.execPath` and inline `-e` programs to prove:

- stdin reaches the child;
- only explicitly supplied environment additions are merged with inherited
  environment;
- stdout/stderr are bounded and returned;
- non-zero exit is data, not an unredacted thrown error;
- timeout sets `timedOut: true` and terminates the child.

- [ ] **Step 2: Run the command-runner test and verify RED**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/command-runner.spec.ts
```

- [ ] **Step 3: Implement `NodeCommandRunner`**

Use `execFile` with:

```ts
{
  cwd: process.cwd(),
  encoding: 'utf8',
  env: { ...process.env, ...input.environment },
  maxBuffer: 1024 * 1024,
  timeout: input.timeoutMs,
}
```

Write stdin through the returned child process and close it. Convert Node
timeout/error fields to the bounded outcome without embedding command output in
an exception.

- [ ] **Step 4: Write failing Docker adapter tests**

Inject a fake runner and fake temporary-directory functions. Assert the exact
commands:

```text
docker --config <temp> login ghcr.io --username operator --password-stdin
docker --config <temp> pull <image@digest>
docker image inspect <image@digest> --format {{index .Config.Labels "org.opencontainers.image.revision"}}
docker --config <temp> logout ghcr.io
docker run --rm --env DATABASE_URL --entrypoint corepack <image@digest> pnpm@11.15.1 start:migrate
```

Assert:

- GHCR password appears only in login stdin;
- migration URL appears only in child environment;
- neither secret appears in arguments;
- temp directory mode is `0700`;
- cleanup runs after success and every command failure;
- revision output must equal `${revision}\n`;
- timeout/non-zero login, pull, inspect or migrator returns a redacted failure.

- [ ] **Step 5: Implement the Docker adapter**

Use `mkdtemp(join(tmpdir(), 'nest-js-starter-deployment-auth-'))`, `chmod(0o700)`
and an owned-prefix safety check before recursive removal. Always logout on
successful login, but cleanup the isolated directory even when logout fails.
Use five-minute command timeouts and return only migrator exit code to the
orchestrator.

- [ ] **Step 6: Run focused tests and static checks**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/command-runner.spec.ts test/unit/scripts/deployment/docker-deployment.adapter.spec.ts
corepack pnpm@11.15.1 run typecheck:test
corepack pnpm@11.15.1 exec eslint scripts/deployment/command-runner.ts scripts/deployment/docker-deployment.adapter.ts test/unit/scripts/deployment/command-runner.spec.ts test/unit/scripts/deployment/docker-deployment.adapter.spec.ts --max-warnings=0
```

- [ ] **Step 7: Commit command adapters**

```sh
git add scripts/deployment/command-runner.ts scripts/deployment/docker-deployment.adapter.ts test/unit/scripts/deployment/command-runner.spec.ts test/unit/scripts/deployment/docker-deployment.adapter.spec.ts
git commit -m "feat(deployment): add isolated Docker adapters"
```

---

### Task 5: Dokploy HTTPS adapter and mock contract

**Files:**

- Create: `scripts/deployment/dokploy-http.adapter.ts`
- Create: `test/unit/scripts/deployment/dokploy-http.adapter.spec.ts`

**Interfaces:**

```ts
export interface DokployHttpAdapterOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly requestTimeoutMs?: number
  readonly fetchImplementation?: typeof fetch
}

export class DokployHttpAdapter implements DokployPort
```

- [ ] **Step 1: Write a failing loopback mock-server test**

Create a per-test `node:http` server bound to `127.0.0.1` and capture method,
path, `x-api-key` and parsed JSON/form fields. Return:

- `{}` from `application.saveEnvironment`;
- `{}` from `application.saveDockerProvider`;
- `{}` from `application.deploy`;
- arrays from `deployment.all`.

Assert exact request contracts:

```json
{
  "applicationId": "app-1",
  "env": "NODE_ENV=production\nSERVICE_REVISION=111...",
  "buildArgs": null,
  "buildSecrets": null,
  "createEnvFile": false
}
```

```json
{
  "applicationId": "app-1",
  "dockerImage": "ghcr.io/denischernykh/nest-js-starter@sha256:...",
  "registryUrl": "https://ghcr.io",
  "username": "operator",
  "password": "secret"
}
```

The deploy body contains `applicationId`, exact title and digest description.
The list request uses `GET /api/deployment.all?applicationId=app-1`.

- [ ] **Step 2: Run the adapter test and verify RED**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/dokploy-http.adapter.spec.ts
```

- [ ] **Step 3: Implement bounded fetch and strict response parsing**

Normalize `baseUrl` once and always require HTTPS. The loopback test injects a
fetch bridge that receives the original HTTPS request, rewrites only its origin
to the ephemeral `http://127.0.0.1` server, and delegates to built-in fetch;
production code has no insecure-HTTP switch:

```ts
headers: {
  accept: 'application/json',
  'content-type': 'application/json',
  'x-api-key': apiKey,
}
signal: AbortSignal.timeout(requestTimeoutMs)
```

For every response:

- require `response.ok`;
- parse JSON once;
- mutation result must be a plain object with zero keys;
- list result must be an array whose records have string `deploymentId` and
  string `status`; optional `title` must be string;
- throw `DokployContractError` with operation/status/category only;
- never include headers, URL query values, response body or API key in errors.

- [ ] **Step 4: Add failure contract tests**

Cover:

- `401`, `500`;
- timeout;
- invalid JSON;
- mutation body `{"ok":true}`;
- list body as object;
- list record missing ID/status or non-string title;
- response text containing a sentinel secret never appears in serialized
  error.

- [ ] **Step 5: Run focused tests and static checks**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/dokploy-http.adapter.spec.ts
corepack pnpm@11.15.1 run typecheck:test
corepack pnpm@11.15.1 exec eslint scripts/deployment/dokploy-http.adapter.ts test/unit/scripts/deployment/dokploy-http.adapter.spec.ts --max-warnings=0
```

- [ ] **Step 6: Commit Dokploy adapter**

```sh
git add scripts/deployment/dokploy-http.adapter.ts test/unit/scripts/deployment/dokploy-http.adapter.spec.ts
git commit -m "feat(deployment): add bounded Dokploy adapter"
```

---

### Task 6: External smoke and atomic evidence publication

**Files:**

- Create: `scripts/deployment/external-smoke.adapter.ts`
- Create: `scripts/deployment/evidence-file.adapter.ts`
- Create: `test/unit/scripts/deployment/external-smoke.adapter.spec.ts`
- Create: `test/unit/scripts/deployment/evidence-file.adapter.spec.ts`

**Interfaces:**

```ts
export interface ExternalSmokeAdapterOptions {
  readonly requestTimeoutMs?: number
  readonly fetchImplementation?: typeof fetch
}

export class ExternalSmokeAdapter implements ExternalSmokePort

export class EvidenceFileAdapter implements EvidencePort
```

- [ ] **Step 1: Write failing external-smoke tests**

Use an injected fetch fake. Require GET calls in this order:

```text
/health/live
/health/startup
/health/ready
/v1/auth/me
```

Require health `200`. Require auth `401`, content type whose media type is
`application/problem+json`, and JSON:

```json
{
  "code": "AUTHENTICATION_REQUIRED",
  "status": 401
}
```

Cover a failure for each endpoint, timeout, malformed auth JSON, HTML/redirect,
wrong content type and a sentinel response-body secret absent from errors.

- [ ] **Step 2: Implement bounded external smoke**

Resolve endpoint URLs with `new URL(path, publicApiUrl)`, use
`redirect: 'error'`, `credentials: 'omit'`, no cookie/header injection and a
ten-second timeout per request. Return four named boolean outcomes only.

- [ ] **Step 3: Write failing evidence-file tests**

In a fresh temporary directory, assert:

- valid JSON plus trailing newline;
- destination mode `0600`;
- second write fails with `EVIDENCE_EXISTS`;
- destination is absent when serialization/write fails;
- no temporary sibling remains after success/failure;
- serialized bytes do not contain supplied sentinel secrets;
- publication uses an injected `link` and fails without replacing an existing
  path.

- [ ] **Step 4: Implement atomic no-overwrite evidence**

Within the destination directory:

1. construct a random `.deployment-evidence-<uuid>.tmp` sibling;
2. open with `wx`, mode `0600`;
3. write canonical `JSON.stringify(evidence, null, 2) + '\n'`;
4. `sync()` and close;
5. call `link(tempPath, destinationPath)`; map `EEXIST` to
   `EVIDENCE_EXISTS`;
6. unlink the temporary path in `finally`.

Before serialization, recursively reject keys matching:

```ts
const forbiddenEvidenceKeyPattern =
  /(api.?key|authorization|cookie|credential|database.?url|header|password|redis.?url|secret|token)/iu
```

Also reject the exact keys `dokployApplicationEnvironment` and
`dokployPreviousApplicationEnvironment`. The allowed `environment` field is a
non-secret deployment environment name and remains valid.

- [ ] **Step 5: Run focused tests and static checks**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/external-smoke.adapter.spec.ts test/unit/scripts/deployment/evidence-file.adapter.spec.ts
corepack pnpm@11.15.1 run typecheck:test
corepack pnpm@11.15.1 exec eslint scripts/deployment/external-smoke.adapter.ts scripts/deployment/evidence-file.adapter.ts test/unit/scripts/deployment/external-smoke.adapter.spec.ts test/unit/scripts/deployment/evidence-file.adapter.spec.ts --max-warnings=0
```

- [ ] **Step 6: Commit smoke and evidence adapters**

```sh
git add scripts/deployment/external-smoke.adapter.ts scripts/deployment/evidence-file.adapter.ts test/unit/scripts/deployment/external-smoke.adapter.spec.ts test/unit/scripts/deployment/evidence-file.adapter.spec.ts
git commit -m "feat(deployment): record redacted deployment evidence"
```

---

### Task 7: CLI composition and full offline operator story

**Files:**

- Create: `scripts/deployment/cli.ts`
- Create: `test/unit/scripts/deployment/cli.spec.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export interface DeploymentCliIo {
  readonly stdout: Pick<NodeJS.WriteStream, 'write'>
  readonly stderr: Pick<NodeJS.WriteStream, 'write'>
}

export interface DeploymentCliDependencies {
  readonly createOrchestrator: (
    live: DeploymentLiveEnvironment,
  ) => DeploymentOrchestrator
}

export function runDeploymentCli(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  io: DeploymentCliIo,
  dependencies?: DeploymentCliDependencies,
): Promise<number>
```

- [ ] **Step 1: Write failing process-boundary tests**

Cover:

- `preflight` reads/parses manifest and emits repository, environment,
  candidate digest/revision and rollback digest/revision only;
- `promote` without `--apply` emits ordered dry-run and never calls
  `createOrchestrator`;
- `promote --apply` validates live environment before constructing adapters;
- successful apply delegates to `orchestrator.promote`;
- rollback delegates only to `orchestrator.rollback`;
- validation/execution errors print category/path/rule only and return `1`;
- output never contains sentinel API key, GHCR password, DB URLs or complete
  environments;
- unknown CLI usage returns `1`;
- no unhandled rejection and no direct `process.exit()`.

- [ ] **Step 2: Run the CLI test and verify RED**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment/cli.spec.ts
```

- [ ] **Step 3: Implement production composition**

Construct:

```ts
const commandRunner = new NodeCommandRunner()
const docker = new DockerDeploymentAdapter(commandRunner)
const dokploy = new DokployHttpAdapter({
  baseUrl: live.dokployBaseUrl,
  apiKey: live.dokployApiKey,
})
const smoke = new ExternalSmokeAdapter()
const evidence = new EvidenceFileAdapter()
const clock = {
  nowMs: () => Date.now(),
  sleep: (milliseconds: number) => delay(milliseconds),
}
```

Create one `DeploymentOrchestrator`. Main execution guard compares resolved
`process.argv[1]` and `__filename`, sets `process.exitCode`, and writes only
redacted messages.

- [ ] **Step 4: Add exact package scripts**

Add:

```json
"deployment:preflight": "tsx scripts/deployment/cli.ts preflight",
"deployment:promote": "tsx scripts/deployment/cli.ts promote",
"deployment:rollback": "tsx scripts/deployment/cli.ts rollback"
```

Do not add a generic `deployment` script or GitHub workflow.

- [ ] **Step 5: Verify real dry-run commands without secrets/network**

Run:

```sh
corepack pnpm@11.15.1 run deployment:preflight -- --manifest docs/runbooks/release-manifest.example.json
corepack pnpm@11.15.1 run deployment:promote -- --manifest docs/runbooks/release-manifest.example.json
```

Expected: exit `0`, redacted manifest/plan output, no Docker or network access.

Then run:

```sh
corepack pnpm@11.15.1 run deployment:promote -- --manifest docs/runbooks/release-manifest.example.json --apply --evidence /tmp/should-not-be-created.json
```

Expected: non-zero before external calls because apply environment is missing;
`/tmp/should-not-be-created.json` does not exist.

- [ ] **Step 6: Run focused tests and complete static checks**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment
corepack pnpm@11.15.1 run typecheck:test
corepack pnpm@11.15.1 exec eslint scripts/deployment test/unit/scripts/deployment --max-warnings=0
corepack pnpm@11.15.1 exec prettier --check scripts/deployment test/unit/scripts/deployment package.json docs/runbooks/release-manifest.example.json
```

- [ ] **Step 7: Commit CLI composition**

```sh
git add package.json scripts/deployment/cli.ts test/unit/scripts/deployment/cli.spec.ts
git commit -m "feat(deployment): expose safe operator CLI"
```

---

### Task 8: Runbooks and documentation-only backend adoption

**Files:**

- Modify: `docs/runbooks/deployment-preparation.md`
- Modify: `docs/runbooks/deployment.md`
- Modify: `docs/runbooks/dokploy-deployment.md`
- Modify: `docs/runbooks/rollback.md`
- Modify: `docs/roadmap.md`
- Create: `docs/runbooks/backend-codex-deployment-operator-adoption.md`
- Create: `test/unit/ops/deployment-operator-docs-contract.spec.ts`

**Interfaces:**

- Consumes the exact package scripts and environment names implemented in
  Tasks 1–7.
- Produces one human-owned policy layer with no duplicate executable shell
  happy path and one documentation-only later adoption contract.

- [ ] **Step 1: Write a failing documentation contract test**

Read the runbooks/package/example and assert:

- all three package scripts exist;
- deployment runbook links the example and uses `deployment:preflight` and
  `deployment:promote`;
- Dokploy runbook names all nine apply environment variables and contains no
  historical starter candidate/rollback digest;
- rollback uses `deployment:rollback` and still says no down-migration and no
  automatic rollback;
- preparation distinguishes repository from environment readiness and states
  CLI does not provision infrastructure;
- adoption doc contains `adopt`, `reconcile`, `reject`, `backend-codex`,
  atomic identity replacement, product-module preservation and no execution in
  this slice;
- local Alloy/Loki/Tempo/Grafana are explicitly excluded from production
  deployment readiness.

- [ ] **Step 2: Run the docs contract test and verify RED**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/ops/deployment-operator-docs-contract.spec.ts
```

Expected: FAIL because the runbooks still contain the manual adapter and fixed
historical digests.

- [ ] **Step 3: Rewrite deployment policy entrypoint**

In `deployment.md` retain:

- exclusive change window;
- successful Stage workflow/digest/revision evidence;
- migration/runtime role separation;
- candidate and rollback schema compatibility review;
- no down-migration;
- failed promotion decision boundary.

Replace copyable pull/migrate/smoke shell with:

```sh
pnpm deployment:preflight -- --manifest /protected/path/release.json
pnpm deployment:promote -- --manifest /protected/path/release.json
pnpm deployment:promote -- --manifest /protected/path/release.json \
  --apply \
  --evidence /protected/path/promotion-evidence.json
```

State that the second command is offline dry-run and the third is the only live
promotion.

- [ ] **Step 4: Narrow the Dokploy adapter runbook**

Remove the long shell implementation after tests cover equivalent behavior.
Keep:

- official OpenAPI/schema links;
- readiness prerequisite;
- exact list of live environment names;
- private GHCR `read:packages` policy;
- network boundary: operator reaches Dokploy HTTPS and migration PostgreSQL,
  no SSH required for routine deployment;
- no public PostgreSQL/Redis;
- API mutation/response/status assumptions;
- diagnostics and evidence location;
- explicit statement that mock tests are not hosted evidence.

- [ ] **Step 5: Update rollback and preparation**

Use:

```sh
pnpm deployment:rollback -- --manifest /protected/path/release.json \
  --apply \
  --evidence /protected/path/rollback-evidence.json
```

Retain the human schema compatibility gate before the command. In preparation,
add the manifest/evidence fields to the handoff and link
`release-manifest.example.json`; do not claim environment readiness.

- [ ] **Step 6: Write the backend adoption guide**

The guide must explain a later, separately authorized sequence:

1. inspect exact target checkout/branch/HEAD/dirty state/remotes;
2. inventory target workflows, OCI, environment, database/Redis and product
   modules;
3. classify each starter CLI/runbook contract as `adopt`, `reconcile` or
   `reject`;
4. replace repository, GHCR, service, problem namespace, Redis, PostgreSQL and
   telemetry identities atomically;
5. preserve module-local product code;
6. regenerate example/tests and obtain fresh target Stage evidence;
7. stop before push/PR/Dokploy/VPS unless separately authorized.

Explicitly state that this starter slice adds documentation only and does not
inspect or modify `backend-codex`.

- [ ] **Step 7: Update roadmap status without hosted overclaim**

Add the CLI as repository-owned Milestone 7 mechanics and retain the unperformed
hosted drill as the remaining runtime boundary.

- [ ] **Step 8: Run docs contract, format and link checks**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/ops/deployment-operator-docs-contract.spec.ts
corepack pnpm@11.15.1 exec prettier --check docs/runbooks/deployment-preparation.md docs/runbooks/deployment.md docs/runbooks/dokploy-deployment.md docs/runbooks/rollback.md docs/runbooks/backend-codex-deployment-operator-adoption.md docs/roadmap.md test/unit/ops/deployment-operator-docs-contract.spec.ts
git diff --check
```

Expected: PASS.

- [ ] **Step 9: Commit runbooks**

```sh
git add docs/runbooks/deployment-preparation.md docs/runbooks/deployment.md docs/runbooks/dokploy-deployment.md docs/runbooks/rollback.md docs/runbooks/backend-codex-deployment-operator-adoption.md docs/roadmap.md test/unit/ops/deployment-operator-docs-contract.spec.ts
git commit -m "docs(deployment): adopt operator CLI runbooks"
```

---

### Task 9: Final evidence gate and local handoff

**Files:**

- Verify all files changed by Tasks 1–8.
- Do not create generated hosted evidence or edit `backend-codex`.

**Interfaces:**

- Produces fresh local repository evidence only.

- [ ] **Step 1: Inspect the complete diff and repository boundary**

Run:

```sh
git status --short --branch
git diff stage...HEAD --stat
git diff stage...HEAD -- . ':(exclude)docs/superpowers/plans/2026-07-30-deployment-operator-cli.md'
git diff --check
```

Confirm:

- no file outside starter changed;
- no workflow, Docker Compose production service or `src` module changed;
- no real digest, token, password, connection URL or environment record was
  added;
- local observability remains development-only.

- [ ] **Step 2: Run all deployment-focused tests**

```sh
corepack pnpm@11.15.1 run test:unit:run -- test/unit/scripts/deployment test/unit/ops/deployment-operator-docs-contract.spec.ts
```

Expected: all focused suites/tests PASS.

- [ ] **Step 3: Re-run real offline preflight and dry-run**

```sh
corepack pnpm@11.15.1 run deployment:preflight -- --manifest docs/runbooks/release-manifest.example.json
corepack pnpm@11.15.1 run deployment:promote -- --manifest docs/runbooks/release-manifest.example.json
```

Expected: exit `0`; output contains only symbolic non-secret data and the
ordered plan.

- [ ] **Step 4: Prove apply fails before external calls without live inputs**

Use a fresh explicit temp target:

```sh
deployment_temp_dir="$(mktemp -d)"
deployment_evidence_path="$deployment_temp_dir/missing-env.json"
test ! -e "$deployment_evidence_path"
corepack pnpm@11.15.1 run deployment:promote -- \
  --manifest docs/runbooks/release-manifest.example.json \
  --apply \
  --evidence "$deployment_evidence_path"
test "$?" -ne 0
test ! -e "$deployment_evidence_path"
rmdir "$deployment_temp_dir"
```

Run this as separate shell commands so a deliberate non-zero CLI result does not
abort the evidence check.

- [ ] **Step 5: Run the required repository gate**

Use project-pinned runtime:

```sh
env PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  corepack pnpm@11.15.1 run check:quick
```

Expected: PASS. If sandbox produces `listen EPERM` for tsx IPC, repeat the exact
command in an approved capable environment before diagnosing product code.

- [ ] **Step 6: Review final commit history and clean state**

```sh
git log --oneline --decorate stage..HEAD
git status --short --branch
```

Expected: feature commits present; working tree clean.

- [ ] **Step 7: Report the exact boundary**

Report:

- implemented manifest, dry-run, apply orchestration, explicit rollback,
  adapters, evidence and runbooks;
- focused and `check:quick` outputs from this exact revision;
- feature branch/worktree and commits;
- `backend-codex` received documentation in starter only and was not modified;
- no VPS/Dokploy/DNS/hosted PostgreSQL/Redis/S3/GHCR mutation or deployment
  occurred;
- apply logic is mock/local evidence until a later authorized hosted drill.
