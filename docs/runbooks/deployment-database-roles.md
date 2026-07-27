# PostgreSQL roles for migration and runtime

## Contract

The one-shot migrator and API use different PostgreSQL login roles:

| Role         | Purpose                                                         | Permitted access                                                                                                                        |
| ------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| app_migrator | Runs corepack pnpm@11.15.1 start:migrate before an API rollout. | Owns public, Prisma migration metadata, and every schema object created by migrations.                                                  |
| app_runtime  | Runs the API revision that passed the migration gate.           | SELECT, INSERT, UPDATE, and DELETE on current and future application tables; USAGE, SELECT, and UPDATE on current and future sequences. |

app_runtime must not receive CREATE or TEMPORARY on the database or CREATE on
public, any role or database administration attribute, ownership of application
objects, or any privilege on public._prisma_migrations. It therefore cannot run
DDL or modify Prisma's migration history. The API never runs prisma migrate
deploy.

The secret manager supplies separate credentials for these roles. This runbook
never displays or stores a connection URL. The canonical deployment inputs are
`MIGRATION_DATABASE_URL` for `app_migrator` and `RUNTIME_DATABASE_URL` for
`app_runtime`. Use protected `pg_service.conf` entries (mode 0600) or an
equivalent secret-manager mapping from those inputs to connection service names
for `psql`; do not put their values in shell history, CI logs, Git, or a process
listing.

## Provision roles and privileges

Run the role/bootstrap portion once as a database administrator against the
intended database, before its first migration. The command reads the
administrator connection through PGSERVICE=database-admin; it does not print
that connection. The administrator must arrange login credentials in the secret
manager separately.

```bash
set -eu
set +x
export PGSERVICE=database-admin

psql --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname IN ('app_migrator', 'app_runtime')
      AND (
        NOT rolcanlogin
        OR rolinherit
        OR rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
        OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'refusing provisioning: an application role has unsafe attributes';
  END IF;
END
$$;

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_migrator, app_runtime', current_database()) \gexec
SELECT format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM app_runtime', current_database()) \gexec

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_runtime;
SQL
```

Run the following finalization block after the first successful one-shot
migration and before any API receives the runtime credential. Run it again if
an operator ever changes ownership or ACLs outside a migration.

```bash
set -eu
set +x
PGSERVICE=database-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
REVOKE ALL ON TABLE public._prisma_migrations FROM app_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
SQL
```

For an already-migrated database, an administrator must first transfer
ownership of every existing application table, sequence, type, index, and
_prisma_migrations to app_migrator. Inventory that database specifically; do not
use an unscoped REASSIGN OWNED command. After ownership transfer, run the
finalization block. Future application objects are covered by the default
privileges because they are created by app_migrator.

## Read-only verification

The following query is read-only and prints only booleans and role attributes;
it never prints a connection URL or user data. Run it with the runtime service
entry after the schema and roles exist.

