\set ON_ERROR_STOP on
\getenv app_migrator_password APP_MIGRATOR_PASSWORD
\getenv app_runtime_password APP_RUNTIME_PASSWORD

\if :{?app_migrator_password}
\else
  \quit 1
\endif
\if :{?app_runtime_password}
\else
  \quit 1
\endif

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
    RAISE EXCEPTION 'refusing application roles with unsafe attributes';
  END IF;

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

ALTER ROLE app_migrator PASSWORD :'app_migrator_password';
ALTER ROLE app_runtime PASSWORD :'app_runtime_password';

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_migrator, app_runtime', current_database()) \gexec
SELECT format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM app_runtime', current_database()) \gexec

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;

DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM app_runtime';
  END IF;
END
$$;
