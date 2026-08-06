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
    await runRoleScript(
      '/tmp/prepare-roles.sql',
      'config/deployment/postgres/prepare-roles.sql',
    )
  })

  afterAll(async () => {
    await runtimePool?.end()
    await migratorPool?.end()
    await adminPool?.end()
    await container?.stop()
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

    const deniedPrivileges = await adminPool.query<{
      can_create_database: boolean
      can_create_public: boolean
      can_create_temporary: boolean
      owns_public_relation: boolean
      migration_history_delete: boolean
      migration_history_insert: boolean
      migration_history_select: boolean
      migration_history_update: boolean
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
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'SELECT') AS migration_history_select,
        has_table_privilege('app_runtime', 'public._prisma_migrations', 'UPDATE') AS migration_history_update
    `)
    expect(deniedPrivileges.rows[0]).toEqual({
      can_create_database: false,
      can_create_public: false,
      can_create_temporary: false,
      migration_history_delete: false,
      migration_history_insert: false,
      migration_history_select: false,
      migration_history_update: false,
      owns_public_relation: false,
    })
  })
})
