import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
      { migration_name: '20260807120000_account_administration_core' },
      { migration_name: '20260807130000_account_email_workflows' },
      { migration_name: '20260808120000_transactional_outbox_foundation' },
    ])
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    )
    expect(tables.rows).toEqual([
      { table_name: 'account_invitation_tokens' },
      { table_name: 'approval_requests' },
      { table_name: 'auth_security_state' },
      { table_name: 'email_verification_tokens' },
      { table_name: 'outbox_messages' },
      { table_name: 'password_credentials' },
      { table_name: 'password_reset_tokens' },
      { table_name: 'user_roles' },
      { table_name: 'users' },
    ])
    const resetTokenColumns = await pool.query<{
      column_name: string
      column_default: string | null
    }>(
      `SELECT column_name, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'password_reset_tokens'
          AND column_name = 'source'`,
    )
    expect(resetTokenColumns.rows).toEqual([
      {
        column_name: 'source',
        column_default: '\'SELF_SERVICE\'::"PasswordResetTokenSource"',
      },
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
    await expect(
      pool.query(
        `INSERT INTO outbox_messages (
           id, destination, type, version, occurred_at, payload,
           payload_size_bytes, status, next_attempt_at, updated_at
         ) VALUES (
           gen_random_uuid(), 'notifications', 'test.event', 1,
           CURRENT_TIMESTAMP, '{}'::jsonb, 2, 'CLAIMED',
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )`,
      ),
    ).rejects.toThrow()
    await expect(
      pool.query(
        `INSERT INTO outbox_messages (
           id, destination, type, version, occurred_at, payload,
           payload_size_bytes, status, next_attempt_at, blocked_at,
           last_error_code, updated_at
         ) VALUES (
           gen_random_uuid(), 'notifications', 'test.event', 1,
           CURRENT_TIMESTAMP, '{}'::jsonb, 2, 'BLOCKED',
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'contains secret',
           CURRENT_TIMESTAMP
         )`,
      ),
    ).rejects.toThrow()
    await expect(
      pool.query(
        `INSERT INTO outbox_messages (
           id, destination, type, version, occurred_at, payload,
           payload_size_bytes, updated_at
         ) VALUES (
           gen_random_uuid(), 'notifications', 'test.event', 1,
           CURRENT_TIMESTAMP, '{}'::jsonb, 65537, CURRENT_TIMESTAMP
         )`,
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
    expect(migrations.rows[0]?.count).toBe('7')
  })

  it('backfills an existing user when upgrading from the pre-feature schema', async () => {
    const upgradeContainer = await startPostgresContainer()
    const upgradePool = new Pool({
      connectionString: upgradeContainer.getConnectionUri(),
    })
    const migrationRoot = join(process.cwd(), 'prisma', 'migrations')
    const preFeatureMigrations = [
      '20260720000000_baseline',
      '20260721090000_auth_core',
      '20260728210000_approval_requests',
    ]
    try {
      for (const migration of preFeatureMigrations) {
        await upgradePool.query(
          readFileSync(join(migrationRoot, migration, 'migration.sql'), 'utf8'),
        )
      }
      const oldUser = await upgradePool.query<{ id: string; created_at: Date }>(
        `INSERT INTO users (
           email, normalized_email, status, session_generation, created_at, updated_at
         ) VALUES ($1, $2, 'ACTIVE', 0, $3, $3)
         RETURNING id, created_at`,
        [
          'legacy@example.com',
          'legacy@example.com',
          new Date('2026-08-01T00:00:00.000Z'),
        ],
      )
      const userId = oldUser.rows[0]?.id
      const createdAt = oldUser.rows[0]?.created_at
      if (userId === undefined || createdAt === undefined) {
        throw new Error('Legacy user fixture failed')
      }
      await upgradePool.query(
        `INSERT INTO password_credentials (user_id, password_hash, version, updated_at)
         VALUES ($1, $2, 0, $3)`,
        [userId, '$argon2id$v=19$m=19456,t=2,p=1$legacy', createdAt],
      )
      await upgradePool.query(
        readFileSync(
          join(
            migrationRoot,
            '20260806090000_self_service_account_lifecycle',
            'migration.sql',
          ),
          'utf8',
        ),
      )
      await upgradePool.query(
        readFileSync(
          join(
            migrationRoot,
            '20260807120000_account_administration_core',
            'migration.sql',
          ),
          'utf8',
        ),
      )
      await upgradePool.query(
        readFileSync(
          join(
            migrationRoot,
            '20260807130000_account_email_workflows',
            'migration.sql',
          ),
          'utf8',
        ),
      )

      const upgraded = await upgradePool.query<{
        status: string
        created_at: Date
        email_verified_at: Date | null
        account_revision: number
        retired_at: Date | null
        password_hash: string | null
      }>(
        `SELECT u.status, u.created_at, u.email_verified_at, u.account_revision, u.retired_at, pc.password_hash
           FROM users u
           LEFT JOIN password_credentials pc ON pc.user_id = u.id
          WHERE u.id = $1`,
        [userId],
      )
      expect(upgraded.rows).toEqual([
        {
          status: 'ACTIVE',
          created_at: createdAt,
          email_verified_at: createdAt,
          account_revision: 0,
          retired_at: null,
          password_hash: '$argon2id$v=19$m=19456,t=2,p=1$legacy',
        },
      ])
    } finally {
      await upgradePool.end()
      await upgradeContainer.stop()
    }
  })
})
