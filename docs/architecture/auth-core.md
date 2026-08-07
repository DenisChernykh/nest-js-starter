# Auth core

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

## Browser boundary

Authentication is default-on. Health, login and the five opt-in self-service
account lifecycle operations are public. Self-service is disabled unless
`AUTH_SELF_SERVICE_MODE=open`; disabled mode maps those operations to the
existing `NOT_FOUND` problem. Production uses `__Host-session; Secure; HttpOnly;
SameSite=Lax; Path=/` without `Domain`; development uses a non-secure
starter-specific name.

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
Self-service registration, email verification and password recovery remain
inside auth, with PostgreSQL authoritative for state and single-use digests.
OAuth/OIDC, passkeys, MFA, organizations, a notification center and generic
account CRUD remain separate capabilities.
