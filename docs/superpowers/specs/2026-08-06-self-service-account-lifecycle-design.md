# Self-service account lifecycle design

## Outcome

Add an opt-in public email/password account lifecycle to the existing auth
module: registration, email verification with resend, password-reset request
and reset confirmation. The capability reuses the current Argon2id password
policy, opaque Redis sessions, durable session generations, CSRF/origin guards,
RBAC and operator provisioning. It does not introduce another identity source
of truth.

The capability is disabled until `AUTH_SELF_SERVICE_MODE=open`. Disabled mode
keeps operator-created users, login and every authenticated endpoint available,
while self-service endpoints return the existing generic `NOT_FOUND` problem.

## Scope

In scope:

- anonymous email/password registration;
- email verification and explicit bounded resend;
- non-enumerating password-reset request and single-use reset;
- auth-owned SMTP delivery for verification and reset messages;
- local Mailpit transport and a real SMTP integration proof;
- Redis limits for the three email-keyed public request operations;
- committed OpenAPI, architecture, configuration and recovery contracts.

Out of scope:

- automatic login after registration or verification;
- OAuth, OIDC, social providers, external-identity linking, passkeys and MFA;
- account deletion, email-address change, invitations and organizations;
- a shared notification/template framework, delivery history or preferences;
- BullMQ, an outbox, a mail worker, dashboards and administrative replay;
- frontend implementation and hosted SMTP/provider configuration.

`PasswordCredential` remains optional. A later external-identity slice may add
provider identities and reuse verified users plus the existing session issuer;
this slice does not create an `ExternalIdentity` model or infer identity from a
matching email address.

## Durable state

`User` gains nullable `emailVerifiedAt`. Administrative state remains in
`User.status`; verification never re-enables a disabled account. The migration
backfills every pre-existing user with `emailVerifiedAt = createdAt`, so current
operator-created accounts remain login-capable. Initial-admin and operator
provisioning set verification explicitly for users created after the migration.
Self-service registration creates an active user with no role rows and a null
verification timestamp.

Two purpose-specific single-row token models are added:

```text
EmailVerificationToken
  userId       UUID primary key, cascade to User
  tokenDigest  VARCHAR(43) unique
  expiresAt    timestamp
  createdAt    timestamp

PasswordResetToken
  userId       UUID primary key, cascade to User
  tokenDigest  VARCHAR(43) unique
  expiresAt    timestamp
  createdAt    timestamp
```

Each raw token is 32 cryptographically random bytes encoded as canonical
base64url (43 characters). PostgreSQL stores only the base64url SHA-256 digest.
Unkeyed SHA-256 is sufficient because the input has 256 bits of entropy. A new
token replaces the previous token for the same user and purpose. Confirmation
compares the digest, expiry and eligible account state in the committing
transaction, consumes the token exactly once and rejects every losing
concurrent attempt.

Verification tokens expire after 24 hours. Password-reset tokens expire after
30 minutes. Expired rows do not accumulate: each user has at most one row per
purpose, resend/request replaces it, and successful confirmation removes it.

Password reset replaces the credential with optimistic version advancement,
increments `sessionGeneration` and removes the reset token in one PostgreSQL
transaction. Redis `revokeAll` remains best-effort after commit. A Redis cleanup
failure is audited as partial success but cannot make an old session valid
again because authenticated requests compare the durable generation.

## Application contracts

The auth application layer owns these new ports:

```ts
export interface IssuedOneTimeToken {
  readonly rawToken: string
  readonly digest: string
}

export interface OneTimeTokenCodecPort {
  issue(): IssuedOneTimeToken
  digest(rawToken: string): string | undefined
}

export type PublicAuthOperation =
  'register' | 'email-verification-resend' | 'password-reset-request'

export interface PublicAuthRateLimiterPort {
  consume(input: {
    readonly operation: PublicAuthOperation
    readonly ipAddress: string
    readonly normalizedEmail: string
  }): Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly retryAfterMs: number }
  >
}

export interface AuthMailDeliveryPort {
  sendEmailVerification(input: {
    readonly to: string
    readonly verificationUrl: string
  }): Promise<{ readonly delivered: boolean }>
  sendPasswordReset(input: {
    readonly to: string
    readonly resetUrl: string
  }): Promise<{ readonly delivered: boolean }>
}
```

