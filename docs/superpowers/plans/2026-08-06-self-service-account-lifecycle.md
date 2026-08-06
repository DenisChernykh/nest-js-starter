# Self-service Account Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an opt-in, non-enumerating registration, email-verification and password-reset lifecycle inside the existing auth module.

**Architecture:** PostgreSQL remains authoritative for users, credentials, verification state and single-use token digests; auth Redis owns only versioned public-operation limits and existing sessions. The auth module owns a narrow SMTP port implemented by Nodemailer, while local Mailpit provides transport proof without becoming production infrastructure or API readiness.

**Tech Stack:** Node 24, pnpm 11.15.1, NestJS 11, Prisma 7/PostgreSQL, Redis 6 client, Argon2id, Nodemailer 9, Mailpit 1.30.5, Jest/Testcontainers, Swagger/OpenAPI.

## Global Constraints

- Repository: `/Users/denischernykh/projects/starters/nest-js-starter`.
- Base branch and immutable implementation baseline: `stage` at `8a74ef9245fd1d9d0b8df80f55569ecebd338991`.
- Preserve the pre-existing `docs/roadmap.md` working-tree change and the coordinator-authored design/plan files; do not overwrite or discard them.
- Use Node major 24 from `.nvmrc` and plain `pnpm` 11.15.1 from `packageManager`; confirm both before dependency or generated-artifact changes.
- Preserve `docs/architecture/module-boundaries.md`: application code depends on module-local ports, infrastructure implements them, presentation calls use cases, and composition alone wires adapters.
- Preserve exact existing session cookie bytes, Redis session/login-limit keys, Argon2id policy, CSRF/origin behavior, role definitions, operator provisioning and generated OpenAPI workflow.
- Add exact `nodemailer@9.0.3`, `@types/nodemailer@8.0.1` and direct `testcontainers@12.0.4`; preserve `pnpm-workspace.yaml` `allowBuilds` and change it only if pnpm reports an install lifecycle script for one of these exact packages.
- Do not add or update TSDoc; this capability does not run `pnpm lint:tsdoc`.
- Local Conventional Commits are authorized. Push, pull request, merge, deployment, hosted SMTP mutation and destructive cleanup are forbidden.
- Automatic continuation between successful milestones is authorized. A milestone evidence packet is required before continuing.
- Canonical design: `docs/superpowers/specs/2026-08-06-self-service-account-lifecycle-design.md`.

## Authority

- Implementation: authorized by the user.
- Branch: use `feat/self-service-account-lifecycle` in an isolated worktree created from the recorded working-tree state.
- Commit: allowed and required at the preflight documentation checkpoint and after every milestone.
- Push / PR / merge / deploy: forbidden.
- Destructive operations: forbidden unless separately authorized.

## Baseline

- Repository: `/Users/denischernykh/projects/starters/nest-js-starter`.
- Branch: `stage` before isolated execution.
- HEAD: `8a74ef9245fd1d9d0b8df80f55569ecebd338991`.
- Working tree at planning start: modified `docs/roadmap.md`; new design and plan files are coordinator-owned additions to preserve.
- Runtime contract: `.nvmrc` is `24`; `package.json` requires `node >=24 <25`, `pnpm 11.15.1`, `packageManager pnpm@11.15.1`.
- Applicable instructions: root `AGENTS.md`, `docs/architecture/module-boundaries.md`, `docs/architecture/auth-core.md`, `docs/architecture/openapi-contracts.md`, `docs/architecture/durable-jobs.md`.
- Current auth state: PostgreSQL user/password/status/role/session generation, optional password credential, opaque Redis sessions, distributed login limiter, operator provisioning and eight `/v1/auth` operations.
- Current queue state: opt-in BullMQ connection/lifecycle foundation only; no product queue, payload or worker.

## Fixed decisions

- `AUTH_SELF_SERVICE_MODE=disabled|open`; default is `disabled` in every environment. Disabled self-service returns the existing `NOT_FOUND` problem while login and operator-created accounts continue to work.
- Registration creates an active, unverified, roleless user and password credential. Duplicate normalized email returns the same 202 contract and never changes credentials, roles or verification tokens.
- `emailVerifiedAt` is independent of administrative `User.status`. Existing and operator-created users are verified; self-service users cannot log in until verified.
- Correct-password login for an active unverified user returns `EMAIL_VERIFICATION_REQUIRED` without session issuance or password rehash. Missing, wrong-password and disabled failures remain generic.
- Registration and verification do not issue a session. The user performs the existing login flow after verification.
- Verification/reset tokens are canonical 32-byte base64url values; only 43-character SHA-256 base64url digests are stored. Verification TTL is 24 hours; reset TTL is 30 minutes; one row per user and purpose; confirmation is atomic and single-use.
- Password reset changes the credential, increments durable session generation and consumes the token in one transaction, then performs existing best-effort Redis cleanup.
- Registration, verification resend and reset request use atomic Redis IP/account limits. Exact thresholds and key bytes are fixed by the design spec.
- Auth owns `AuthMailDeliveryPort`; Nodemailer SMTP is best-effort after commit. Delivery failure is value-free audit `partial` and the public response remains 202. No BullMQ, outbox or worker is added.
- Accepted generic outcomes are padded to a 2,000 ms minimum; SMTP has a hard 1,500 ms envelope. This removes the direct send/no-send timing split without claiming perfect network constant time.
- Links use the configured app origin and fragments: `/auth/verify-email#token=...` and `/auth/reset-password#token=...`. There is no mutating GET endpoint.
- SMTP is neither startup connectivity nor readiness. Open mode validates config shape but does not connect during bootstrap.
- Local mail uses `axllent/mailpit:v1.30.5@sha256:b868afa176bfd6cce2323ea316cd99ccad77915e51e595748f6d786700ecf109` behind Compose profile `mail`.
- OAuth/OIDC, external identity linking, passkeys, MFA, a notification center, frontend code and hosted provider setup are excluded.

