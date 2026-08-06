# Failed production migration response

This is a forward-only recovery reference for the tracked Compose path. The
canonical prefix is:

    production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --file /opt/nest-js-starter/docker-compose.production.yml)

MIGRATION_DATABASE_URL and RUNTIME_DATABASE_URL are historical names, not
canonical production inputs. Do not create a host pnpm promotion process.
The migrator image owns the forward migration and the API remains stopped until
role finalization and readiness succeed.

## Bounded failure procedure

1. Freeze promotion. Keep the previous verified API image running and do not
   change the database by attempting an image rollback.
2. Preserve only the failing image digest, exact SERVICE_REVISION, UTC time,
   migration identifier and sanitized error class. Never record a URL, secret or
   complete .env.
3. Inspect the one-shot result and bounded logs through the canonical prefix:

       "${production_compose[@]}" ps --all migrator
       "${production_compose[@]}" logs --tail=200 migrator

4. Take a new off-host backup and perform isolated restore validation in a
   separate database. Do not restore over production.
5. Review a corrected forward migration, a narrowly approved data repair or an
   explicitly approved migration-history resolution after the real state is
   proven. A down-migration and destructive reset are forbidden.
6. Build and pull a new immutable GHCR digest. Run
   config/deployment/production-preflight.sh with the exact OCI revision, then
   repeat the Compose migrator/finalization sequence:

       "${production_compose[@]}" exec -T postgres sh -ceu 'psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file /opt/nest-js-starter/deployment/postgres/prepare-roles.sql'

The tracked SQL remains manual and idempotent. If preparation reports an
unexpected role membership or SET ROLE capability, stop and remove that unsafe
membership through explicit reviewed database administration before retrying.
Do not silently revoke unknown memberships in the tracked contract.

## Recovery boundary

Only after migrator exit 0 and finalize-roles.sql verification succeeds may
the API be started and bounded public live/startup/ready/auth smoke run. Hosted
Caddy, Loki and Tempo evidence remains unperformed repository evidence.