```bash
set -eu
set +x
PGSERVICE=app-runtime psql --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
WITH application_tables AS (
  SELECT format('%I.%I', n.nspname, c.relname) AS relation_name
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> '_prisma_migrations'
), application_sequences AS (
  SELECT format('%I.%I', n.nspname, c.relname) AS relation_name
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'S'
)
SELECT
  has_schema_privilege('app_runtime', 'public', 'USAGE') AS runtime_can_use_schema,
  has_schema_privilege('app_runtime', 'public', 'CREATE') AS runtime_can_create_schema_objects,
  COALESCE((
    SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'SELECT'))
    FROM application_tables
  ), true) AS runtime_all_application_tables_select,
  COALESCE((
    SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'INSERT'))
    FROM application_tables
  ), true) AS runtime_all_application_tables_insert,
  COALESCE((
    SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'UPDATE'))
    FROM application_tables
  ), true) AS runtime_all_application_tables_update,
  COALESCE((
    SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'DELETE'))
    FROM application_tables
  ), true) AS runtime_all_application_tables_delete,
  COALESCE((
    SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'USAGE'))
    FROM application_sequences
  ), true) AS runtime_all_sequences_usage,
  COALESCE((
    SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'SELECT'))
    FROM application_sequences
  ), true) AS runtime_all_sequences_select,
  COALESCE((
    SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'UPDATE'))
    FROM application_sequences
  ), true) AS runtime_all_sequences_update,
  NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'SELECT') AS runtime_cannot_select_migration_history,
  NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'INSERT') AS runtime_cannot_insert_migration_history,
  NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'UPDATE') AS runtime_cannot_update_migration_history,
  NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'DELETE') AS runtime_cannot_delete_migration_history,
  has_database_privilege('app_runtime', current_database(), 'CREATE') AS runtime_can_create_database_objects,
  has_database_privilege('app_runtime', current_database(), 'TEMPORARY') AS runtime_can_create_temporary_tables,
  (
    SELECT bool_and(check_value)
    FROM unnest(ARRAY[
      has_schema_privilege('app_runtime', 'public', 'USAGE'),
      NOT has_schema_privilege('app_runtime', 'public', 'CREATE'),
      COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'SELECT')) FROM application_tables), true),
      COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'INSERT')) FROM application_tables), true),
      COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'UPDATE')) FROM application_tables), true),
      COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'DELETE')) FROM application_tables), true),
      COALESCE((SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'USAGE')) FROM application_sequences), true),
      COALESCE((SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'SELECT')) FROM application_sequences), true),
      COALESCE((SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'UPDATE')) FROM application_sequences), true),
      NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'SELECT'),
      NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'INSERT'),
      NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'UPDATE'),
      NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'DELETE'),
      NOT has_database_privilege('app_runtime', current_database(), 'CREATE'),
      NOT has_database_privilege('app_runtime', current_database(), 'TEMPORARY'),
      (
        SELECT count(*) = 2 AND COALESCE(bool_and(
          rolcanlogin
          AND NOT rolinherit
          AND NOT rolsuper
          AND NOT rolcreatedb
          AND NOT rolcreaterole
          AND NOT rolreplication
          AND NOT rolbypassrls
        ), false)
        FROM pg_roles
        WHERE rolname IN ('app_migrator', 'app_runtime')
      )
    ]) AS checks(check_value)
  ) AS runtime_privileges_verified
\gset runtime_

\if :runtime_runtime_privileges_verified
\else
  \echo 'runtime privilege verification failed; stop before granting traffic'
  \quit 1
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relowner = (SELECT oid FROM pg_roles WHERE rolname = 'app_runtime')
) AS runtime_owns_no_public_relations
\gset ownership_

\if :ownership_runtime_owns_no_public_relations
\else
  \echo 'runtime ownership verification failed; stop before granting traffic'
  \quit 1
\endif

SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN ('app_migrator', 'app_runtime')
ORDER BY rolname;
SQL
```

Expected values are true, false, then true for each application-table DML
privilege, each sequence privilege, and each denied `_prisma_migrations`
privilege, followed by false and false for database CREATE and TEMPORARY, and
true for the application-role attribute guard. The ownership query returns
true; `rolcanlogin` is true, while `rolinherit` and every forbidden
administrative attribute are false for both roles. The `app-runtime` service
alias in this example is provisioned from
`RUNTIME_DATABASE_URL` through a protected service file, so the URL is not
passed in argv.

Run one aggregate application query and prove the two forbidden operations
fail under the runtime role. The `WHERE FALSE` clause makes the migration
history probe non-mutating even if a misconfiguration accidentally grants
UPDATE:

```bash
set -eu
set +x
PGSERVICE=app-runtime psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --command 'SELECT count(*) AS users_count FROM public.users'

if PGSERVICE=app-runtime psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --command 'CREATE TABLE public.runtime_ddl_probe (id integer)' \
  >/dev/null 2>&1; then
  printf '%s\n' 'unexpected: runtime role created a table' >&2
  exit 1
fi

if PGSERVICE=app-runtime psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --command 'UPDATE public._prisma_migrations SET finished_at = finished_at WHERE FALSE' \
  >/dev/null 2>&1; then
  printf '%s\n' 'unexpected: runtime role modified migration history' >&2
  exit 1
fi
printf '%s\n' 'runtime DDL and migration-history denial verified'
```

## Promotion boundary

1. Inject only `MIGRATION_DATABASE_URL` as the process-owned `DATABASE_URL` for
   the one-shot migrator and run `corepack pnpm@11.15.1 start:migrate`. Keep the
   value out of argv and logs:

   ```bash
   set -eu
   set +x
   : "$MIGRATION_DATABASE_URL"
   export DATABASE_URL="$MIGRATION_DATABASE_URL"
   corepack pnpm@11.15.1 start:migrate
   ```

2. If it succeeds, inject only `RUNTIME_DATABASE_URL` as the API's
   process-owned `DATABASE_URL` in the already-provisioned API environment:

   ```bash
   set -eu
   set +x
   : "$RUNTIME_DATABASE_URL"
   export DATABASE_URL="$RUNTIME_DATABASE_URL"
   corepack pnpm@11.15.1 start:api
   ```

3. Start the API using the same verified image digest, wait with a bounded
   deadline for `"$PUBLIC_API_URL/health/ready"`, then run the external smoke.

Do not give the API the migrator credential as a fallback. If migration fails,
stop before any API deployment and follow
[failed-prisma-migration.md](failed-prisma-migration.md). There are no database
down-migrations.
