# Production deployment with Compose and Caddy

This is the single production operator procedure. It uses the tracked Compose
file and host-owned Caddy; it does not install or mutate Caddy, Alloy, Loki,
Tempo or Grafana. Hosted checks below are executable procedures, not repository
evidence.

The candidate APP_IMAGE and SERVICE_REVISION come from one successful Stage
publication. Keep only the previous image and revision as non-secret release
metadata. Never copy the filled .env into that record.

## Install and protect the runtime files

Install these tracked files at /opt/nest-js-starter on a normal VPS:

- docker-compose.production.yml
- docker-compose.production.rollback.yml
- config/deployment/production-preflight.sh
- config/deployment/postgres/prepare-roles.sql
- config/deployment/postgres/finalize-roles.sql
- docs/runbooks/production.env.example

The SQL files stay outside docker-entrypoint-initdb.d, are mounted read-only,
and are invoked manually. Create the server secret file and verify its mode
before entering a real value:

    install -d -m 0750 /opt/nest-js-starter
    cp /opt/nest-js-starter/docs/runbooks/production.env.example /opt/nest-js-starter/.env
    chmod 600 /opt/nest-js-starter/.env
    stat -c '%a %n' /opt/nest-js-starter/.env

Continue only when stat prints 600. The filled server-side .env is the only
persistent deployment/runtime secret file.

Every production Compose command in this runbook uses this exact Bash array;
the array prevents the development docker-compose.yml from being selected:

    production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --env-file /opt/nest-js-starter/active-api.env --file /opt/nest-js-starter/docker-compose.production.yml --file /opt/nest-js-starter/docker-compose.production.rollback.yml)

`active-api.env` is generated release metadata, contains no secrets, and keeps
the desired API digest/revision stable across later recovery commands. A normal
promotion records the candidate values there; a rollback records the approved
previous values. The migrator always continues to use APP_IMAGE and
SERVICE_REVISION from the protected `.env`.

## Networks, GHCR and immutable identity

Create or inspect the existing host-owned networks. Network creation is an
infrastructure action outside this repository:

    set -eu
    set +x
    set -a
    . /opt/nest-js-starter/.env
    set +a
    docker network inspect "$CADDY_NETWORK" >/dev/null 2>&1 || docker network create "$CADDY_NETWORK"
    docker network inspect "$OBSERVABILITY_NETWORK" >/dev/null 2>&1 || docker network create "$OBSERVABILITY_NETWORK"

Use isolated transient registry state. DOCKER_CONFIG is mode 0700, is removed
by its own trap, and is never the server .env:

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
      DOCKER_CONFIG="$registry_config" docker pull "$APP_IMAGE"
      DOCKER_CONFIG="$registry_config" /opt/nest-js-starter/config/deployment/production-preflight.sh
    )
    unset GHCR_READ_TOKEN GHCR_USERNAME

    active_api_next="$(mktemp /opt/nest-js-starter/.active-api.env.XXXXXX)"
    chmod 0640 "$active_api_next"
    printf 'ACTIVE_API_IMAGE=%s\nACTIVE_API_REVISION=%s\n' \
      "$APP_IMAGE" "$SERVICE_REVISION" >"$active_api_next"
    mv -f "$active_api_next" /opt/nest-js-starter/active-api.env

The helper rejects non-GHCR references, tags, malformed digests, an uppercase
or non-40-hex revision, a missing/mismatched
org.opencontainers.image.revision label, and a pulled RepoDigest that is not
exactly APP_IMAGE. It does not print secret values. The comparison is
byte-for-byte; a commit tag is not production identity.

## Migration-first startup

