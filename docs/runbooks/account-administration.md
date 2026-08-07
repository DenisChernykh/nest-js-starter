# Account administration

Account administration is an optional auth capability. It is disabled by
default and does not add a frontend, hard delete, dynamic role CRUD, email
changes or administrator-set passwords.

## Modes and prerequisites

Core administration requires:

```dotenv
AUTH_ACCOUNT_ADMINISTRATION_MODE=enabled
```

Apply migrations before enabling the mode. Create administrators through the
existing CLI provisioning path. Invitations and administrator-triggered
recovery belong to the dependent email-workflows delivery and are not exposed
by the core capability.

## Operator contract

The protected endpoints live under `/v1/admin/auth`. Reads require
`auth.accounts.read`; state, retirement and logout-all require
`auth.accounts.manage`; role replacement and role-catalog access require
`auth.accounts.roles.manage`.

Fetch account detail immediately before a status, role or retirement mutation
and send its strong `ETag` as `If-Match`. Missing, malformed and stale values
return 428, 400 and 412 respectively. Refetch after either a success or a 412.
An administrator cannot mutate their own account through these operations.

Ordinary status changes are limited to `ACTIVE ↔ DISABLED`; `INVITED` cannot be
activated through the status endpoint and retirement is terminal. Disabling,
retirement and logout-all increment durable session state and best-effort delete
Redis sessions. A durable mutation remains effective if Redis cleanup fails;
inspect the cleanup-incomplete security event and repeat logout-all after Redis
recovery.

## Retirement and email reuse

Retirement deletes credentials, role assignments and auth one-time tokens,
increments session generation, removes Redis sessions and replaces both email
columns with `retired+<user-id>@invalid.local`. The user row and product-owned
foreign keys remain intact. The original normalized email is then available to
a later provisioning or invitation workflow.

Retirement is not reversible. Confirm the target ID and current ETag before the
request; use disablement when temporary access removal is intended.

## Disable and recovery

Set `AUTH_ACCOUNT_ADMINISTRATION_MODE=disabled` to hide protected
administration operations. Existing login, cookie, CSRF, self-service and CLI
provisioning contracts remain available according to their own modes.

For Redis loss, follow [`auth-redis-loss.md`](auth-redis-loss.md); durable
status, retirement and session-generation changes remain authoritative. Hosted
DNS, Caddy and secret changes require separate authorized environment
verification.
