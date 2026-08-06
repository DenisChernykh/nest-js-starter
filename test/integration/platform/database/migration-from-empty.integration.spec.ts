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

  it('applies all migrations and enforces database invariants', async () => {
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
      { migration_name: '20260728210000_approval_requests' },
      { migration_name: '20260806090000_self_service_account_lifecycle' },
    ])
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    )
    expect(tables.rows).toEqual([
      { table_name: 'approval_requests' },
      { table_name: 'auth_security_state' },
      { table_name: 'email_verification_tokens' },
      { table_name: 'password_credentials' },
      { table_name: 'password_reset_tokens' },
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
    const creator = await pool.query<{ id: string }>(
      `INSERT INTO users (email, normalized_email, updated_at)
       VALUES ('creator@example.com', 'creator@example.com', CURRENT_TIMESTAMP)
       RETURNING id`,
    )
    await expect(
      pool.query(
        `INSERT INTO approval_requests (
           title,
           description,
           status,
           created_by_user_id
         ) VALUES ($1, $2, 'APPROVED', $3)`,
        [
          'Needs decision metadata',
          'Invalid terminal row',
          creator.rows[0]?.id,
        ],
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
    expect(migrations.rows[0]?.count).toBe('4')
  })
})
