# Self-service account lifecycle

This capability is opt-in. Every environment starts with
`AUTH_SELF_SERVICE_MODE=disabled`; existing login and operator provisioning
remain available in that mode. Open mode is an application configuration
change, not a hosted SMTP or frontend deployment.

## Enable

Set the following server-side values before starting the API:

```dotenv
AUTH_SELF_SERVICE_MODE=open
AUTH_PUBLIC_APP_URL=https://app.example.com
AUTH_SMTP_URL=smtps://username:password@smtp.example.com:465
AUTH_MAIL_FROM=Accounts <accounts@example.com>
```

The application origin must be HTTPS in production. The SMTP URL must use
`smtp:` or `smtps:`; keep credentials in the server secret manager and never
commit them. Apply the additive Prisma migration, then restart the API:

```sh
pnpm prisma migrate deploy
docker compose up --detach --wait api
```

SMTP is created lazily and is not a startup or readiness dependency. A mail
provider outage must not make `/health/ready` fail.

## Local Mailpit

Copy `.env.example` to `.env`, set `AUTH_SELF_SERVICE_MODE=open`, and start the
opt-in Mailpit profile:

```sh
docker compose --profile mail up --detach --wait mail
docker compose up --detach --wait postgres redis-auth migrator api
```

Inspect captured messages at <http://127.0.0.1:8025>. Mailpit is local test
transport only and is not part of production Compose or API readiness.

## Smoke test

Run the complete browser-style sequence with a fresh test address:

1. Use `register` with an email and password; capture verification in Mailpit.
2. read fragment token and POST it to the confirmation route.
3. Log in through the existing session flow and verify `/v1/auth/me`.
4. Request a password reset, capture the new message and confirm the reset.
5. Confirm old session rejected after the reset.

Accepted registration, resend and reset-request responses are intentionally
empty and non-enumerating. Never put a token in a log, Problem Details body or
database query output.

## SMTP outage

SMTP is not readiness. Registration and recovery requests remain generic and
the PostgreSQL transition is committed before best-effort delivery. Inspect
value-free `partial audit` records and counts; do not
search logs for an email, token, digest, action URL or SMTP URL.

## Recovery

Restore the SMTP URL/from values in the external secret manager, restart the
API, and request a resend or a new password-reset token.
never recover raw token from DB. Only purpose-specific SHA-256 digests are
stored there.
An old verification or reset token must remain unusable after rotation or
consumption.

## Disable

Set `AUTH_SELF_SERVICE_MODE=disabled` and restart the API. Public lifecycle
routes return the existing generic `NOT_FOUND` problem, while existing verified
users can still use the normal login flow and operators can still provision
users.

## Rollback

The migration is additive: an old application can ignore the new nullable
verification column and token tables after the migration. Use a forward
application rollback and recovery procedure; do not run a destructive down
migration or delete the token tables.

## Frontend fragment handling

The verification and reset links use `/auth/verify-email#token=...` and
`/auth/reset-password#token=...`. The frontend reads the token from the URL
fragment, POSTs it to the corresponding confirmation endpoint.
clear fragment from browser history immediately. The server has no mutating
GET confirmation endpoint.

Hosted SMTP/DNS/Caddy setup and deployment verification are outside this local
runbook and remain unperformed until an authorized operations drill.
