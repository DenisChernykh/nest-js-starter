# Production deployment with Compose and Caddy

This runbook is the single operator path for the production image in
docker-compose.production.yml. It changes only the named production Compose
project on a normal VPS. It does not install a proxy, collector, database or
Redis outside that project and it does not claim that a hosted drill happened.

Use one exclusive change window. The candidate APP_IMAGE and its exact
SERVICE_REVISION come from one successful Stage publication. The previous
image and revision are kept as non-secret release metadata for a human rollback
decision; never copy the complete server .env into release metadata.

## Install the tracked runtime contract

On the operator machine, copy these tracked paths to /opt/nest-js-starter on
the VPS using the normal approved SSH or file-transfer method:

- docker-compose.production.yml
- config/deployment/postgres/prepare-roles.sql
- config/deployment/postgres/finalize-roles.sql
- docs/runbooks/production.env.example

Keep the files outside docker-entrypoint-initdb.d. The SQL files are mounted
read-only by Compose and are run manually only after the operator confirms the
database state.

Create the server environment file before entering any real value:

    install -d -m 0750 /opt/nest-js-starter
    cp /opt/nest-js-starter/docs/runbooks/production.env.example /opt/nest-js-starter/.env
    chmod 600 /opt/nest-js-starter/.env
    stat -c '%a %n' /opt/nest-js-starter/.env

Continue only when stat prints mode 600. Enter values through the server's
protected editor or secret provider. Do not put credentials in shell history,
command arguments, logs or this repository.

## Verify image and external networks

Load the server .env without printing it and check that APP_IMAGE is an
immutable digest, SERVICE_REVISION is exactly 40 lowercase hexadecimal
characters, and CADDY_UPSTREAM_ALIAS is unique for this API instance.

Create or inspect the two host-owned external networks:

    docker network inspect "$CADDY_NETWORK" >/dev/null 2>&1 || docker network create "$CADDY_NETWORK"
    docker network inspect "$OBSERVABILITY_NETWORK" >/dev/null 2>&1 || docker network create "$OBSERVABILITY_NETWORK"

Log in to private GHCR with a read-only credential. Keep the token in stdin and
remove the temporary shell variable after the pull:

    printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
    docker pull "$APP_IMAGE"
    OCI_REVISION="$(docker image inspect "$APP_IMAGE" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    test "$OCI_REVISION" = "$SERVICE_REVISION"
    unset GHCR_READ_TOKEN

The last comparison is byte-for-byte. A tag, a missing label or a different
revision stops the operation.

## Migration-first startup

Run Compose configuration validation first. The project uses the same immutable
image for the one-shot migrator and API; it has no build, development profile or
published host API port.

    cd /opt/nest-js-starter
    docker compose --env-file /opt/nest-js-starter/.env --file docker-compose.production.yml config --quiet
    docker compose up --detach --wait postgres redis-auth

Prepare the two PostgreSQL roles manually. The command reads passwords already
present in the PostgreSQL container environment and passes no secret as an
argument:

    docker compose exec -T postgres sh -ceu '
      export PGPASSWORD="$POSTGRES_PASSWORD"
      psql --no-psqlrc --set=ON_ERROR_STOP=1 \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --file /opt/nest-js-starter/deployment/postgres/prepare-roles.sql
    '

Start the migrator, wait for its one-shot completion and inspect exit 0:

    docker compose up --detach migrator
    docker compose wait migrator
    docker compose ps --all migrator
    MIGRATOR_ID="$(docker compose ps --all --quiet migrator)"
    MIGRATOR_EXIT="$(docker inspect "$MIGRATOR_ID" --format '{{.State.ExitCode}}')"
    test "$MIGRATOR_EXIT" = 0

Only after a successful migration, finalize and verify grants. This is a manual
step, never an init-container hook:

    docker compose exec -T postgres sh -ceu '
      export PGPASSWORD="$POSTGRES_PASSWORD"
      psql --no-psqlrc --set=ON_ERROR_STOP=1 \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --file /opt/nest-js-starter/deployment/postgres/finalize-roles.sql
    '
    docker compose up --detach --wait api
    docker compose ps

The API receives only RUNTIME_DATABASE_URL rendered as its DATABASE_URL,
auth secrets, auth Redis URL and application inputs. The migrator receives only
MIGRATION_DATABASE_URL rendered as its DATABASE_URL plus process identity.
Neither process receives GHCR, PostgreSQL admin or the other application role's
credential.

## Caddy handoff and status

Caddy remains host-owned and joins the external CADDY_NETWORK. Its minimal
site block keeps automatic HTTPS outside this repository's Compose project:

    api.example.com {
        reverse_proxy ${CADDY_UPSTREAM_ALIAS}:3000
    }

The DNS record, certificates, Caddy configuration and proxy service remain
outside the repository. Verify the Compose project with bounded output:

    docker compose ps
    docker compose logs --tail=200 postgres redis-auth migrator api

The API healthcheck is Node-based and calls
http://127.0.0.1:3000/health/ready. The public operator check must also cover
/health/live, /health/startup, /health/ready and the unauthenticated
/v1/auth/me problem response.

## Restart recovery and workers

PostgreSQL, auth Redis and API use the restart unless-stopped policy. After a Docker or
VPS restart, inspect docker compose ps and bounded logs, then wait for healthy
dependencies and API readiness. The migrator remains one-shot and is not a
worker or a permanent restart loop.

If a real durable worker is later required, the feature owning that queue must
add a separate Compose service using the same immutable image and its own
payload, processor, retry, idempotency and durable-state contract. Do not add a
demo worker or a global Redis abstraction here.

## Hosted telemetry drill boundary

A hosted drill would send one unique request ID through the public HTTPS origin,
look up that request ID in Loki, then use the returned trace ID to find the
corresponding Tempo trace. Those observations are environment evidence, not
repository evidence; this runbook does not perform that drill.
