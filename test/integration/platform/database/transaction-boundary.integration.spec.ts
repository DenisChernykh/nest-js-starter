import { ConfigService } from '@nestjs/config'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { ValidatedRuntimeEnvironment } from '@/platform/config/runtime-config.types'
import { validateRuntimeEnvironment } from '@/platform/config/runtime-environment'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { TransactionRollbackOnlyError } from '@/shared/application/transaction.port'
import { startPostgresContainer } from '@test/integration/support/postgres-container'

describe('Prisma transaction boundary', () => {
  let container: StartedPostgreSqlContainer
  let provider: PrismaClientProvider
  let adapter: PrismaTransactionAdapter
  let tableName: string

  beforeAll(async () => {
    container = await startPostgresContainer()
    process.env['DATABASE_URL'] = container.getConnectionUri()
    const environment = validateRuntimeEnvironment({
      DATABASE_URL: container.getConnectionUri(),
      DATABASE_CONNECTION_TIMEOUT_MS: '2000',
      DATABASE_HEALTH_TIMEOUT_MS: '2000',
    })
    const config = new RuntimeConfigService(
      new ConfigService<ValidatedRuntimeEnvironment, true>(environment),
    )
    const context = new PrismaTransactionContext()
    provider = new PrismaClientProvider(config, context)
    adapter = new PrismaTransactionAdapter(provider, context, config)
    tableName = `transaction_boundary_${Date.now()}`
    await provider.connect(new AbortController().signal)
  })

  afterEach(async () => {
    await provider.withClient((client) =>
      client.$executeRawUnsafe(`DROP TABLE IF EXISTS ${tableName}`),
    )
  })

  afterAll(async () => {
    await provider.close(new AbortController().signal)
    delete process.env['DATABASE_URL']
    await container.stop()
  })

  async function tableExists(): Promise<boolean> {
    const rows = await provider.withClient((client) =>
      client.$queryRawUnsafe<Array<{ name: string | null }>>(
        'SELECT to_regclass($1)::text AS name',
        tableName,
      ),
    )
    return rows[0]?.name === tableName
  }

  it('commits a successful outer callback and returns its result unchanged', async () => {
    const result = { committed: true }

    await expect(
      adapter.run(async () => {
        await provider.withClient((client) =>
          client.$executeRawUnsafe(`CREATE TABLE ${tableName} (value integer)`),
        )
        return result
      }),
    ).resolves.toBe(result)
    await expect(tableExists()).resolves.toBe(true)
  })

  it('rolls back a thrown outer callback error unchanged', async () => {
    const failure = new Error('rollback')

    await expect(
      adapter.run(async () => {
        await provider.withClient((client) =>
          client.$executeRawUnsafe(`CREATE TABLE ${tableName} (value integer)`),
        )
        throw failure
      }),
    ).rejects.toBe(failure)
    await expect(tableExists()).resolves.toBe(false)
  })

  it('joins successful nested runs and commits their data', async () => {
    await adapter.run(async () => {
      await provider.withClient((client) =>
        client.$executeRawUnsafe(`CREATE TABLE ${tableName} (value integer)`),
      )
      await adapter.run(() =>
        provider.withClient((client) =>
          client.$executeRawUnsafe(`INSERT INTO ${tableName} VALUES (1)`),
        ),
      )
    })

    const rows = await provider.withClient((client) =>
      client.$queryRawUnsafe<Array<{ value: number }>>(
        `SELECT value FROM ${tableName}`,
      ),
    )
    expect(rows).toEqual([{ value: 1 }])
  })

  it('propagates a nested failure and rolls back', async () => {
    const nestedFailure = new Error('nested')

    await expect(
      adapter.run(async () => {
        await provider.withClient((client) =>
          client.$executeRawUnsafe(`CREATE TABLE ${tableName} (value integer)`),
        )
        await adapter.run(() => Promise.reject(nestedFailure))
      }),
    ).rejects.toBe(nestedFailure)
    await expect(tableExists()).resolves.toBe(false)
  })

  it('forces rollback when the outer callback catches a nested failure', async () => {
    await expect(
      adapter.run(async () => {
        await provider.withClient((client) =>
          client.$executeRawUnsafe(`CREATE TABLE ${tableName} (value integer)`),
        )
        await adapter
          .run(() => Promise.reject(new Error('caught')))
          .catch(() => undefined)
      }),
    ).rejects.toBeInstanceOf(TransactionRollbackOnlyError)
    await expect(tableExists()).resolves.toBe(false)
  })

  it('isolates concurrent transaction clients', async () => {
    const clients: unknown[] = []
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = adapter.run(async () => {
      await provider.withClient(async (client) => {
        clients.push(client)
        await gate
      })
    })
    const second = adapter.run(() =>
      provider.withClient((client) => {
        clients.push(client)
        return Promise.resolve()
      }),
    )
    await second
    releaseFirst?.()
    await first

    expect(clients).toHaveLength(2)
    expect(clients[0]).not.toBe(clients[1])
  })

  it('selects the root client outside and scoped client inside a transaction', async () => {
    let rootClient: unknown
    let scopedClient: unknown
    await provider.withClient((client) => {
      rootClient = client
      return Promise.resolve()
    })
    await adapter.run(() =>
      provider.withClient((client) => {
        scopedClient = client
        return Promise.resolve()
      }),
    )

    expect(rootClient).not.toBe(scopedClient)
  })
})
