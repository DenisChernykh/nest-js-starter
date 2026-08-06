# Production Compose and Caddy preparation

This runbook prepares a normal VPS installation without mutating the VPS, DNS,
host-owned Caddy, PostgreSQL, Redis or hosted observability. The canonical
operator path is the Compose project; hosted readiness remains unverified.

## Tracked files and protected secret file

Install these absolute tracked paths under /opt/nest-js-starter:

- docker-compose.production.yml
- docker-compose.production.rollback.yml
- config/deployment/production-preflight.sh
- config/deployment/postgres/prepare-roles.sql
- config/deployment/postgres/finalize-roles.sql
- docs/runbooks/production.env.example

Copy the symbolic template, set the mode before entering values, and verify
again after an atomic rotation:

    cp /opt/nest-js-starter/docs/runbooks/production.env.example /opt/nest-js-starter/.env
    chmod 600 /opt/nest-js-starter/.env
    stat -c '%a %n' /opt/nest-js-starter/.env

The real server-side .env is the only persistent deployment/runtime secret file.
Do not put its contents in release metadata, shell history, logs, argv or
support tickets.

Every production command uses this exact prefix:

    production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --env-file /opt/nest-js-starter/active-api.env --file /opt/nest-js-starter/docker-compose.production.yml --file /opt/nest-js-starter/docker-compose.production.rollback.yml)

## Inputs and immutable publication

Required operator inputs are immutable APP_IMAGE, exact 40-lowercase-hex
SERVICE_REVISION, GHCR_USERNAME/GHCR_READ_TOKEN, separate
POSTGRES_ADMIN_USER/POSTGRES_ADMIN_PASSWORD,
POSTGRES_MIGRATOR_USER/POSTGRES_MIGRATOR_PASSWORD and
POSTGRES_RUNTIME_USER/POSTGRES_RUNTIME_PASSWORD, POSTGRES_DB,
DATABASE_POOL_MAX, REDIS_PASSWORD, REDIS_KEY_PREFIX, four auth secrets,
PUBLIC_API_URL, CORS_ORIGINS, TRUST_PROXY_CIDRS, API_DOCS_MODE, CADDY_NETWORK,
CADDY_UPSTREAM_ALIAS, CADDY_CONTAINER, OBSERVABILITY_NETWORK and the OTLP
service inputs.

Trusted same-repository pull request publication is allowed after the full gate;
trusted same-repository pull requests other than Dependabot can publish after
the full stage gate; stage pushes also publish. Use the digest from that
successful gate, not a tag.

Use the transient client credential directory and the tracked executable helper:

    set -eu
    set +x
    set -a
    . /opt/nest-js-starter/.env
    set +a
    (
      registry_config="$(mktemp -d /run/user/$(id -u)/nest-js-starter-ghcr.XXXXXX)"
      chmod 700 "$registry_config"
      trap 'DOCKER_CONFIG="$registry_config" docker logout ghcr.io >/dev/null 2>&1 || true; rm -rf "$registry_config"' EXIT
      trap 'exit 129' HUP
      trap 'exit 130' INT
      trap 'exit 143' TERM
      printf '%s' "$GHCR_READ_TOKEN" | DOCKER_CONFIG="$registry_config" docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
      DOCKER_CONFIG="$registry_config" docker pull "$APP_IMAGE"
      DOCKER_CONFIG="$registry_config" /opt/nest-js-starter/config/deployment/production-preflight.sh
    )
    unset GHCR_READ_TOKEN GHCR_USERNAME
    active_api_next="$(mktemp /opt/nest-js-starter/.active-api.env.XXXXXX)"
    chmod 0640 "$active_api_next"
    printf 'ACTIVE_API_IMAGE=%s\nACTIVE_API_REVISION=%s\n' "$APP_IMAGE" "$SERVICE_REVISION" >"$active_api_next"
    mv -f "$active_api_next" /opt/nest-js-starter/active-api.env

The helper checks the lowercase GHCR digest, exact revision,
org.opencontainers.image.revision label and RepoDigests. It does not print
secrets. Compare the label byte-for-byte with SERVICE_REVISION.

## External networks and manual role sequence

Create or inspect the existing networks before Compose:

    docker network inspect "$CADDY_NETWORK" >/dev/null 2>&1 || docker network create "$CADDY_NETWORK"
    docker network inspect "$OBSERVABILITY_NETWORK" >/dev/null 2>&1 || docker network create "$OBSERVABILITY_NETWORK"

The fixed order is:

    "${production_compose[@]}" config --quiet
    "${production_compose[@]}" up --detach --wait postgres redis-auth
    "${production_compose[@]}" exec -T postgres sh -ceu 'psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file /opt/nest-js-starter/deployment/postgres/prepare-roles.sql'
    "${production_compose[@]}" up --detach migrator
    if ! timeout --foreground --signal=TERM --kill-after=30s 300s "${production_compose[@]}" wait migrator; then
      "${production_compose[@]}" stop --timeout 30 migrator || true
      exit 1
    fi
    "${production_compose[@]}" ps --all migrator
    "${production_compose[@]}" exec -T postgres sh -ceu 'psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file /opt/nest-js-starter/deployment/postgres/finalize-roles.sql'
    "${production_compose[@]}" up --detach --wait api

Preparation and finalization are manual, idempotent, and never mounted as
database-init automation. PostgreSQL 18 membership checks fail closed for an
unexpected direct membership or SET ROLE capability. app_migrator and
app_runtime remain separate roles.

## Caddy handoff and recovery boundary

The same non-secret CADDY_UPSTREAM_ALIAS is copied into the host Caddy process
environment. Caddy does not automatically load /opt/nest-js-starter/.env.
Validate and reload the host-owned service:

    api.example.com {
        reverse_proxy {$CADDY_UPSTREAM_ALIAS}:3000
    }
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    sudo systemctl reload caddy
    docker network inspect "$CADDY_NETWORK" >/dev/null
    docker inspect "$CADDY_CONTAINER" --format '{{json .NetworkSettings.Networks}}'

Automatic HTTPS, DNS, certificates and the hosted Alloy/Loki/Tempo/Grafana
stack remain outside this repository. Use the rollback override only after
schema-compatibility approval; hosted smoke and telemetry evidence remain
unperformed.
