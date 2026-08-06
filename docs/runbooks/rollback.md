# Explicit API rollback

Rollback is a human decision after schema compatibility is approved. Keep only
the previous immutable image and exact revision as non-secret release metadata;
the previous non-secret image/revision is the only rollback record.
never copy the complete .env or credentials into rollback metadata.

## Compatibility gate

Before changing the API image, prove that the previous image can read the
schema left by the candidate migration. If that review is absent or negative,
do not roll back the image; choose a reviewed roll-forward instead. The rule is
no down-migration.

Validate the previous APP_IMAGE digest and its
org.opencontainers.image.revision label against the recorded SERVICE_REVISION.
Pull it by digest with the read-only GHCR credential and keep the credential out
of command arguments and logs.

## API-only recreation

After explicit approval and validation, change only APP_IMAGE and
SERVICE_REVISION in the server .env, preserving the existing database and Redis
state. Recheck .env mode 0600, then run:

    docker compose --env-file /opt/nest-js-starter/.env --file docker-compose.production.yml config --quiet
    docker compose up --detach --no-deps --wait api
    docker compose ps api
    docker compose logs --tail=200 api

This command does not invoke the migrator, does not run a down-migration and
does not recreate PostgreSQL or auth Redis. The API must use the already
finalized runtime role and the same external Caddy/observability networks.

## Verify and record

Check /health/live, /health/startup, /health/ready and the unauthenticated
/v1/auth/me problem response through host Caddy. Store only the previous and
current image/revision identifiers, timestamps, approval reference and bounded
status/log outcomes. Do not store credentials, URLs containing secrets, cookies,
full environment text or user data.

If readiness or public smoke fails, preserve the failure and stop. Do not loop
automatic retries or select an arbitrary newest image. Hosted Caddy, Loki and
Tempo results remain unverified until a separate authorized drill.