## Global invariants

- Raw passwords, raw tokens, digests, action URLs, email addresses and SMTP URLs never enter logs, traces, public errors or audit metadata.
- Existing session cookie attributes and the existing Redis session/login-limit key formats remain byte-compatible.
- Existing pre-migration users and post-migration operator-created users remain verified and login-capable.
- Unknown and existing email addresses receive the same success status/body and consume the same public-operation limits.
- Disabled accounts cannot verify, request a reset, reset credentials or authenticate.
- A verified roleless user can authenticate and call `/v1/auth/me` but gains no protected product permission.
- No queue Redis, BullMQ registration, product worker, SMTP readiness probe or production Mailpit service appears in the final graph.
- Generated Prisma and OpenAPI artifacts are produced only with repository commands after runtime preflight.

## Execution preflight and planning checkpoint

- [ ] Record `git status --short --branch`, `git rev-parse HEAD`, `git diff --name-status`, `node --version` and `pnpm --version` in the executor callback evidence.
- [ ] Confirm HEAD is the recorded baseline and the only inherited changes are `docs/roadmap.md`, this plan and the design spec. If any other path exists, stop with `SCOPE CONFLICT` and report the exact status.
- [ ] Confirm the isolated branch is `feat/self-service-account-lifecycle`; do not switch or modify the source `stage` worktree.
- [ ] Run `pnpm exec prettier --check docs/roadmap.md docs/superpowers/specs/2026-08-06-self-service-account-lifecycle-design.md docs/superpowers/plans/2026-08-06-self-service-account-lifecycle.md` and require exit 0.
- [ ] Commit the inherited planning state:

```bash
git add docs/roadmap.md \
  docs/superpowers/specs/2026-08-06-self-service-account-lifecycle-design.md \
  docs/superpowers/plans/2026-08-06-self-service-account-lifecycle.md
git commit -m "docs(roadmap): define product capability expansion"
```

- [ ] Emit a checkpoint containing start/final HEAD, exact committed paths, command exit code, commit SHA/subject and clean status, then continue automatically.

## Milestone 1: Durable verification and recovery state

### Objective

Leave a coherent PostgreSQL/application foundation: migrated verification state,
purpose-specific token rows, token codec, atomic persistence operations, verified
operator paths and login verification gating. No public endpoint or SMTP/Redis
public limiter is introduced in this milestone.

### Files

- Modify: `prisma/schema.prisma`.
- Create: `prisma/migrations/20260806090000_self_service_account_lifecycle/migration.sql`.
- Modify: `src/modules/auth/application/auth.types.ts`.
- Modify: `src/modules/auth/application/auth-errors.ts`.
- Modify: `src/modules/auth/application/auth-persistence.port.ts`.
- Create: `src/modules/auth/application/one-time-token-codec.port.ts`.
- Modify: `src/modules/auth/application/login.use-case.ts`.
- Modify: `src/modules/auth/application/create-user.use-case.ts`.
- Modify: `src/modules/auth/application/create-initial-admin.use-case.ts`.
- Modify: `src/modules/auth/infrastructure/node-auth-crypto.adapter.ts`.
- Modify: `src/modules/auth/infrastructure/prisma-auth.mapper.ts`.
- Modify: `src/modules/auth/infrastructure/prisma-auth.repository.ts`.
- Modify: `test/e2e/support/create-auth-test-runtime.ts`.
- Modify: `test/unit/modules/auth/application/login.use-case.spec.ts`.
- Modify: `test/unit/modules/auth/application/create-user.use-case.spec.ts`.
- Modify: `test/unit/modules/auth/infrastructure/node-auth-crypto.adapter.spec.ts`.
- Modify: `test/unit/modules/auth/infrastructure/prisma-auth.mapper.spec.ts`.
- Modify: `test/integration/modules/auth/create-initial-admin.integration.spec.ts`.
- Modify: `test/integration/modules/auth/create-user.integration.spec.ts`.
- Modify: `test/integration/modules/auth/prisma-auth.repository.integration.spec.ts`.
- Modify: `test/integration/platform/database/migration-from-empty.integration.spec.ts` only if its explicit table/column inventory requires the new schema objects.

### Interfaces

The one-time token boundary is exact:

```ts
export interface IssuedOneTimeToken {
  readonly rawToken: string
  readonly digest: string
}

export interface OneTimeTokenCodecPort {
  issue(): IssuedOneTimeToken
  digest(rawToken: string): string | undefined
}

export const ONE_TIME_TOKEN_CODEC: unique symbol = Symbol(
  'ONE_TIME_TOKEN_CODEC',
)
```

Add these persistence input/results without a generic token repository:

