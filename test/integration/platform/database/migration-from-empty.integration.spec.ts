import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'

describe('Prisma migration from an empty PostgreSQL database', () => {
  let container: StartedPostgreSqlContainer
  let pool: Pool

  beforeAll(async () => {
    container = await startPostgresContainer()
    pool = new Pool({ connectionString: container.getConnectionUri() })
  })

  afterAll(async () => {
    await pool.end()
    await container.stop()
  })

  it('applies baseline plus auth core and creates its singleton', async () => {
    const result = runPrismaCommand(
      ['migrate', 'deploy', '--config', 'prisma.config.ts'],
      container.getConnectionUri(),
    )

    expect(result.exitCode).toBe(0)
    const migrations = await pool.query<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name',
    )
    expect(migrations.rows).toEqual([
      { migration_name: '20260720000000_baseline' },
      { migration_name: '20260721090000_auth_core' },
    ])
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    )
    expect(tables.rows).toEqual([
      { table_name: 'auth_security_state' },
      { table_name: 'password_credentials' },
      { table_name: 'user_roles' },
      { table_name: 'users' },
    ])
    const securityState = await pool.query<{
      id: number
      global_session_epoch: string
    }>('SELECT id, global_session_epoch FROM auth_security_state ORDER BY id')
    expect(securityState.rows).toEqual([{ id: 1, global_session_epoch: '0' }])
    await expect(
      pool.query(
        'INSERT INTO auth_security_state (id, updated_at) VALUES (2, CURRENT_TIMESTAMP)',
      ),
    ).rejects.toThrow()
  })

  it('is idempotent on a second migrate deploy', async () => {
    const result = runPrismaCommand(
      ['migrate', 'deploy', '--config', 'prisma.config.ts'],
      container.getConnectionUri(),
    )

    expect(result.exitCode).toBe(0)
    const migrations = await pool.query<{ count: string }>(
      'SELECT count(*) FROM _prisma_migrations',
    )
    expect(migrations.rows[0]?.count).toBe('2')
  })
})
