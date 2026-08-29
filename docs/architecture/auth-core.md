# Identity-access core

## Capability ownership

The feature-first `src/modules/identity-access` context separates six runtime
capabilities:

- `identity` owns the stable `userId` and fresh PostgreSQL security projection;
- `sessions` owns Redis sessions, durable invalidation, CSRF and the browser
  cookie adapter;
- `authentication` owns password login, Argon2id, rehash and login throttling;
- `authorization` owns the single code-defined role registry, principal
  resolution, request context, guards, decorators, documentation policy and
  `GET /auth/me`;
- `account-lifecycle` owns registration, email verification, password recovery,
  invitations, one-time-token policy, public rate limits and ceremony mail;
- `account-administration` owns account queries/mutations, roles, retirement,
  administrator logout-all and PostgreSQL-only operator provisioning.

The dependency DAG is defined in
[`module-boundaries.md`](module-boundaries.md#identity-access-internal-capabilities).
`IdentityAccessModule` creates one configured `AuthorizationModule`, passes that
same dynamic module to lifecycle and administration, and registers exactly one
global chain in this order: `AuthenticationGuard`, `BrowserOriginGuard`,
`SessionCsrfGuard`, `PermissionGuard`, then one `AuthRequestInterceptor`.
There is no global auth module, `forwardRef()` or parallel provider graph.

## Durable and ephemeral state

PostgreSQL owns users, password credentials, independent `emailVerifiedAt`,
status, code-owned role keys, per-user `sessionGeneration`, singleton
`globalSessionEpoch` and purpose-specific verification/reset token digests.
Every authenticated request reloads that projection; it is never cached.
Unknown roles and missing/invalid singleton state fail closed.

Passwords use the fixed Argon2id policy (`m=19456`, `t=2`, `p=1`, 32-byte
hash). Successful login upgrades an older valid hash with optimistic credential
versioning. Missing user, wrong password and disabled user share one generic
response and the missing-user path verifies a constant dummy PHC.

Auth Redis stores finite opaque sessions and their owner index. The
256-bit raw token exists only in the HttpOnly browser cookie; Redis receives a
session-secret HMAC. Public session IDs and CSRF seeds are independently random.
Lua scripts create/touch/revoke keys and TTLs atomically without runtime `KEYS`.

The raw session-store port is private to `sessions`. Authorization consumes a
narrow session-resolution application contract that validates the Redis record
against the fresh identity projection, per-user generation and global epoch.
Every authenticated request performs that resolution before code-owned roles
are converted to permissions.

## Authentication-provider seam

Email remains the required account identifier and ceremony-delivery channel;
password is the currently implemented authentication method. Email is not a
generic authentication provider, and a magic link would be a separate
passwordless method.

A future provider adapter follows one path: verify provider proof, safely
resolve or explicitly link a stable local `userId`, then call `SessionIssuer`.
The issuer accepts only `userId`, `nowMs`, `deviceLabel` and
`networkFingerprint`; it reloads active identity, generation and epoch itself.
Providers cannot supply roles, status, generation or epoch, cannot access Redis
infrastructure and cannot auto-link accounts by matching email. The tracked
[`authentication/providers`](../../src/modules/identity-access/authentication/providers/README.md)
boundary documents this contract without adding a speculative registry,
adapter or external-identity schema.

## Browser boundary

Authentication is default-on. Health, login, the five self-service account
lifecycle operations and invitation acceptance are statically public endpoints.
Feature policy decides whether an optional operation executes:
`AUTH_SELF_SERVICE_MODE=open` enables the five self-service operations, while
invitation acceptance belongs to the separate account-email-workflows policy.
All routes remain registered and present in OpenAPI; a disabled policy maps its
optional use case to the existing `NOT_FOUND` problem. Production uses
`__Host-session; Secure; HttpOnly; SameSite=Lax; Path=/` without `Domain`;
development uses a non-secure starter-specific name.

Unsafe requests require all of:

- exact configured `Origin`, or exact origin derived from `Referer`;
- no `Sec-Fetch-Site: cross-site`;
- `Content-Type: application/json`;
- constant-time equality with the session-bound `X-CSRF-Token`.

Login is exempt only from the session token/CSRF header and still passes origin
and content-type checks. Permission metadata is an all-of conjunction; duplicate
metadata fails closed.

Password change and logout-all increment durable generation before best-effort
Redis cleanup. Authenticated password change also deletes any outstanding
password-reset token in that same PostgreSQL transaction. Therefore partial
cleanup cannot restore old sessions. Revocation of one session is owner-scoped.
Self-service registration, email verification, password recovery and
invitations remain in account lifecycle, with PostgreSQL authoritative for
state and digest-only single-use tokens.

Account-administration application methods receive a transport-neutral numeric
`expectedRevision`. HTTP presentation alone parses and formats ETags and maps a
stale revision back to the existing `412` contract. Administrator mutations
reauthorize the actor inside the same transaction after ordered row locks.

The public source API is only `AuthenticatedPrincipal`, `CurrentPrincipal` and
`RequirePermission` through `@/modules/identity-access`. HTTP routes, cookies,
OpenAPI operation IDs/tags, Problem Details, `AUTH_*` configuration, Redis key
and session formats, audit events, CLI names and database tables remain stable.

OAuth/OIDC, passkeys, MFA, organizations, a notification center and generic
account CRUD remain separate capabilities.