Run configuration validation, healthy infrastructure, role preparation, the
one-shot migrator, grant finalization, and API readiness in this order:

    "${production_compose[@]}" config --quiet
    "${production_compose[@]}" up --detach --wait postgres redis-auth
    "${production_compose[@]}" exec -T postgres sh -ceu '
      export PGPASSWORD="$POSTGRES_PASSWORD"
      psql --no-psqlrc --set=ON_ERROR_STOP=1 \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --file /opt/nest-js-starter/deployment/postgres/prepare-roles.sql
    '
    "${production_compose[@]}" up --detach migrator
    if ! timeout --foreground --signal=TERM --kill-after=30s 300s "${production_compose[@]}" wait migrator; then
      "${production_compose[@]}" stop --timeout 30 migrator || true
      "${production_compose[@]}" ps --all migrator
      "${production_compose[@]}" logs --tail=200 migrator
      exit 1
    fi
    "${production_compose[@]}" ps --all migrator
    migrator_id="$("${production_compose[@]}" ps --all --quiet migrator)"
    migrator_exit="$(docker inspect "$migrator_id" --format '{{.State.ExitCode}}')"
    test "$migrator_exit" = 0
    "${production_compose[@]}" exec -T postgres sh -ceu '
      export PGPASSWORD="$POSTGRES_PASSWORD"
      psql --no-psqlrc --set=ON_ERROR_STOP=1 \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --file /opt/nest-js-starter/deployment/postgres/finalize-roles.sql
    '

On the first deployment only, create the initial administrator through the
compiled one-shot command in the immutable image. The runtime database URL is
passed through process environment, not argv; the password is read from stdin
and is never stored in `.env`:

    export DATABASE_URL="postgresql://app_runtime:${POSTGRES_RUNTIME_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
    "${production_compose[@]}" run --rm --no-deps -e DATABASE_URL migrator \
      node dist/bootstrap/admin/main.js --email admin@example.com
    unset DATABASE_URL

The command must print `Initial administrator created.` and exit zero. Skip it
when restoring an environment that already contains the bootstrap state.

Continue with API startup only after role finalization and, for a fresh volume,
successful administrator bootstrap:

    "${production_compose[@]}" up --detach --wait api
    "${production_compose[@]}" ps

The API receives only the runtime database URL, auth Redis URL, auth secrets
and application inputs. The migrator receives only its migration database URL
and process identity. GHCR, PostgreSQL admin, runtime, auth and Redis secrets
are not cross-exposed.

## Self-service account lifecycle

The production default is `AUTH_SELF_SERVICE_MODE=disabled`. To enable the
feature, set `AUTH_SELF_SERVICE_MODE=open`, an HTTPS `AUTH_PUBLIC_APP_URL`, a
valid `AUTH_SMTP_URL` and `AUTH_MAIL_FROM` in the protected server environment,
apply the committed migration, and recreate only the API:

    "${production_compose[@]}" config --quiet
    "${production_compose[@]}" up --detach migrator
    "${production_compose[@]}" up --detach --wait api

SMTP is lazy best-effort delivery and is not checked during bootstrap or
readiness. Follow the [self-service account lifecycle runbook](self-service-account-lifecycle.md)
for local Mailpit, smoke, outage, recovery, frontend fragment and rollback
procedures. To disable the capability, set `AUTH_SELF_SERVICE_MODE=disabled`
and recreate the API; existing verified login remains available.

## Caddy handoff and bounded public smoke

Caddy is host-owned and remains outside application Compose. The API is attached
to the external CADDY_NETWORK with the unique alias. The same non-secret
CADDY_UPSTREAM_ALIAS is copied into the host Caddy process environment. It is
explicitly copied, for example through a separate /etc/caddy/caddy.env or systemd
Environment= entry). Caddy does not automatically load /opt/nest-js-starter/.env.

The host-owned Caddyfile site block is kept outside this repository:

    api.example.com {
        reverse_proxy {$CADDY_UPSTREAM_ALIAS}:3000
    }

After installing the value in Caddy own environment, validate and reload the
host service, then inspect both network memberships:

    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    sudo systemctl reload caddy
    docker network inspect "$CADDY_NETWORK" >/dev/null
    docker inspect "$CADDY_CONTAINER" --format '{{json .NetworkSettings.Networks}}'
    "${production_compose[@]}" ps
    "${production_compose[@]}" logs --tail=200 postgres redis-auth migrator api