```ts
export interface SelfServiceTokenInput {
  readonly tokenDigest: string
  readonly expiresAt: Date
  readonly createdAt: Date
}

export interface SelfServiceRegistrationInput extends SelfServiceTokenInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
}

export type SelfServiceRegistrationResult =
  | { readonly created: true; readonly userId: string; readonly email: string }
  | { readonly created: false }

export interface SelfServiceDeliveryTarget {
  readonly userId: string
  readonly email: string
}

export interface ConfirmPasswordResetInput {
  readonly tokenDigest: string
  readonly now: Date
  readonly passwordHash: string
}
```

The persistence port methods are named exactly:

```ts
registerSelfServiceUser(
  input: SelfServiceRegistrationInput,
): Promise<SelfServiceRegistrationResult>
rotateEmailVerificationToken(
  normalizedEmail: string,
  token: SelfServiceTokenInput,
  now: Date,
): Promise<SelfServiceDeliveryTarget | undefined>
confirmEmailVerification(
  tokenDigest: string,
  now: Date,
): Promise<SelfServiceDeliveryTarget | undefined>
rotatePasswordResetToken(
  normalizedEmail: string,
  token: SelfServiceTokenInput,
  now: Date,
): Promise<SelfServiceDeliveryTarget | undefined>
confirmPasswordReset(
  input: ConfirmPasswordResetInput,
): Promise<SelfServiceDeliveryTarget | undefined>
```

`CredentialSnapshot` gains `emailVerifiedAt: Date | undefined`. Existing
`AuthProjection` and `AuthenticatedPrincipal` do not gain verification fields;
the invariant is enforced before session issuance.

### Ordered implementation

- [ ] Write RED unit cases proving token issue produces two canonical
      43-character values, digest is SHA-256 of the raw bytes, malformed/non-32-byte
      input returns `undefined`, and deterministic injected random bytes produce a
      deterministic digest.
- [ ] Write RED login cases proving a correct password on active unverified state
      throws `EmailVerificationRequiredError`, does not issue a session and does not
      rehash; wrong password and disabled user retain `AuthenticationFailedError`.
- [ ] Write RED PostgreSQL cases for existing-user backfill, verified operator
      creation, roleless unverified self-service creation, normalized-email
      collision without mutation, token rotation, expiry, disabled-state rejection,
      single-winner verification and single-winner reset with generation increment.
- [ ] Run the focused RED commands below and record the expected missing
      field/method/migration failures.
- [ ] Add `emailVerifiedAt`, `EmailVerificationToken` and `PasswordResetToken`
      to Prisma and hand-author the migration. Backfill `email_verified_at` from
      `created_at` before the new application can run; do not make the column
      globally default to now.
- [ ] Implement token issue/digest with Node `randomBytes` and `createHash`,
      canonical length validation and no retained raw value.
- [ ] Extend mapper/repository queries minimally. Keep registration, rotation and
      confirmation atomic under the existing transaction/provider boundary; use
      unique conflict handling only for normalized email/digest collisions.
- [ ] Set verification explicitly in initial-admin and operator create-user
      inputs. Update every direct e2e user fixture insert to set
      `email_verified_at`.
- [ ] Gate login after successful password verification and active-status check,
      before rehash and session issuance.
- [ ] Run Prisma validation/generation and focused GREEN checks.
- [ ] Run `git diff --check`, inspect `git diff --name-status` against this path
      set and commit.

### Verification

RED:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/application/login.use-case.spec.ts \
  test/unit/modules/auth/infrastructure/node-auth-crypto.adapter.spec.ts
```

Expected RED: compile/assertion failure for absent verification state and token
codec behavior.

GREEN:

```bash
pnpm prisma:validate
pnpm prisma:generate
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/application/login.use-case.spec.ts \
  test/unit/modules/auth/application/create-user.use-case.spec.ts \
  test/unit/modules/auth/infrastructure/node-auth-crypto.adapter.spec.ts \
  test/unit/modules/auth/infrastructure/prisma-auth.mapper.spec.ts
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.mjs --runInBand \
  test/integration/modules/auth/create-initial-admin.integration.spec.ts \
  test/integration/modules/auth/create-user.integration.spec.ts \
  test/integration/modules/auth/prisma-auth.repository.integration.spec.ts \
  test/integration/platform/database/migration-from-empty.integration.spec.ts
