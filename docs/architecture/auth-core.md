# Auth core

## Durable and ephemeral state

PostgreSQL owns users, password credentials, status, code-owned role keys,
per-user `sessionGeneration` and singleton `globalSessionEpoch`. Every
authenticated request reloads that projection; it is never cached. Unknown
roles and missing/invalid singleton state fail closed.

Passwords use the fixed Argon2id policy (`m=19456`, `t=2`, `p=1`, 32-byte
hash). Successful login upgrades an older valid hash with optimistic credential
versioning. Missing user, wrong password and disabled user share one generic
response and the missing-user path verifies a constant dummy PHC.

Auth Redis stores finite opaque sessions and their owner index. The
256-bit raw token exists only in the HttpOnly browser cookie; Redis receives a
session-secret HMAC. Public session IDs and CSRF seeds are independently random.
Lua scripts create/touch/revoke keys and TTLs atomically without runtime `KEYS`.

## Browser boundary

Authentication is default-on. Only health and login are public. Production uses
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
Redis cleanup. Therefore partial cleanup cannot restore old sessions. Revocation
of one session is owner-scoped. No JWT, Passport, OAuth, registration, reset or
generic account CRUD is part of this slice.
