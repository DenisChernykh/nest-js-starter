# Explicit API rollback

Rollback is a human decision after explicit schema compatibility approval. Keep
only the previous immutable image and exact revision as non-secret release
metadata. The previous non-secret image/revision is the only rollback record.
Never copy the complete .env or credentials into rollback metadata.

The canonical production prefix is:

    production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --file /opt/nest-js-starter/docker-compose.production.yml)

## Compatibility and image gates

Prove that the previous API image can read the candidate schema. If that review
is absent or negative, choose a forward-only fix; there is no down-migration.
Validate the previous image and revision with the tracked helper without changing
the global APP_IMAGE or SERVICE_REVISION values in .env:

    set -eu
    set +x
    . /opt/nest-js-starter/.env
    APP_IMAGE="$previous_image" SERVICE_REVISION="$previous_revision" \
      /opt/nest-js-starter/config/deployment/production-preflight.sh

The helper requires a lowercase GHCR digest, exact 40-hex revision, matching
org.opencontainers.image.revision label and an exact pulled RepoDigest. Use the
transient mode-0700 DOCKER_CONFIG/login/logout procedure from deployment.md.

## API-only desired configuration

The rollback override is tracked at
docker-compose.production.rollback.yml. It supplies separately recorded,
non-secret ROLLBACK_APP_IMAGE and ROLLBACK_SERVICE_REVISION only to api. It
does not edit /opt/nest-js-starter/.env, global APP_IMAGE or global
SERVICE_REVISION. The normal candidate keeps API and migrator on the same
immutable image/revision; the resolved rollback diff changes only api.image and
api.environment.SERVICE_REVISION. Migrator desired image/environment stays
byte-equivalent.

After approval and validation, recreate only API:

    ROLLBACK_APP_IMAGE="$previous_image" ROLLBACK_SERVICE_REVISION="$previous_revision" "${production_compose[@]}" --file /opt/nest-js-starter/docker-compose.production.rollback.yml up --detach --no-deps --wait api
    "${production_compose[@]}" ps api
    "${production_compose[@]}" logs --tail=200 api

This does not invoke the migrator, does not run a down-migration and does not
recreate PostgreSQL or auth Redis. The API uses the existing finalized runtime
role and external Caddy/observability networks.

## Verify and record

Run bounded public live/startup/ready and unauthenticated auth smoke through
host-owned Caddy. Record only previous/current non-secret image and revision,
timestamps, approval reference and bounded status/log outcomes. If readiness or
public smoke fails, preserve the failure and stop; do not select an arbitrary
newest image or loop automatic retries. Hosted Caddy, Loki and Tempo results
remain unverified until an authorized drill.