```

Expected GREEN: every command exits 0; the repository test proves collision,
rotation, expiry, concurrency and transaction behavior against real PostgreSQL.

### Acceptance

- Fresh migration from empty and upgrade from pre-feature schema both leave
  existing users verified.
- Operator provisioning creates verified users; self-service persistence creates
  an unverified roleless user.
- Raw tokens never appear in PostgreSQL rows or repository inputs after digest
  conversion.
- Verification/reset confirmation has exactly one winner under concurrent calls.
- Reset atomically increments `sessionGeneration` with credential replacement.
- Active unverified correct-password login emits the new explicit error and no
  Redis session.

### Do not

- Do not add a generic token repository. If purpose-specific operations cannot
  express a required transition, stop with `SCOPE CONFLICT` and show the exact
  transition.
- Do not add external identities or make `PasswordCredential` required. If a
  schema constraint forces either, stop with `SCOPE CONFLICT`.
- Do not change existing session, role or login-limit persistence. If a test
  implies such a change, preserve the baseline and return `BLOCKED` with the
  failing command.

### Checkpoint

- Commit: `feat(auth): add self-service account state`.
- Required evidence: start/final HEAD, exact paths, migration SQL summary,
  focused command exit codes, `git diff --check`, commit SHA/subject and status.
- Automatic continuation: yes after a complete SUCCESS packet.

## Milestone 2: Public workflows, Redis limits and SMTP delivery

### Objective

Leave all five application workflows composed and independently tested with
exact runtime configuration, atomic public rate limits, bounded best-effort SMTP
delivery and local Mailpit. HTTP routes remain absent until Milestone 3.

### Files

- Modify: `package.json`.
- Modify: `pnpm-lock.yaml`.
- Modify: `pnpm-workspace.yaml` only when pnpm reports a required lifecycle allow entry.
- Create: `src/modules/auth/application/auth-mail-delivery.port.ts`.
- Create: `src/modules/auth/application/public-auth-rate-limiter.port.ts`.
- Create: `src/modules/auth/application/self-service-auth.policy.ts`.
- Create: `src/modules/auth/application/register-user.use-case.ts`.
- Create: `src/modules/auth/application/resend-email-verification.use-case.ts`.
- Create: `src/modules/auth/application/confirm-email-verification.use-case.ts`.
- Create: `src/modules/auth/application/request-password-reset.use-case.ts`.
- Create: `src/modules/auth/application/confirm-password-reset.use-case.ts`.
- Modify: `src/modules/auth/application/auth-audit.port.ts`.
- Modify: `src/modules/auth/application/auth.types.ts` for password-reset cleanup operation only.
- Create: `src/modules/auth/infrastructure/nodemailer-auth-mail.adapter.ts`.
- Create: `src/modules/auth/infrastructure/redis-public-auth-rate-limiter.ts`.
- Create: `src/modules/auth/infrastructure/redis-public-auth-rate-limiter.scripts.ts`.
- Modify: `src/modules/auth/composition/auth.module.ts`.
- Modify: `src/platform/config/runtime-config.types.ts`.
- Modify: `src/platform/config/runtime-defaults.ts`.
- Modify: `src/platform/config/runtime-environment.schema.ts`.
- Modify: `src/platform/config/runtime-environment.ts`.
- Modify: `src/platform/config/runtime-config.service.ts`.
- Modify: `docker-compose.yml`.
- Modify: `.env.example`.
- Create: `test/unit/modules/auth/application/self-service-account-lifecycle.spec.ts`.
- Create: `test/unit/modules/auth/infrastructure/nodemailer-auth-mail.adapter.spec.ts`.
- Create: `test/unit/modules/auth/infrastructure/redis-public-auth-rate-limiter.spec.ts`.
- Modify: `test/unit/modules/auth/application-di.spec.ts`.
- Modify: `test/unit/platform/config/runtime-defaults.spec.ts`.
- Modify: `test/unit/platform/config/runtime-environment.spec.ts`.
- Modify: `test/unit/platform/config/runtime-config.service.spec.ts`.
- Create: `test/integration/modules/auth/redis-public-auth-rate-limiter.integration.spec.ts`.
- Create: `test/integration/modules/auth/nodemailer-auth-mail.integration.spec.ts`.
- Create: `test/integration/support/mailpit-container.ts`.
- Modify: `test/unit/ops/local-compose-runtime-contract.spec.ts`.

### Interfaces

Use the exact application port signatures from the design spec. Runtime auth
config gains one nested immutable value:

```ts
export type AuthSelfServiceMode = 'disabled' | 'open'

