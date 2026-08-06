# Production database-role contract

This reference explains the separate PostgreSQL roles used by the one Compose
production path. The canonical prefix is:

    production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --file /opt/nest-js-starter/docker-compose.production.yml)

MIGRATION_DATABASE_URL and RUNTIME_DATABASE_URL are historical names and are not
canonical production inputs. Production uses POSTGRES_ADMIN_USER,
POSTGRES_ADMIN_PASSWORD, POSTGRES_MIGRATOR_USER,
POSTGRES_MIGRATOR_PASSWORD, POSTGRES_RUNTIME_USER and
POSTGRES_RUNTIME_PASSWORD in the server .env; Compose renders process-owned
DATABASE_URL values explicitly.

## Prepare, migrate and finalize

The SQL files are read-only mounts outside docker-entrypoint-initdb.d. Run them
manually through the canonical Compose project:

    "${production_compose[@]}" config --quiet
    "${production_compose[@]}" up --detach --wait postgres redis-auth
    "${production_compose[@]}" exec -T postgres sh -ceu 'psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file /opt/nest-js-starter/deployment/postgres/prepare-roles.sql'
    "${production_compose[@]}" up --detach migrator
    "${production_compose[@]}" wait migrator
    "${production_compose[@]}" ps --all migrator
    "${production_compose[@]}" exec -T postgres sh -ceu 'psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file /opt/nest-js-starter/deployment/postgres/finalize-roles.sql'
    "${production_compose[@]}" up --detach --wait api

Preparation is idempotent but fails closed if app_migrator or app_runtime has
an unexpected direct membership or can SET ROLE to another role. The migrator
owns the public schema, migration history and migration-created objects.
Runtime receives DML and sequence privileges only; it cannot perform DDL,
create temporary objects, own public objects or access _prisma_migrations.

The container migrator is the only production migration process. No direct host
pnpm process is a production promotion path. Run
config/deployment/production-preflight.sh before the image enters this sequence.

## Forward-only failure response

Freeze promotion on a non-zero migrator exit. Preserve only the image digest,
SERVICE_REVISION, migration identifier, UTC time and sanitized error class.
Inspect migration state through the migrator container without printing a URL:

    "${production_compose[@]}" ps --all migrator
    "${production_compose[@]}" logs --tail=200 migrator

Take an off-host backup and restore it only into a separate validation database.
Review a corrected forward-only migration, narrowly approved data repair or explicit
migration-history resolution against proven state. Never reset production,
combine roles, run a down-migration or start the API before finalization passes.