The persistence port adds purpose-specific registration, rotation and
confirmation operations. It returns an email delivery target only for an
eligible account; missing, duplicate, verified or disabled account states are
accepted internally without exposing which state was observed.

Application use cases are:

- `RegisterUserUseCase`;
- `ResendEmailVerificationUseCase`;
- `ConfirmEmailVerificationUseCase`;
- `RequestPasswordResetUseCase`;
- `ConfirmPasswordResetUseCase`.

Every use case checks the immutable self-service mode. Registration never
updates the password or verification token of an existing normalized email.
Resend rotates a token only for an active unverified account. Password-reset
request rotates a token only for an active verified account with a password
credential. Neither request path reveals eligibility in its HTTP result.

The existing login decision remains constant-time for missing credentials and
keeps missing, wrong-password and disabled-account failures generic. Only after
a submitted password matches an active account may login return the stable
`EMAIL_VERIFICATION_REQUIRED` problem. It issues no session and performs no
password rehash before that decision.

## HTTP contract

All five endpoints remain behind the existing browser-origin, Fetch Metadata
and JSON content-type policy. They are public and exempt only from session CSRF
token validation.

| Method | Path                                  | Success | Request            |
| ------ | ------------------------------------- | ------- | ------------------ |
| POST   | `/v1/auth/register`                   | 202     | email, password    |
| POST   | `/v1/auth/email-verification/resend`  | 202     | email              |
| POST   | `/v1/auth/email-verification/confirm` | 204     | token              |
| POST   | `/v1/auth/password-reset/request`     | 202     | email              |
| POST   | `/v1/auth/password-reset/confirm`     | 204     | token, newPassword |

The three request/delivery operations return no response body. Their success
status and minimum response duration do not vary by account existence or
eligibility. The presentation boundary pads accepted outcomes to at least
2,000 ms; the SMTP adapter has a hard 1,500 ms delivery envelope and resolves a
typed failure instead of throwing. This controls the otherwise obvious timing
difference between an SMTP send and a no-send path without claiming perfect
network constant time.

Malformed fields use the existing `VALIDATION_FAILED` response. A canonical but
missing, expired, consumed or ineligible confirmation token maps to the new
`AUTH_TOKEN_INVALID_OR_EXPIRED` problem with status 400. Correct-password login
for an unverified account maps to the new `EMAIL_VERIFICATION_REQUIRED` problem
with status 403. Disabled self-service maps to `NOT_FOUND`; Redis limiter denial
maps to `RATE_LIMIT_EXCEEDED` with `Retry-After`; required PostgreSQL/Redis
failure maps to `DEPENDENCY_UNAVAILABLE`.

Email DTOs use `IsEmail` and a 254-character maximum. Registration and reset
passwords use the existing 12 through 1,024 character policy. Token DTOs require
the canonical `^[A-Za-z0-9_-]{43}$` form before application execution.

## Rate limits and Redis keys

The auth module owns a separate `RedisPublicAuthRateLimiter`; the existing
login limiter and its bytes do not change. It uses `REDIS_AUTH_URL`, the
existing `AUTH_RATE_LIMIT_KEY_SECRET`, the configured environment/key prefix
and an atomic Lua decision over IP and normalized-email counters.

| Operation              | IP limit      | Email limit  | Cooldown |
| ---------------------- | ------------- | ------------ | -------- |
| registration           | 10 per 60 min | 3 per 60 min | none     |
| verification resend    | 10 per 60 min | 3 per 60 min | 60 sec   |
| password-reset request | 10 per 60 min | 3 per 60 min | 60 sec   |

Keys are versioned and contain only HMAC values:

```text
{prefix}:{environment}:auth:public:v1:{operation}:ip:{ipHmac}
{prefix}:{environment}:auth:public:v1:{operation}:account:{emailHmac}
{prefix}:{environment}:auth:public:v1:{operation}:cooldown:{emailHmac}
```