export interface AuthSelfServiceRuntimeConfig {
  readonly mode: AuthSelfServiceMode
  readonly publicAppUrl?: string
  readonly smtpUrl?: string
  readonly mailFrom?: string
  readonly verificationTtlMs: number
  readonly passwordResetTtlMs: number
  readonly acceptedResponseFloorMs: number
  readonly mailDeliveryTimeoutMs: number
  readonly registrationIpLimit: number
  readonly registrationAccountLimit: number
  readonly resendIpLimit: number
  readonly resendAccountLimit: number
  readonly resetRequestIpLimit: number
  readonly resetRequestAccountLimit: number
  readonly requestWindowMs: number
  readonly resendCooldownMs: number
}
```

Internal defaults are exact:

```ts
verificationTtlMs: 86_400_000
passwordResetTtlMs: 1_800_000
acceptedResponseFloorMs: 2_000
mailDeliveryTimeoutMs: 1_500
registrationIpLimit: 10
registrationAccountLimit: 3
resendIpLimit: 10
resendAccountLimit: 3
resetRequestIpLimit: 10
resetRequestAccountLimit: 3
requestWindowMs: 3_600_000
resendCooldownMs: 60_000
```

Use-case inputs all carry `ipAddress` where rate limiting applies and an
injected/current `now: Date`. Confirmation inputs carry only token/new password
plus `now`; invalid token lookup occurs before Argon2 hashing on reset.

### Ordered implementation

- [ ] Confirm `node --version` is v24.x and `pnpm --version` is 11.15.1, then run
      dependency changes in a host-capable context:

```bash
pnpm add nodemailer@9.0.3
pnpm add -D @types/nodemailer@8.0.1 testcontainers@12.0.4
```

- [ ] Review pnpm's build-script report. Preserve `allowBuilds` unchanged when
      no new lifecycle script is reported; otherwise add only the exact reported
      package and record the evidence.
- [ ] Write RED configuration cases: disabled default accepts absent mail
      values; open requires all three values; production open requires HTTPS app
      origin; SMTP accepts only `smtp:`/`smtps:`; safe summary exposes mode and a
      boolean only; defensive access cannot mutate nested config.
- [ ] Write RED use-case decision tables for disabled mode, Redis denial,
      duplicate/missing/verified/disabled states, token TTLs, mail sent/failed,
      invalid/expired confirmation, reset cleanup success/failure and value-free
      audit events.
- [ ] Write RED Redis tests proving atomic IP/account/cooldown decisions, no
      partial consumption on denial, same consumption for unknown/existing input,
      operation/environment isolation and unchanged existing login keys.
- [ ] Write RED mail tests proving fixed from/subject/content, escaped HTML,
      fragment URLs, disabled file/URL access, 1,500 ms typed timeout and redacted
      failure. Do not snapshot raw tokens or SMTP credentials.
- [ ] Run the focused RED commands and record failures caused by missing ports,
      adapters and config fields.
- [ ] Implement immutable config validation/build/service access. Staged SMTP
      values may exist while disabled; open mode requires complete valid values.
- [ ] Implement one atomic Lua-backed public limiter with the exact versioned
      HMAC key grammar. Reuse the auth Redis command executor and crypto HMAC; do
      not modify `RedisLoginRateLimiter` or import queue code.
- [ ] Implement the five use cases. Normalize email once, consume limits before
      Argon2, issue/rotate tokens through purpose-specific persistence, construct
      fragment URLs from the validated origin, swallow only typed mail-delivery
      failure, and preserve dependency failures as `AuthDependencyUnavailableError`.
- [ ] Implement Nodemailer transport with `pool: false`, production STARTTLS
      requirement for `smtp:`, TLS verification enabled, remote/file access
      disabled, no startup `verify()`, and a hard typed timeout that closes the
      transport attempt.
- [ ] Compose disabled/open mail implementations, policy, limiter, codec and use
      cases in `AuthModule`; application files import none of these adapters.
- [ ] Add opt-in Mailpit profile with the fixed immutable image, loopback ports
      1025/8025, `MP_MAX_MESSAGES=500`, no volume and no API `depends_on`.
- [ ] Add a real Mailpit Testcontainer proof. Use Mailpit HTTP
      `/api/v1/messages?start=0&limit=50` and `/api/v1/message/{id}/raw` to assert
      recipient, subject, text/HTML content and fragment link for both messages.
- [ ] Run focused GREEN commands, `git diff --check`, inspect exact paths and commit.

### Verification

RED/GREEN unit and config command:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/application/self-service-account-lifecycle.spec.ts \
  test/unit/modules/auth/infrastructure/nodemailer-auth-mail.adapter.spec.ts \
  test/unit/modules/auth/infrastructure/redis-public-auth-rate-limiter.spec.ts \
  test/unit/modules/auth/application-di.spec.ts \
  test/unit/platform/config/runtime-defaults.spec.ts \
  test/unit/platform/config/runtime-environment.spec.ts \
  test/unit/platform/config/runtime-config.service.spec.ts \
  test/unit/ops/local-compose-runtime-contract.spec.ts
```

RED expected: missing module/config/adapter imports or behavior assertions.
GREEN expected: exit 0 with every decision-table row passing.

Real dependency command:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.mjs --runInBand \
  test/integration/modules/auth/redis-public-auth-rate-limiter.integration.spec.ts \
  test/integration/modules/auth/nodemailer-auth-mail.integration.spec.ts
