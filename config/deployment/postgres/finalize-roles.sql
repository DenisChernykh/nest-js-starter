\set ON_ERROR_STOP on

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member ON member.oid = membership.member
    WHERE member.rolname IN ('app_migrator', 'app_runtime')
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE granted_role.rolname IN ('app_migrator', 'app_runtime')
  ) OR EXISTS (
    SELECT 1
    FROM pg_roles AS member
    JOIN pg_roles AS target ON target.rolname <> member.rolname
    WHERE member.rolname IN ('app_migrator', 'app_runtime')
      AND pg_has_role(member.rolname, target.rolname, 'SET')
  ) THEN
    RAISE EXCEPTION 'refusing inbound or outbound application-role membership or SET ROLE capability';
  END IF;
END
$$;

SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_runtime;
SELECT format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM app_runtime', current_database()) \gexec
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM app_runtime';
  END IF;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;

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
SELECT (
  has_schema_privilege('app_runtime', 'public', 'USAGE')
  AND NOT has_schema_privilege('app_runtime', 'public', 'CREATE')
  AND COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'SELECT')) FROM application_tables), true)
  AND COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'INSERT')) FROM application_tables), true)
  AND COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'UPDATE')) FROM application_tables), true)
  AND COALESCE((SELECT bool_and(has_table_privilege('app_runtime', relation_name, 'DELETE')) FROM application_tables), true)
  AND COALESCE((SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'USAGE')) FROM application_sequences), true)
  AND COALESCE((SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'SELECT')) FROM application_sequences), true)
  AND COALESCE((SELECT bool_and(has_sequence_privilege('app_runtime', relation_name, 'UPDATE')) FROM application_sequences), true)
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'SELECT')
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'INSERT')
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'UPDATE')
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'DELETE')
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'TRUNCATE')
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'REFERENCES')
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'TRIGGER')
  AND NOT has_table_privilege('app_runtime', 'public._prisma_migrations', 'MAINTAIN')
  AND NOT has_database_privilege('app_runtime', current_database(), 'CREATE')
  AND NOT has_database_privilege('app_runtime', current_database(), 'TEMPORARY')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_class AS c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'app_runtime')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member ON member.oid = membership.member
    WHERE member.rolname IN ('app_migrator', 'app_runtime')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE granted_role.rolname IN ('app_migrator', 'app_runtime')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_roles AS member
    JOIN pg_roles AS target ON target.rolname <> member.rolname
    WHERE member.rolname IN ('app_migrator', 'app_runtime')
      AND pg_has_role(member.rolname, target.rolname, 'SET')
  )
  AND (
    SELECT count(*) = 2 AND bool_and(
      rolcanlogin
      AND NOT rolinherit
      AND NOT rolsuper
      AND NOT rolcreatedb
      AND NOT rolcreaterole
      AND NOT rolreplication
      AND NOT rolbypassrls
    )
    FROM pg_roles
    WHERE rolname IN ('app_migrator', 'app_runtime')
  )
) AS runtime_privileges_verified
\gset runtime_

\if :runtime_runtime_privileges_verified
\else
  \quit 1
\endif

SELECT (
  (SELECT n.nspowner = r.oid
   FROM pg_namespace AS n
   JOIN pg_roles AS r ON r.rolname = 'app_migrator'
   WHERE n.nspname = 'public')
  AND (SELECT c.relowner = r.oid
       FROM pg_class AS c
       JOIN pg_roles AS r ON r.rolname = 'app_migrator'
       WHERE c.oid = 'public._prisma_migrations'::regclass)
) AS migrator_owns_schema_and_migration_history
\gset migrator_

\if :migrator_migrator_owns_schema_and_migration_history
\else
  \quit 1
\endif
