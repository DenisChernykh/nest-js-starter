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

  it('applies exactly the no-op baseline without business tables', async () => {
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
    ])
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    )
    expect(tables.rows).toEqual([])
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
    expect(migrations.rows[0]?.count).toBe('1')
  })
})