```

Expected GREEN: exit 0; Redis atomicity and both Mailpit messages are observed
through real containers. One host-capable retry of the identical command is
allowed only when the first failure is a Docker/Testcontainers sandbox boundary.

### Acceptance

- Disabled config starts without SMTP values; open config fails startup on
  missing/invalid values without retaining rejected secrets.
- Unknown/existing request paths consume identical Redis policy and produce the
  same application outcome.
- Mail failure never changes a 202-eligible use-case result or rolls back state.
- The adapter completes every attempt within the hard envelope and never logs
  secret-bearing values.
- Mailpit is opt-in locally, immutable, healthchecked by its image and absent
  from API readiness/production Compose.
- No module layer violates the dependency direction.

### Do not

- Do not import BullMQ, queue Redis or a worker. If reliable delivery is argued
  to require them, stop with `SCOPE CONFLICT`; the accepted alternative is
  resend under the best-effort contract.
- Do not create shared mail/template/notification platform code. If a second
  consumer appears, stop and return the new evidence to the coordinator.
- Do not weaken TLS/certificate validation or log the SMTP URL to diagnose a
  failure. Return `BLOCKED` with redacted path/rule or error class evidence.
- Do not make SMTP a startup connection or readiness dependency. If composition
  requires it, use lazy transport creation and keep readiness unchanged.

### Checkpoint

- Commit: `feat(auth): implement self-service account workflows`.
- Required evidence: dependency versions/install outcome, exact paths, unit and
  real-container exit codes, Redis key-prefix proof, Mailpit message summary,
  `git diff --check`, commit SHA/subject and status.
- Automatic continuation: yes after a complete SUCCESS packet.

## Milestone 3: Public HTTP, Problem Details and browser flows

### Objective

Expose the five fixed public operations, preserve browser policy, publish the
new Problem Details/OpenAPI contract and prove the complete registration,
verification, login and reset flows through real API/PostgreSQL/Redis/SMTP.

### Files

- Create: `src/modules/auth/presentation/self-service-auth.dto.ts`.
- Create: `src/modules/auth/presentation/self-service-auth.controller.ts`.
- Create: `src/modules/auth/presentation/auth-problem.definitions.ts`.
- Create: `src/modules/auth/presentation/public-auth-response-delay.ts`.
- Modify: `src/modules/auth/composition/auth.module.ts`.
- Modify: `src/modules/auth/composition/auth-http-problem.contribution.ts`.
- Modify: `src/modules/auth/application/auth-errors.ts`.
- Modify: `src/modules/auth/application/login.use-case.ts` only if Milestone 1
  left the public error mapping portion uncomposed.
- Modify: `docs/api/openapi.json` only through `pnpm openapi:generate`.
- Modify: `test/e2e/auth/auth-test-harness.ts`.
- Create: `test/e2e/auth/self-service-account-lifecycle.e2e.spec.ts`.
- Modify: `test/e2e/auth/authentication.e2e.spec.ts`.
- Modify: `test/e2e/auth/dependency-failures.e2e.spec.ts`.
- Modify: `test/e2e/observability/privacy.e2e.spec.ts`.
- Modify: `test/e2e/logging/auth-audit.e2e.spec.ts`.
- Modify: `test/e2e/openapi/openapi-response-conformance.e2e.spec.ts` only if its
  maintained-operation inventory is explicit.
- Modify: `test/unit/modules/auth/composition/auth-http-problem.contribution.spec.ts`.
- Create: `test/unit/modules/auth/presentation/public-auth-response-delay.spec.ts`.
- Modify: `test/unit/platform/http/errors/problem-registry.spec.ts` only if its
  composed-definition inventory is explicit.

### HTTP contracts

```text
POST /v1/auth/register                   -> 202, empty
POST /v1/auth/email-verification/resend  -> 202, empty
POST /v1/auth/email-verification/confirm -> 204, empty
POST /v1/auth/password-reset/request     -> 202, empty
POST /v1/auth/password-reset/confirm     -> 204, empty
```

All methods use `@PublicEndpoint()` and `@CsrfTokenExempt()` while retaining the
global origin/Fetch Metadata/JSON guard. Use operation IDs:

```text
authRegister
authResendEmailVerification
authConfirmEmailVerification
authRequestPasswordReset
authConfirmPasswordReset
```

Add module-owned problem definitions:

```ts
EMAIL_VERIFICATION_REQUIRED: status 403
AUTH_TOKEN_INVALID_OR_EXPIRED: status 400
```

Map disabled mode to core `NOT_FOUND`, limiter to core
`RATE_LIMIT_EXCEEDED`, dependency failure to core `DEPENDENCY_UNAVAILABLE`, and
the two explicit error classes only to their module definitions.

### Ordered implementation

- [ ] Write RED transport tests for all methods, exact status/body, DTO
      validation, public/CSRF metadata, origin/content-type rejection, IP forwarding
      and 2,000 ms accepted-outcome floor using an injected deterministic delay.
- [ ] Write RED problem contribution tests proving exhaustive mappings and
      composed registration of both new definitions without structural duck typing.
- [ ] Write RED e2e scenarios:

```text
disabled mode -> registration 404 and existing verified login remains 200
new email -> 202, roleless unverified row, verification mail
duplicate email -> same 202/body/minimum duration, no credential/token mutation
unverified correct login -> 403 EMAIL_VERIFICATION_REQUIRED, no session cookie
confirmation -> 204 once; second confirmation -> 400 token invalid/expired
verified login -> 200 and /auth/me -> 200 with no roles
resend -> old verification token rejected; newest token succeeds
reset request unknown/existing -> same 202/body/minimum duration
reset confirmation -> 204 once, password changed, old sessions rejected
disabled user -> generic accepted request but no mail/token transition
Redis outage -> 503 for limited request operations without account mutation
SMTP outage -> 202 with committed token and value-free partial audit
```

- [ ] Run focused RED tests and record 404/missing-definition failures.
- [ ] Implement focused DTO/controller/delay files. Do not append five routes to
      the already large session controller.
- [ ] Compose the controller and use cases in `AuthModule`; preserve global guard
      order and existing `AuthController` behavior.
- [ ] Define and register the two public problem definitions, update exhaustive
      auth failure mapping and list exact possible problems on each Swagger method.
- [ ] Extend the isolated transport harness with five explicit use-case doubles
      and deterministic delay; do not bypass global guards in tests.
- [ ] Extend the real auth runtime with Mailpit only for the new suite and a
      helper that reads captured message fragments without printing raw tokens.
- [ ] Update security audit/privacy assertions so emails, tokens, digests, SMTP
      URL and message URLs are absent from process output and Problem Details.
- [ ] Confirm Node/pnpm versions again, run `pnpm openapi:generate`, inspect the
      wire diff, then run drift/lint and focused browser e2e.
- [ ] Run `git diff --check`, inspect exact paths and commit.

### Verification

Unit/transport RED-to-GREEN:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/composition/auth-http-problem.contribution.spec.ts \
  test/unit/modules/auth/presentation/public-auth-response-delay.spec.ts
```

OpenAPI contract:

```bash
pnpm openapi:generate
pnpm openapi:drift
pnpm openapi:lint
```

Browser/real-dependency flow:

```bash
pnpm build:compiled
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.e2e.config.mjs --runInBand \
  test/e2e/auth/self-service-account-lifecycle.e2e.spec.ts \
  test/e2e/auth/authentication.e2e.spec.ts \
  test/e2e/auth/dependency-failures.e2e.spec.ts \
  test/e2e/logging/auth-audit.e2e.spec.ts \
  test/e2e/observability/privacy.e2e.spec.ts \
  test/e2e/openapi/openapi-response-conformance.e2e.spec.ts
```

Expected GREEN: every command exits 0; OpenAPI contains exactly five new
operations and both module problem codes; e2e covers all listed flows. One
host-capable retry of the identical e2e command is allowed only for a proven
Docker/Testcontainers or sandbox network boundary.

### Acceptance

- Wire paths, methods, statuses, empty bodies, DTO limits and operation IDs match
  the fixed table.
- Accepted register/resend/reset-request outcomes are indistinguishable by
  status/body and meet the tested minimum duration for eligible/ineligible rows.
- Correct-password unverified login is explicit; every other credential failure
  remains generic.
- No scanner-triggerable mutating GET exists and raw tokens appear only in
  captured mail/frontend fragments.
- Reset invalidates old sessions durably even when Redis cleanup fails.
- OpenAPI drift/lint and privacy/audit suites pass with fresh exit 0.

### Do not

- Do not return user IDs, eligibility flags, tokens or mail outcomes. If a
  frontend need is proposed, stop with `SCOPE CONFLICT` and preserve empty
  success bodies.
- Do not exempt public endpoints from Origin, Fetch Metadata or JSON policy. If
  e2e fails on those guards, correct the test request rather than weakening the
  guard.
- Do not hand-edit `docs/api/openapi.json`. If generation differs unexpectedly,
  inspect controller/problem metadata and rerun the repository generator.
- Do not map errors by a structural `code` property. Use explicit auth error
  classes and the module contribution.

### Checkpoint

- Commit: `feat(auth): expose self-service account API`.
- Required evidence: exact route/problem/OpenAPI diff summary, unit/e2e exit
  codes, privacy evidence, `git diff --check`, commit SHA/subject and status.
- Automatic continuation: yes after a complete SUCCESS packet.

## Milestone 4: Operations, recovery and unchanged-core gate

### Objective

Make the capability operable and removable: document enabling, frontend link
handling, local Mailpit, SMTP outage/recovery and production configuration;
update roadmap state; prove default-disabled and production Compose contracts;
finish with the repository quick gate. Full aggregate and OCI gates remain the
coordinator's post-review responsibility.

### Files

- Modify: `docs/architecture/auth-core.md`.
- Modify: `docs/architecture/foundation-scope.md`.
- Modify: `docs/architecture/openapi-contracts.md`.
- Modify: `docs/roadmap.md`.
- Create: `docs/runbooks/self-service-account-lifecycle.md`.
- Modify: `docs/runbooks/local-development.md`.
- Modify: `docs/runbooks/deployment-security.md`.
- Modify: `docs/runbooks/deployment.md`.
- Modify: `docs/runbooks/production.env.example`.
- Modify: `docker-compose.production.yml`.
- Modify: `README.md`.
- Modify: `test/unit/ops/compose-vps-deployment-docs-contract.spec.ts`.
- Modify: `test/unit/ops/local-compose-runtime-contract.spec.ts`.
- Modify: `test/unit/ops/production-compose-runtime-contract.spec.ts`.
- Modify: `test/unit/ops/production-preflight-contract.spec.ts`.

### Documentation contract

The new runbook must contain these concrete procedures:

```text
enable: validate mode, app origin, SMTP URL/from, apply migration, restart API
local: start --profile mail, enable open mode, inspect http://127.0.0.1:8025
smoke: register -> capture verification -> confirm -> login -> reset -> old session rejected
outage: SMTP is not readiness; requests stay generic; inspect partial audit counts
recovery: restore SMTP, request resend/new reset token, never recover raw token from DB
disable: set mode disabled and restart; existing login remains available
rollback: old application after migration ignores additive tables/nullable column; no destructive down migration
frontend: read fragment, POST token, clear fragment from browser history
```

Production Compose passes `AUTH_SELF_SERVICE_MODE` with default `disabled` and
passes optional empty app/SMTP/from values. Enabling open mode requires the
server-side environment values; Mailpit remains absent. SMTP credentials are
secret-manager/server values and must not be committed.

### Ordered implementation

- [ ] Write RED ops contract assertions for default-disabled local/production
      resolution, opt-in Mailpit, production open-mode variables, no production
      Mailpit/queue/worker dependency and documented recovery steps.
- [ ] Run the focused RED command and record the missing documentation/config
      assertions.
- [ ] Update architecture docs to replace the old “no registration/reset” text
      with the exact opt-in state and preserve the external-identity/notification
      exclusions.
- [ ] Update the roadmap Milestone 9 status to implemented on the feature branch
      without claiming merge, CI, deployment or hosted SMTP. Preserve the rest of
      the user's capability expansion roadmap.
- [ ] Write the runbook and local/production deployment instructions using only
      symbolic SMTP secrets and the exact commands in the documentation contract.
- [ ] Pass disabled/open variables through production Compose without adding a
      service dependency. Leave `docker-compose.production.rollback.yml` unchanged;
      it overrides only the active image/revision and has no environment inventory.