The hostname enables automatic HTTPS; DNS, certificates and the Caddy service remain host-owned.
Bounded public smoke uses a unique request ID and expects these boundaries:

    request_id="$(cat /proc/sys/kernel/random/uuid)"
    live_body="$(mktemp)"
    startup_body="$(mktemp)"
    ready_body="$(mktemp)"
    auth_body="$(mktemp)"
    loki_response="$(mktemp)"
    tempo_response="$(mktemp)"
    cleanup_response_files() {
      rm -f -- "$live_body" "$startup_body" "$ready_body" "$auth_body" "$loki_response" "$tempo_response"
    }
    trap cleanup_response_files EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM

    live_status="$(curl --fail-with-body --silent --show-error --max-time 10 \
      -H "X-Request-ID: $request_id" \
      --output "$live_body" --write-out '%{http_code}' \
      "$PUBLIC_API_URL/health/live")"
    test "$live_status" = 200
    grep -q '"status":"ok"' "$live_body"

    startup_status="$(curl --fail-with-body --silent --show-error --max-time 10 \
      -H "X-Request-ID: $request_id" \
      --output "$startup_body" --write-out '%{http_code}' \
      "$PUBLIC_API_URL/health/startup")"
    test "$startup_status" = 200
    grep -q '"status":"ok"' "$startup_body"

    ready_status="$(curl --fail-with-body --silent --show-error --max-time 10 \
      -H "X-Request-ID: $request_id" \
      --output "$ready_body" --write-out '%{http_code}' \
      "$PUBLIC_API_URL/health/ready")"
    test "$ready_status" = 200
    grep -q '"status":"ok"' "$ready_body"

    auth_status="$(curl --silent --show-error --max-time 10 \
      -H "X-Request-ID: $request_id" --output "$auth_body" \
      --write-out '%{http_code}' "$PUBLIC_API_URL/v1/auth/me")"
    case "$auth_status" in 401|403) ;; *) exit 1 ;; esac
    grep -q 'requestId' "$auth_body"

The live/startup/ready endpoints must return HTTP 200 and a JSON health body.
The unauthenticated auth endpoint must return HTTP 401 or 403 and a problem
body containing requestId; no credential is used by this smoke.
Expected boundary: HTTP 401 or 403 and a problem body containing requestId.

## Recovery and observability drill

PostgreSQL, auth Redis and API use restart unless-stopped; the migrator stays
one-shot. After a Docker daemon or VPS restart, inspect volumes and network
membership, then wait for readiness:
Record volume/network/readiness verification as bounded recovery evidence.

    "${production_compose[@]}" ps
    "${production_compose[@]}" restart postgres redis-auth api
    "${production_compose[@]}" ps
    docker volume ls --filter name=nest-js-starter-production
    docker network inspect "$CADDY_NETWORK" >/dev/null
    "${production_compose[@]}" up --detach --wait postgres redis-auth api
    "${production_compose[@]}" logs --tail=200 postgres redis-auth api

The hosted telemetry procedure sends the unique request above, queries Loki,
then fetches the exact trace from Tempo. Alloy labels the API stream
compose_service="api" and preserves requestId/traceId JSON fields:
The exact LogQL selector is {compose_service="api"} | json | requestId = request_id.

    loki_query="{compose_service=\"api\"} | json | requestId = \"$request_id\""
    curl -fsS --max-time 10 --get "$LOKI_URL/loki/api/v1/query_range" \
      --data-urlencode "query=$loki_query" >"$loki_response"
    trace_id="$(jq -er '.data.result[0].values[0][1] | fromjson | .traceId' "$loki_response")"
    curl -fsS --max-time 10 "$TEMPO_URL/api/v2/traces/$trace_id" >"$tempo_response"
    jq -e --arg trace_id "$trace_id" '.. | objects | select(.traceId? == $trace_id)' "$tempo_response" >/dev/null
    cleanup_response_files
    trap - EXIT HUP INT TERM

This is an unperformed repository procedure. Hosted HTTPS, Caddy routing,
Loki requestId lookup, Tempo traceId lookup and restart recovery require an
authorized VPS drill and must not be reported as local PASS evidence.

If a real worker is later needed, its feature owns a separate Compose service
using the same image, payload, retry, idempotency and durable-state contract.
Do not add a demo worker or a global Redis abstraction.
