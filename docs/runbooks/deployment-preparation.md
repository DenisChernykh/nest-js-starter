# Production Compose and Caddy preparation

This runbook prepares repository-owned files and non-secret operator inputs for
a normal VPS. It does not change a VPS, DNS, Caddy, PostgreSQL, Redis, Alloy,
Loki, Tempo or Grafana. Hosted readiness is a separate result and remains
unverified until an authorized operator performs the runtime drill.

## Tracked files and server layout

Install these tracked paths under /opt/nest-js-starter:

- docker-compose.production.yml
- config/deployment/postgres/prepare-roles.sql
- config/deployment/postgres/finalize-roles.sql
- docs/runbooks/production.env.example

The template contains names and symbolic placeholders only. Copy it to the
server-side .env, verify its mode before entering values, and keep the real
file as the single deployment/runtime secret file:

    cp /opt/nest-js-starter/docs/runbooks/production.env.example /opt/nest-js-starter/.env
    chmod 600 /opt/nest-js-starter/.env
    stat -c '%a %n' /opt/nest-js-starter/.env

The expected mode is 600. Never commit or copy the filled file into release
records, logs, process arguments or support tickets.

## Required inputs

The operator records ownership and expected semantics for each input without
recording secret values:

- immutable APP_IMAGE with a sha256 digest;
- exact 40-hex SERVICE_REVISION matching the OCI revision label;
- GHCR_USERNAME and a private GHCR_READ_TOKEN with package read access;
- POSTGRES_ADMIN_USER/POSTGRES_ADMIN_PASSWORD;
- POSTGRES_MIGRATOR_USER/POSTGRES_MIGRATOR_PASSWORD;
- POSTGRES_RUNTIME_USER/POSTGRES_RUNTIME_PASSWORD;
- POSTGRES_DB and DATABASE_POOL_MAX;
- REDIS_PASSWORD and stable REDIS_KEY_PREFIX;
- four independent auth secrets;
- PUBLIC_API_URL, CORS_ORIGINS, TRUST_PROXY_CIDRS and API_DOCS_MODE;
- CADDY_NETWORK, unique CADDY_UPSTREAM_ALIAS and OBSERVABILITY_NETWORK;
- OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME, OTEL_SDK_DISABLED,
  SERVICE_VERSION, NODE_ENV and LOG_LEVEL.

The PostgreSQL roles are separate. The API receives the runtime URL only; the
migrator receives the migration URL only. The API never receives admin,
migrator or GHCR credentials. The migrator never receives runtime, Redis, auth,
admin or GHCR credentials. Compose uses explicit environment mappings and no
container env_file.

## External networks and image identity

Create or inspect the existing external networks before starting the project:

    docker network inspect "$CADDY_NETWORK" >/dev/null 2>&1 || docker network create "$CADDY_NETWORK"
    docker network inspect "$OBSERVABILITY_NETWORK" >/dev/null 2>&1 || docker network create "$OBSERVABILITY_NETWORK"

Authenticate to GHCR without putting the read token in command arguments:

    printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
    docker pull "$APP_IMAGE"
    OCI_REVISION="$(docker image inspect "$APP_IMAGE" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    test "$OCI_REVISION" = "$SERVICE_REVISION"

The digest pull and label comparison must be fresh for this image/revision pair.
The comparison is byte-for-byte. Do not use latest or treat a commit tag as an
immutable deployment reference.

## Manual database preparation

The SQL files are mounted read-only outside docker-entrypoint-initdb.d. They
must be invoked manually with docker compose exec after healthy PostgreSQL
starts. Their passwords are read from container environment variables by psql;
they are not tracked, placed in argv, printed or logged.

The order is fixed:

1. docker compose up --detach --wait postgres redis-auth;
2. execute prepare-roles.sql as the PostgreSQL administrator;
3. start migrator, wait for completion and inspect exit 0;
4. execute finalize-roles.sql and stop if verification fails;
5. start api with docker compose up --detach --wait api.

The preparation contract grants app_migrator schema ownership and safe role
attributes. The finalization contract gives app_runtime current/future DML
and sequence access while denying DDL, public-object ownership and every
privilege on _prisma_migrations.

## Proxy, recovery and observability boundary

Host Caddy remains outside Compose. Its minimal configuration is:

    api.example.com {
        reverse_proxy ${CADDY_UPSTREAM_ALIAS}:3000
    }

A hostname site enables automatic HTTPS. DNS, certificates, Caddy service
configuration and the hosted Alloy/Loki/Tempo/Grafana stack are not committed
here.

For recovery, retain only previous non-secret image/revision metadata. Require
explicit schema-compatibility approval, validate the image digest and OCI
revision, then recreate only the API with
docker compose up --detach --no-deps --wait api. Never run a down-migration.

The hosted drill would send a unique request, find its requestId in Loki and
then find its traceId in Tempo. This repository has not performed that hosted
drill and does not claim the networks, proxy, collectors or storage are ready.