- [ ] Run focused ops GREEN, format only the exact changed paths, then run
      `pnpm check:quick` once on the milestone HEAD.
- [ ] Run `git diff --check`, inspect final feature path inventory and commit.
- [ ] Emit the final executor callback; do not run push/PR/merge/deploy or the
      coordinator-owned aggregate gates.

### Verification

RED/GREEN ops contract:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/ops/local-compose-runtime-contract.spec.ts \
  test/unit/ops/compose-vps-deployment-docs-contract.spec.ts \
  test/unit/ops/production-compose-runtime-contract.spec.ts \
  test/unit/ops/production-preflight-contract.spec.ts
```

Milestone gate:

```bash
pnpm check:quick
```

Expected GREEN: both commands exit 0; quick gate includes fresh format, Prisma,
OpenAPI drift/lint, lint, typecheck, all unit, architecture and compiled build
evidence.

### Acceptance

- A copy owner can enable, smoke, diagnose, recover and disable the capability
  without reading source or recovering secrets from the database.
- Default local and production Compose keep self-service disabled; production
  contains no Mailpit and no SMTP readiness/dependency edge.
- The roadmap states feature-branch implementation only and does not imply
  merge, publication, deployment or hosted verification.
- `pnpm check:quick` has a fresh successful exit code on the milestone HEAD.
- Final status is clean and contains only authorized feature commits.

### Do not

- Do not claim CI, OCI, hosted SMTP, deployment or merge evidence. If docs need
  those claims, state them as unperformed boundaries.
- Do not add secrets, provider-specific credentials or a production mail
  container. Use symbolic environment names and external SMTP ownership.
- Do not weaken or delete an ops contract to obtain green output. Correct the
  implementation/docs or return `BLOCKED` with the exact assertion.
- Do not run destructive migration rollback. Document additive compatibility
  and use forward recovery.

### Checkpoint

- Commit: `docs(auth): document self-service operations`.
- Required evidence: exact doc/Compose paths, focused ops and quick-gate exit
  codes, final commit list, branch/HEAD/status, aggregate gate deferred to the
  coordinator, callback delivery status.
- Automatic continuation: no; return final `SUCCESS`, `BLOCKED`,
  `EVIDENCE INCOMPLETE` or `SCOPE CONFLICT` callback.

## Global Do not

- Do not expand scope or alter a fixed contract. If repository evidence requires
  a product, architecture or integration decision absent from this plan, stop
  and return `SCOPE CONFLICT` with exact evidence.
- Do not overwrite, reset, clean, stash or reformat unrelated user state. If the
  inherited path set differs from baseline, stop before edits and return
  `SCOPE CONFLICT`.
- Do not weaken, skip, delete or rewrite checks merely to obtain green output.
  Return `BLOCKED` with the exact failing command and safe attempted correction.
- Do not claim PASS without a fresh exit code 0. A lost/truncated terminal result
  is `EVIDENCE INCOMPLETE`, not success; rerun once only when the plan authorizes
  an identical capable-context retry.
- Do not push, open/modify a PR, merge, deploy, mutate hosted SMTP/DNS/secrets or
  resolve remote review threads. Stop before any such action and report the
  required authority.
- Do not run destructive Git/database/Docker cleanup. Preserve containers,
  volumes, worktrees, caches and unrelated Compose projects.
- Do not introduce a generic repository/controller/service, global Redis/mail
  abstraction, queue consumer or notification framework. Keep every new port
  and adapter inside auth.
- Do not hand-edit generated Prisma client or OpenAPI JSON. Use the repository
  generators after Node/pnpm preflight and review the generated diff.

## Executor callback contract

For each milestone, return the standard checkpoint fields from
`plan-and-orchestrate-delivery`: start HEAD, branch/status, implemented
contracts, exact paths, excluded behavior evidence, every command with exit
code, `git diff --check`, commit SHA/subject, final status and deviations.
Continue automatically only after recording that packet locally in the task
message. On final success send one compact callback to the source task ID
provided in the executor packet.

## Post-execution review and fix policy

After executor success, the coordinator audits branch, ancestry, path set and
reported evidence. It then dispatches exactly one independent read-only Sol
`max` whole-feature reviewer against base
`8a74ef9245fd1d9d0b8df80f55569ecebd338991` and final HEAD. Confirmed findings
are classified by the coordinator and sent as one consolidated fix wave to the
same executor. At most one changed-risk re-review is permitted; no third review
turn is automatic.

## Final aggregate gate

Run only after the review/fix wave on the final corrected HEAD:

```bash
pnpm check
pnpm oci:check
git diff --check
git status --short --branch
```

The coordinator owns this gate. One identical host-capable retry is allowed
only when fresh output proves a sandbox, Docker/Testcontainers, registry or DNS
environment boundary. Product/test failures are corrected, not reclassified as
environment failures.

## Luna readiness

`READY`

- Remaining decisions: none.
- Inputs, outputs, state ownership, HTTP/problem contracts, exact dependencies,
  rate limits, TTLs, mail failure behavior, runtime configuration, exclusions,
  commit policy, retries, callbacks and final gates are explicit.
- Every milestone leaves an independently testable coherent state and names the
  existing behavior that must remain unchanged.
- Mechanical repository details may be inspected read-only, but the executor
  does not choose a different architecture or product behavior.
- Luna can execute all milestones without inventing a requirement.
