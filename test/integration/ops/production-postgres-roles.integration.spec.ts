import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'

import { runPrismaCommand } from '@test/integration/support/run-prisma-command'
import { POSTGRES_IMAGE } from '@test/integration/support/postgres-image'

const database = 'nest_js_starter_roles_test'
const adminUser = 'postgres_admin'
const adminPassword = 'admin-password-for-test-only'
const migratorPassword = 'migrator-password-for-test-only'
const runtimePassword = 'runtime-password-for-test-only'

function databaseUrl(
  container: StartedPostgreSqlContainer,
  username: string,
  password: string,
): string {
  return `postgresql://${username}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/${database}?schema=public`
}

describe('production PostgreSQL role contracts', () => {
  let container: StartedPostgreSqlContainer
  let adminPool: Pool
  let migratorPool: Pool
  let runtimePool: Pool

  async function runRoleScript(
    target: string,
    sourcePath: string,
  ): Promise<void> {
    const result = await container.exec([
      'sh',
      '-ceu',
      `export PGPASSWORD="$POSTGRES_PASSWORD"
psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file ${target}`,
    ])
    if (result.exitCode !== 0) {
      throw new Error(
        `${sourcePath} failed (exit ${result.exitCode})\n${result.output}`,
      )
    }
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase(database)
      .withUsername(adminUser)
      .withPassword(adminPassword)
      .withEnvironment({
        APP_MIGRATOR_PASSWORD: migratorPassword,
        APP_RUNTIME_PASSWORD: runtimePassword,
      })
      .withCopyContentToContainer([
        {
          content: readFileSync(
            'config/deployment/postgres/prepare-roles.sql',
            'utf8',
          ),
          mode: 0o400,
          target: '/tmp/prepare-roles.sql',
        },
        {
          content: readFileSync(
            'config/deployment/postgres/finalize-roles.sql',
            'utf8',
          ),
          mode: 0o400,
          target: '/tmp/finalize-roles.sql',
        },
      ])
      .start()

    adminPool = new Pool({ connectionString: container.getConnectionUri() })
  })

  afterAll(async () => {
    await runtimePool?.end()
    await migratorPool?.end()
    await adminPool?.end()
    await container?.stop()
  })

  it('fails closed for unsafe membership and then prepares idempotently', async () => {
    await adminPool.query(`
      CREATE ROLE privileged_parent NOLOGIN;
      CREATE ROLE app_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
        NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT privileged_parent TO app_runtime;
    `)

    await expect(
      runRoleScript(
        '/tmp/prepare-roles.sql',
        'config/deployment/postgres/prepare-roles.sql',
      ),
    ).rejects.toThrow()

    await adminPool.query('REVOKE privileged_parent FROM app_runtime')
    await runRoleScript(
      '/tmp/prepare-roles.sql',
      'config/deployment/postgres/prepare-roles.sql',
    )

    await adminPool.query(`
      CREATE ROLE compromised_role NOLOGIN;
      GRANT app_migrator TO compromised_role;
    `)
    const inboundMembership = await adminPool.query<{ can_set: boolean }>(
      "SELECT pg_has_role('compromised_role', 'app_migrator', 'SET') AS can_set",
    )
    expect(inboundMembership.rows).toEqual([{ can_set: true }])
    await expect(
      runRoleScript(
        '/tmp/prepare-roles.sql',
        'config/deployment/postgres/prepare-roles.sql',
      ),
    ).rejects.toThrow()
    await adminPool.query('REVOKE app_migrator FROM compromised_role')
    await runRoleScript(
      '/tmp/prepare-roles.sql',
      'config/deployment/postgres/prepare-roles.sql',
    )
    await runRoleScript(
      '/tmp/prepare-roles.sql',
      'config/deployment/postgres/prepare-roles.sql',
    )
  })

  it('proves migration ownership, runtime DML and runtime denial boundaries', async () => {
    const migrationUrl = databaseUrl(
      container,
      'app_migrator',
      migratorPassword,
    )
    const runtimeUrl = databaseUrl(container, 'app_runtime', runtimePassword)

    const migration = runPrismaCommand(
      ['migrate', 'deploy', '--config', 'prisma.config.ts'],
      migrationUrl,
    )
    expect(migration.exitCode).toBe(0)

    migratorPool = new Pool({ connectionString: migrationUrl })
    await migratorPool.query(`
      CREATE SEQUENCE public.role_contract_probe_id_seq;
      CREATE TABLE public.role_contract_probe (
        id integer NOT NULL DEFAULT nextval('public.role_contract_probe_id_seq'),
        value text NOT NULL,
        CONSTRAINT role_contract_probe_pkey PRIMARY KEY (id)
      );
      ALTER SEQUENCE public.role_contract_probe_id_seq
        OWNED BY public.role_contract_probe.id;
    `)

    await runRoleScript(
      '/tmp/finalize-roles.sql',
      'config/deployment/postgres/finalize-roles.sql',
    )
    await adminPool.query('GRANT app_runtime TO compromised_role')
    await expect(
      runRoleScript(
        '/tmp/finalize-roles.sql',
        'config/deployment/postgres/finalize-roles.sql',
      ),
    ).rejects.toThrow()
    await adminPool.query('REVOKE app_runtime FROM compromised_role')
    await runRoleScript(
      '/tmp/finalize-roles.sql',
      'config/deployment/postgres/finalize-roles.sql',
    )

    const ownership = await adminPool.query<{
      migration_owner: string
      probe_owner: string
      public_owner: string
    }>(`
      SELECT
        (SELECT pg_get_userbyid(c.relowner)
         FROM pg_class AS c
         WHERE c.oid = 'public._prisma_migrations'::regclass) AS migration_owner,
        (SELECT pg_get_userbyid(c.relowner)
         FROM pg_class AS c
         WHERE c.oid = 'public.role_contract_probe'::regclass) AS probe_owner,
        (SELECT pg_get_userbyid(n.nspowner)
         FROM pg_namespace AS n
         WHERE n.nspname = 'public') AS public_owner
    `)
    expect(ownership.rows[0]).toEqual({
      migration_owner: 'app_migrator',
      probe_owner: 'app_migrator',
      public_owner: 'app_migrator',
    })

    const roleAttributes = await adminPool.query<{
      rolbypassrls: boolean
      rolcanlogin: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
      rolinherit: boolean
      rolname: string
      rolreplication: boolean
      rolsuper: boolean
    }>(`
      SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
             rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles
      WHERE rolname IN ('app_migrator', 'app_runtime')
      ORDER BY rolname
    `)
    expect(roleAttributes.rows).toEqual([
      {
        rolbypassrls: false,
        rolcanlogin: true,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolname: 'app_migrator',
        rolreplication: false,
        rolsuper: false,
      },
      {
        rolbypassrls: false,
        rolcanlogin: true,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolname: 'app_runtime',
        rolreplication: false,
        rolsuper: false,
      },
    ])

    runtimePool = new Pool({ connectionString: runtimeUrl })
    const inserted = await runtimePool.query<{ id: number }>(
      `INSERT INTO public.role_contract_probe (value)
       VALUES ('runtime-insert')
       RETURNING id`,
    )
    expect(inserted.rows[0]?.id).toBe(1)
    await expect(
      runtimePool.query(
        `UPDATE public.role_contract_probe
         SET value = 'runtime-update'
         WHERE id = $1`,
        [inserted.rows[0]?.id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
    await expect(
      runtimePool.query(
        'SELECT id, value FROM public.role_contract_probe WHERE id = $1',
        [inserted.rows[0]?.id],
      ),
    ).resolves.toMatchObject({
      rows: [{ id: 1, value: 'runtime-update' }],
    })
    await expect(
      runtimePool.query(
        'DELETE FROM public.role_contract_probe WHERE id = $1',
        [inserted.rows[0]?.id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
    await expect(
      runtimePool.query("SELECT nextval('public.role_contract_probe_id_seq')"),
    ).resolves.toMatchObject({ rows: [{ nextval: '2' }] })

    await expect(
      runtimePool.query(
        'CREATE TABLE public.runtime_ddl_forbidden (id integer)',
      ),
    ).rejects.toThrow()
    await expect(
      runtimePool.query(
        'ALTER TABLE public.role_contract_probe ADD COLUMN forbidden text',
      ),
    ).rejects.toThrow()
    await expect(
      runtimePool.query(
        'CREATE TEMP TABLE runtime_temp_forbidden (id integer)',
      ),
    ).rejects.toThrow()
    for (const statement of [
      'SELECT * FROM public._prisma_migrations',
      "INSERT INTO public._prisma_migrations (id) VALUES ('forbidden')",
      'UPDATE public._prisma_migrations SET finished_at = finished_at WHERE FALSE',
      'DELETE FROM public._prisma_migrations WHERE FALSE',
    ]) {
      await expect(runtimePool.query(statement)).rejects.toThrow()
    }
    await expect(
      runtimePool.query('SET ROLE privileged_parent'),
    ).rejects.toThrow()

    const deniedPrivileges = await adminPool.query<{
      can_create_database: boolean
      can_create_public: boolean
      can_create_temporary: boolean
      owns_public_relation: boolean
      migration_history_delete: boolean
      migration_history_insert: boolean
      migration_history_maintain: boolean
      migration_history_references: boolean
      migration_history_select: boolean
      migration_history_truncate: boolean
      migration_history_trigger: boolean
      migration_history_update: boolean
      runtime_can_set_privileged_parent: boolean
      unexpected_membership: boolean
    }>(`
      SELECT
        has_database_privilege('app_runtime', current_database(), 'CREATE') AS can_create_database,
        has_schema_privilege('app_runtime', 'public', 'CREATE') AS can_create_public,
        has_database_privilege('app_runtime', current_database(), 'TEMPORARY') AS can_create_temporary,
        EXISTS (
          SELECT 1 FROM pg_class
          WHERE relnamespace = 'public'::regnamespace
            AND relowner = (SELECT oid FROM pg_roles WHERE rolname = 'app_runtime')
        ) AS owns_public_relation,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'DELETE') AS migration_history_delete,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'INSERT') AS migration_history_insert,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'MAINTAIN') AS migration_history_maintain,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'REFERENCES') AS migration_history_references,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'SELECT') AS migration_history_select,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'TRUNCATE') AS migration_history_truncate,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'TRIGGER') AS migration_history_trigger,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'UPDATE') AS migration_history_update,
        pg_has_role('app_runtime', 'privileged_parent', 'SET') AS runtime_can_set_privileged_parent,
        EXISTS (
          SELECT 1 FROM pg_auth_members AS membership
          JOIN pg_roles AS member ON member.oid = membership.member
          WHERE member.rolname = 'app_runtime'
        ) AS unexpected_membership
    `)
    expect(deniedPrivileges.rows[0]).toEqual({
      can_create_database: false,
      can_create_public: false,
      can_create_temporary: false,
      migration_history_delete: false,
      migration_history_insert: false,
      migration_history_maintain: false,
      migration_history_references: false,
      migration_history_select: false,
      migration_history_truncate: false,
      migration_history_trigger: false,
      migration_history_update: false,
      owns_public_relation: false,
      runtime_can_set_privileged_parent: false,
      unexpected_membership: false,
    })
  })
})
