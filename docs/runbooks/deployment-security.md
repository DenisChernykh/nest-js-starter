# Production Compose security baseline

This document describes the production security contract. It does not enter
secrets or mutate a VPS, DNS, Caddy, Alloy, Loki, Tempo or Grafana.

The canonical production prefix is:

    production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --file /opt/nest-js-starter/docker-compose.production.yml)

## Secret format and exposure

The filled server-side .env is the only persistent deployment/runtime secret
file. It is 0600 before entry, after entry and after every rotation:

    chmod 600 /opt/nest-js-starter/.env
    stat -c '%a %n' /opt/nest-js-starter/.env

PostgreSQL admin, migrator, runtime and Redis passwords use unpadded base64url
with only A-Z, a-z, 0-9, hyphen and underscore. This excludes URL delimiters
such as colon, at-sign, slash, question mark, hash and equals, so constructed
DATABASE_URL and REDIS_AUTH_URL values cannot be corrupted. The four
AUTH_SESSION_KEY_SECRET, AUTH_CSRF_SECRET, AUTH_RATE_LIMIT_KEY_SECRET and
AUTH_NETWORK_METADATA_SECRET values are independent unpadded base64url
encodings of exactly 32 random bytes (43 characters each).
The server inputs are POSTGRES_ADMIN_PASSWORD, POSTGRES_MIGRATOR_PASSWORD and
POSTGRES_RUNTIME_PASSWORD plus REDIS_PASSWORD.

Never place them in image, Git, shell history, logs, command arguments, release
metadata or tickets. Compose uses explicit environment mappings. The API
receives only runtime DB/Redis/application inputs and auth secrets; the
migrator receives only its migration DB URL and process identity. GHCR,
PostgreSQL admin/migrator/runtime and Redis credentials never cross into the
wrong process.
Security rule: never place them in image, Git, shell history, logs, command
arguments, release metadata or tickets.

Redis command argv contains no resolved password. Redis uses AOF and noeviction.
Its container receives
REDIS_PASSWORD through environment, writes a mode-0600 config under the
mode-0700 noexec/nosuid/nodev /run/redis tmpfs, and execs redis-server from that
config. The resolved Compose command contains only the variable reference.

## Atomic rotation and recovery order

Prepare a new protected file beside the existing one, validate its mode and
syntax, then atomically replace the path:

    install -m 0600 /opt/nest-js-starter/.env /opt/nest-js-starter/.env.next
    chmod 600 /opt/nest-js-starter/.env.next
    mv -f /opt/nest-js-starter/.env.next /opt/nest-js-starter/.env
    stat -c '%a %n' /opt/nest-js-starter/.env

Rotate one secret class at a time. This per-secret recreation order retains only the old non-secret release
identifier, never the old complete environment:

1. GHCR: use a mode-0700 transient DOCKER_CONFIG, login with password-stdin,
   pull and run production-preflight.sh, then logout and remove that directory.
   On failure, retain the old deployment and discard only the temporary client
   state.
2. Auth: replace one of the four 32-byte encodings, recreate only API with the
   canonical Compose prefix and verify public live/ready plus expected auth
   boundaries. A failed smoke restores the previous single value atomically;
   sessions are expected to be invalidated when the session key changes.
3. Redis: rotate REDIS_PASSWORD, recreate auth Redis and API with the canonical
   prefix, verify readiness and session/limit behavior, and restore the old
   value atomically if bounded verification fails. Persistent Redis data is not
   deleted.
4. PostgreSQL: rotate admin, migrator and runtime role passwords separately
   through a protected SQL client using stdin/environment, verify each role's
   intended ownership/privileges, then recreate only the process that owns the
   changed credential. Restore the previous role password and environment value
   in the reverse order if verification fails; never merge the roles.

Each recreation is explicit and bounded:

    "${production_compose[@]}" up --detach --no-deps --wait api
    "${production_compose[@]}" ps

No complete .env copy is used for rollback.

## Public perimeter and host-owned Caddy

PUBLIC_API_URL and CORS_ORIGINS are HTTPS. TLS terminates in host-owned Caddy;
the API has no host port and is reached through the external CADDY_NETWORK
alias. OBSERVABILITY_NETWORK is also an external host-owned input. The same non-secret CADDY_UPSTREAM_ALIAS is copied into the host Caddy
process environment. Caddy does not automatically load
/opt/nest-js-starter/.env.

    api.example.com {
        reverse_proxy {$CADDY_UPSTREAM_ALIAS}:3000
    }
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    sudo systemctl reload caddy
    docker network inspect "$CADDY_NETWORK" >/dev/null
    docker inspect "$CADDY_CONTAINER" --format '{{json .NetworkSettings.Networks}}'

## PostgreSQL and hosted evidence boundary

app_migrator and app_runtime are separate NOINHERIT, non-superuser login roles.
Preparation fails closed on unexpected direct membership or SET ROLE capability.
Migration/schema ownership stays with app_migrator. Runtime has DML and sequence
access only, no DDL, temporary objects, public-object ownership or
_prisma_migrations access.

Local Compose config, SQL integration and helper tests prove repository
contracts only. A hosted drill must separately verify HTTPS, Caddy routing,
volume/network/readiness recovery, and the unique requestId-to-traceId path in
Loki and Tempo. Those results remain unperformed repository evidence.
