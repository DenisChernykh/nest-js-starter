# Account administration

Account administration is an optional auth capability. It is disabled by
default and does not add a frontend, hard delete, dynamic role CRUD, email
changes or administrator-set passwords.

## Modes and prerequisites

Core administration requires:

```dotenv
AUTH_ACCOUNT_ADMINISTRATION_MODE=enabled
```

Invitation and administrator-triggered recovery additionally require:

```dotenv
AUTH_ACCOUNT_EMAIL_WORKFLOWS_MODE=enabled
AUTH_PUBLIC_APP_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
AUTH_SMTP_URL=smtps://user:password@smtp.example.com:465
AUTH_MAIL_FROM=no-reply@example.com
```

Email workflows fail startup validation unless administration is enabled and
all mail/app-origin inputs are present. `AUTH_PUBLIC_APP_URL` must be one of the
configured CORS origins and must use HTTPS in production. SMTP is not a
readiness dependency.

Apply migrations before enabling either mode. Create the first administrator
through the existing CLI provisioning path; HTTP invitation cannot bootstrap
its own administrator.

## Operator contract

The protected endpoints live under `/v1/admin/auth`. Reads require
`auth.accounts.read`; state, retirement, logout-all and email workflows require
`auth.accounts.manage`; role replacement and role-catalog access require
`auth.accounts.roles.manage`. Invitation creation requires both management
permissions.

Fetch account detail immediately before a status, role or retirement mutation
and send its strong `ETag` as `If-Match`. Missing, malformed and stale values
return 428, 400 and 412 respectively. Refetch after either a success or a 412.
An administrator cannot mutate their own account through these operations.

Ordinary status changes are limited to `ACTIVE ↔ DISABLED`. Invitation
acceptance is the only path from `INVITED` to `ACTIVE`; retirement is terminal.
Disabling, retirement, logout-all and successful password-reset confirmation
increment durable session state and best-effort delete Redis sessions. Merely
requesting or sending a reset does not invalidate sessions. A durable mutation
remains effective if Redis cleanup fails; inspect the cleanup-incomplete
security event and repeat logout-all after Redis recovery.

## Invitations and recovery

Invitation tokens are random digests at rest, expire, rotate on resend and are
single-use. Acceptance sets a password, verifies the email, activates the
account and deliberately creates no browser session. The user signs in through
the normal login endpoint afterward.

Administrator-triggered password reset uses the existing public reset
confirmation endpoint. It never sends a password and never lets the
administrator choose one.

Account and token changes commit before SMTP delivery. A successful HTTP
response therefore reports either `mailDelivery: delivered` or
`mailDelivery: failed`; `failed` means the durable workflow exists and should
be resent after mail recovery. Duplicate email, unknown role, missing account
and ineligible-state errors are not mail failures.

## Retirement and email reuse

Retirement deletes credentials, role assignments and auth one-time tokens,
increments session generation, removes Redis sessions and replaces both email
columns with the reserved non-email value `retired:<user-id>`. It cannot be
claimed through ordinary email validation. The user row and product-owned
foreign keys remain intact. The original normalized email can then be used for
a new invitation.

Retirement is not reversible. Confirm the target ID and current ETag before the
request; use disablement when temporary access removal is intended.

## Disable and recovery

Set `AUTH_ACCOUNT_EMAIL_WORKFLOWS_MODE=disabled` first to stop new invitations,
resends, administrator reset requests and public invitation acceptance. Already
persisted tokens remain inert while the mode is disabled. Then set
`AUTH_ACCOUNT_ADMINISTRATION_MODE=disabled` to mode-gate protected
administration operations: after the static authentication and permission
guards, the disabled policy returns the safe `NOT_FOUND` response. Controllers
and their OpenAPI operations remain statically registered. Existing login,
cookie, CSRF, self-service and CLI provisioning contracts remain available
according to their own modes.

For an SMTP outage, restore SMTP without rolling back PostgreSQL and resend the
affected invitation or reset. For Redis loss, follow
[`auth-redis-loss.md`](auth-redis-loss.md); durable status, retirement and
session-generation changes remain authoritative. Hosted SMTP, DNS, Caddy and
secret changes require separate authorized environment verification.
