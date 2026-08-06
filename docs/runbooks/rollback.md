# Explicit API rollback

Rollback is a human decision after explicit schema compatibility approval. Keep
only the previous immutable image and exact revision as non-secret release
metadata. The previous non-secret image/revision is the only rollback record.
Never copy the complete .env or credentials into rollback metadata.

The canonical production prefix is:

    production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --env-file /opt/nest-js-starter/active-api.env --file /opt/nest-js-starter/docker-compose.production.yml --file /opt/nest-js-starter/docker-compose.production.rollback.yml)

## Compatibility and image gates

Prove that the previous API image can read the candidate schema. If that review
is absent or negative, choose a forward-only fix; there is no down-migration.
Validate the previous image and revision with the tracked helper without changing
the global APP_IMAGE or SERVICE_REVISION values in .env:

    set -eu
    set +x
    set -a
    . /opt/nest-js-starter/.env
    set +a
    (
      registry_config="$(mktemp -d /run/user/$(id -u)/nest-js-starter-ghcr.XXXXXX)"
      chmod 700 "$registry_config"
      cleanup_registry_config() {
        DOCKER_CONFIG="$registry_config" docker logout ghcr.io >/dev/null 2>&1 || true
        rm -rf "$registry_config"
      }
      trap cleanup_registry_config EXIT
      trap 'exit 129' HUP
      trap 'exit 130' INT
      trap 'exit 143' TERM
      printf '%s' "$GHCR_READ_TOKEN" | DOCKER_CONFIG="$registry_config" docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
      DOCKER_CONFIG="$registry_config" docker pull "$previous_image"
      APP_IMAGE="$previous_image" SERVICE_REVISION="$previous_revision" DOCKER_CONFIG="$registry_config" \
        /opt/nest-js-starter/config/deployment/production-preflight.sh
    )
    unset GHCR_READ_TOKEN GHCR_USERNAME

The helper requires a lowercase GHCR digest, exact 40-hex revision, matching
org.opencontainers.image.revision label and an exact pulled RepoDigest. The
approved previous image is pulled explicitly inside the transient mode-0700
registry subshell before it is inspected; the credential state is removed before
rollback continues.

## API-only desired configuration

The rollback override is tracked at
docker-compose.production.rollback.yml. The canonical Compose prefix always
loads it together with the non-secret `active-api.env`. A normal promotion writes
the candidate digest/revision there; rollback atomically replaces only
ACTIVE_API_IMAGE and ACTIVE_API_REVISION with the approved previous values. It
does not edit /opt/nest-js-starter/.env, global APP_IMAGE or global
SERVICE_REVISION. The resolved rollback diff changes only api.image and
api.environment.SERVICE_REVISION. Migrator desired image/environment stays
byte-equivalent.

After approval and validation, persist the desired API state and recreate only
API. Because every production and recovery command uses the same prefix, a later
`up api` cannot silently restore the rejected candidate:

    active_api_next="$(mktemp /opt/nest-js-starter/.active-api.env.XXXXXX)"
    chmod 0640 "$active_api_next"
    printf 'ACTIVE_API_IMAGE=%s\nACTIVE_API_REVISION=%s\n' \
      "$previous_image" "$previous_revision" >"$active_api_next"
    mv -f "$active_api_next" /opt/nest-js-starter/active-api.env
    "${production_compose[@]}" up --detach --no-deps --wait api
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
