# Production Compose security baseline

This baseline describes the production inputs and handling rules. It does not
enter secrets, mutate a VPS or configure the public perimeter.

## Secret file and process exposure

The filled server-side .env is the single deployment/runtime secret file. It
must be mode 0600 before and after secret entry:

    chmod 600 /opt/nest-js-starter/.env
    stat -c '%a %n' /opt/nest-js-starter/.env

Never place credentials or the four auth secrets in image, Git, shell history,
logs, command arguments, release metadata or tickets. Use the GHCR read token
only with docker login --password-stdin, then remove it from the shell.
The explicit PostgreSQL inputs are POSTGRES_ADMIN_PASSWORD,
POSTGRES_MIGRATOR_PASSWORD and POSTGRES_RUNTIME_PASSWORD.
never place them in image, Git, shell history, logs, command arguments or
release metadata.

Compose maps values explicitly. PostgreSQL receives its admin and role
preparation inputs, auth Redis receives its password, the migrator receives
only its migration DATABASE_URL plus process identity, and API receives only
its runtime DATABASE_URL, Redis URL, auth secrets and application inputs.
Admin, migrator and GHCR credentials never enter API environment; runtime,
auth, Redis, admin and GHCR credentials never enter migrator environment.

## Public perimeter

1. PUBLIC_API_URL and every CORS_ORIGINS member use HTTPS.
2. TLS terminates in host-owned Caddy; the API listens only on its Compose
   network and Caddy reaches the unique CADDY_UPSTREAM_ALIAS:3000 alias.
3. TRUST_PROXY_CIDRS contains only environment-owned proxy ranges.
4. API_DOCS_MODE is protected or off; it is never public in production.
5. The Caddy network and observability network are external, pre-existing
   infrastructure inputs. Their creation and configuration are outside this
   repository.
   The external network inputs are CADDY_NETWORK and OBSERVABILITY_NETWORK.

Minimal Caddy configuration uses automatic HTTPS for a hostname:

    api.example.com {
        reverse_proxy ${CADDY_UPSTREAM_ALIAS}:3000
    }

## PostgreSQL roles

app_migrator and app_runtime are separate login roles with NOINHERIT,
NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. The
migration role owns the public schema, migration history and objects created by
migrations. The runtime role has DML and sequence privileges but cannot create
schema objects, create temporary tables, own public objects or read/write
_prisma_migrations.

Run prepare-roles.sql before migration and finalize-roles.sql after a
successful migration. These files are read-only mounts and never automatic
database initialization hooks. A failed role verification stops API startup.

## Auth Redis durability

Auth Redis contains sessions and login-limit state, not a disposable cache. Use
persistent named storage, AOF, noeviction, least-privilege access and an
owned backup/restore procedure. Do not change the stable REDIS_KEY_PREFIX and
do not run FLUSHDB or FLUSHALL during deployment or recovery.

## Evidence boundary

Local Compose config, role integration tests and image checks prove repository
contracts only. A hosted check must separately verify HTTPS, Caddy routing,
PostgreSQL/Redis durability, logs and traces. The unique-request Loki lookup
and Tempo trace lookup remain unperformed repository evidence until an
authorized hosted drill records them.