Unknown and existing emails consume the same account and IP limits. The Lua
operation either consumes all applicable counters/cooldown or denies without a
partial update. No `KEYS`, global Redis service or queue Redis connection is
introduced.

## Mail transport and links

The first adapter uses exact dependencies `nodemailer@9.0.3` and
`@types/nodemailer@8.0.1`. It builds text and HTML itself from fixed copy; there
is no template engine, remote URL loading or file loading. SMTP credentials and
raw message URLs are never included in logs, audit events or exceptions.

Open mode requires:

- `AUTH_PUBLIC_APP_URL`: an HTTP(S) origin, HTTPS in production;
- `AUTH_SMTP_URL`: an `smtp:` or `smtps:` URL;
- `AUTH_MAIL_FROM`: one plain RFC email mailbox.

The adapter builds these links:

```text
{AUTH_PUBLIC_APP_URL}/auth/verify-email#token={rawToken}
{AUTH_PUBLIC_APP_URL}/auth/reset-password#token={rawToken}
```

The fragment keeps the token out of the frontend server request, proxy logs and
referrer. The frontend reads the fragment and posts the token to the API. Email
links never call a mutating GET endpoint, so automated link scanners cannot
consume a token.

SMTP delivery happens after the PostgreSQL transition commits. Delivery failure
returns the same public 202 outcome, emits a value-free partial audit event and
leaves a token that the user can replace through resend/request. This is an
explicit best-effort contract. BullMQ alone would not close the PostgreSQL
commit-to-enqueue gap; an outbox and worker would materially expand the runtime
and remain outside this capability.

Mail is not API readiness. Configuration shape is validated at startup, but the
API does not connect to SMTP during startup and does not add SMTP to
`/health/ready`.

Local Compose adds the opt-in `mail` profile using
`axllent/mailpit:v1.30.5@sha256:b868afa176bfd6cce2323ea316cd99ccad77915e51e595748f6d786700ecf109`.
It exposes SMTP 1025 and UI 8025 on loopback, relies on the image's built-in
`/mailpit readyz` healthcheck and remains absent from production Compose.

## Security and observability invariants

- Raw passwords, raw tokens, token digests, SMTP URLs and generated action URLs
  never enter logs, traces, audit events, problem details or response bodies.
- Duplicate registration never replaces credentials, assigns roles or sends a
  registration email automatically.
- Confirmation and password reset are single-use under concurrency.
- Mail failure cannot roll back or fabricate account state.
- Existing session cookie name/attributes, session token/key bytes, CSRF secret
  usage, role definitions and login limiter keys remain byte-compatible.
- Existing operator-created users remain verified and login-capable.
- A registered and verified roleless user can authenticate and call `/auth/me`
  but receives no protected product permission.
- No SMTP or Mailpit dependency is added to health readiness or the production
  deployment topology.

Audit actions are extended with registration, verification send/confirm and
password-reset request/confirm outcomes. Events contain optional user/session
identifiers only after an eligible durable row is known; they never contain an
email address or token. Mail failure is `partial`, invalid confirmation is
`denied`, and generic accepted requests remain value-free.

## Verification strategy

1. Unit decision tables cover all account states, rate-limit outcomes, mail
   outcomes, expiry boundaries, login verification gating and cleanup failure.
2. PostgreSQL integration proves migration backfill, collision safety, token
   rotation, expiry, single-use concurrency and atomic reset/generation update.
3. Redis integration proves atomic IP/account/cooldown behavior, isolation by
   operation/environment and unchanged login keys.
4. Mailpit integration sends both message kinds through the real Nodemailer
   adapter and asserts recipient, subject and raw content through Mailpit's HTTP
   API. Add direct `testcontainers@12.0.4` because tests must not import a
   transitive package implicitly.
5. Browser-style e2e proves origin/content-type policy, generic 202 responses,
   verification-before-login, resend rotation, reset, old-session rejection,
   disabled mode and safe dependency failures.
6. OpenAPI generation, drift/lint, architecture checks, `pnpm check` and
   `pnpm oci:check` are rerun on the final corrected HEAD.
