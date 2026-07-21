import { ConfigService } from '@nestjs/config'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Pool } from 'pg'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { ValidatedRuntimeEnvironment } from '@/platform/config/runtime-config.types'
import { validateRuntimeEnvironment } from '@/platform/config/runtime-environment'
import { DatabaseUnavailableError } from '@/platform/database/database.contracts'
import { PrismaDatabaseLifecycle } from '@/platform/database/prisma-database.lifecycle'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PostgresReadinessProbe } from '@/platform/database/postgres-readiness.probe'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

interface ProviderResources {
  readonly pool: Pool
  readonly prisma: {
    $connect(): Promise<void>
    $disconnect(): Promise<void>
  }
}

function resourcesOf(provider: PrismaClientProvider): ProviderResources {
  return provider as unknown as ProviderResources
}

function abortAfter(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(milliseconds)
}

describe('Prisma PostgreSQL lifecycle', () => {
  let container: StartedPostgreSqlContainer
  let databaseUrl: string

  beforeAll(async () => {
    container = await startPostgresContainer()
    databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
  })

  afterAll(async () => {
    delete process.env['DATABASE_URL']
    await container.stop()
  })

  function createProvider(
    overrides: Record<string, unknown> = {},
  ): PrismaClientProvider {
    const environment = validateRuntimeEnvironment(
      requiredRuntimeEnvironment({
        DATABASE_URL: databaseUrl,
        DATABASE_CONNECTION_TIMEOUT_MS: '2000',
        DATABASE_HEALTH_TIMEOUT_MS: '2000',
        ...overrides,
      }),
    )
    const config = new RuntimeConfigService(
      new ConfigService<ValidatedRuntimeEnvironment, true>(environment),
    )
    return new PrismaClientProvider(config)
  }

  it('connects, executes SELECT 1 and closes', async () => {
    const provider = createProvider()
    const lifecycle = new PrismaDatabaseLifecycle(provider)
    await lifecycle.connect(new AbortController().signal)

    await expect(
      provider.withClient((client) => client.$queryRawUnsafe('SELECT 1')),
    ).resolves.toBeDefined()
    await expect(
      lifecycle.close(new AbortController().signal),
    ).resolves.toBeUndefined()
  })

  it('closes idempotently', async () => {
    const provider = createProvider()
    await provider.connect(new AbortController().signal)
    await Promise.all([
      provider.close(new AbortController().signal),
      provider.close(new AbortController().signal),
    ])
    await expect(
      provider.close(new AbortController().signal),
    ).resolves.toBeUndefined()
  })

  it('shares one concurrent connection attempt', async () => {
    const provider = createProvider()
    const connect = jest.spyOn(resourcesOf(provider).prisma, '$connect')

    await Promise.all([
      provider.connect(new AbortController().signal),
      provider.connect(new AbortController().signal),
    ])

    expect(connect).toHaveBeenCalledTimes(1)
    await provider.close(new AbortController().signal)
  })

  it('shares one concurrent cleanup', async () => {
    const provider = createProvider()
    await provider.connect(new AbortController().signal)
    const disconnect = jest.spyOn(resourcesOf(provider).prisma, '$disconnect')
    const end = jest.spyOn(resourcesOf(provider).pool, 'end')

    await Promise.all([
      provider.close(new AbortController().signal),
      provider.close(new AbortController().signal),
    ])

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('prevents a late connected transition when close begins during connect', async () => {
    const provider = createProvider()
    let finishConnect: (() => void) | undefined
    jest.spyOn(resourcesOf(provider).prisma, '$connect').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishConnect = resolve
        }),
    )
    const connecting = provider.connect(new AbortController().signal)
    const closing = provider.close(abortAfter(1_000))
    finishConnect?.()

    await expect(connecting).rejects.toThrow(DatabaseUnavailableError)
    await expect(closing).resolves.toBeUndefined()
    await expect(
      provider.withClient(() => Promise.resolve(undefined)),
    ).rejects.toThrow(DatabaseUnavailableError)
  })

  it('cleans partially created resources after failed connect', async () => {
    const provider = createProvider()
    jest
      .spyOn(resourcesOf(provider).prisma, '$connect')
      .mockRejectedValueOnce(new Error('driver failure'))
    const disconnect = jest.spyOn(resourcesOf(provider).prisma, '$disconnect')
    const end = jest.spyOn(resourcesOf(provider).pool, 'end')

    await expect(provider.connect(abortAfter(1_000))).rejects.toThrow()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('ends the Pool even when Prisma disconnect rejects', async () => {
    const provider = createProvider()
    await provider.connect(new AbortController().signal)
    jest
      .spyOn(resourcesOf(provider).prisma, '$disconnect')
      .mockRejectedValueOnce(new Error('disconnect failure'))
    const end = jest.spyOn(resourcesOf(provider).pool, 'end')

    await expect(provider.close(abortAfter(1_000))).rejects.toThrow()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('reports readiness down after close', async () => {
    const provider = createProvider()
    const probe = new PostgresReadinessProbe(provider, 2_000)
    await provider.connect(new AbortController().signal)
    await provider.close(new AbortController().signal)

    await expect(probe.check(new AbortController().signal)).resolves.toBe(
      'down',
    )
  })

  it('bounds connect and initial probe with one absolute deadline', async () => {
    const provider = createProvider({
      DATABASE_CONNECTION_TIMEOUT_MS: '50',
      DATABASE_HEALTH_TIMEOUT_MS: '50',
    })
    jest
      .spyOn(resourcesOf(provider).prisma, '$connect')
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 75)),
      )

    await expect(
      provider.connect(new AbortController().signal),
    ).rejects.toThrow(DatabaseUnavailableError)
  })

  it('loads the database only after DATABASE_URL is available', () => {
    expect(process.env['DATABASE_URL']).toBe(databaseUrl)
    expect(PrismaClientProvider).toBeDefined()
  })

  it('destroys a timed-out pg_sleep probe and later recovers', async () => {
    const provider = createProvider()
    await provider.connect(new AbortController().signal)
    const probe = new PostgresReadinessProbe(provider, 25)

    await expect(
      provider.runReadinessQuery('SELECT pg_sleep(1)', abortAfter(200), 25),
    ).resolves.toBe('down')
    await expect(probe.check(new AbortController().signal)).resolves.toBe('up')
    await provider.close(new AbortController().signal)
  })

  it('settles an aborted raw probe before lifecycle cleanup resolves', async () => {
    const provider = createProvider()
    await provider.connect(new AbortController().signal)
    const probing = provider.runReadinessQuery(
      'SELECT pg_sleep(1)',
      abortAfter(25),
      1_000,
    )
    await expect(probing).resolves.toBe('down')
    await expect(provider.close(abortAfter(1_000))).resolves.toBeUndefined()
  })

  it('tracks and destroys a late client after saturated Pool acquisition', async () => {
    const provider = createProvider({ DATABASE_POOL_MAX: '1' })
    await provider.connect(new AbortController().signal)
    const heldClient = await resourcesOf(provider).pool.connect()
    const probing = provider.runReadinessQuery('SELECT 1', abortAfter(25), 25)
    setTimeout(() => heldClient.release(), 50)

    await expect(probing).resolves.toBe('down')
    await expect(provider.close(abortAfter(1_000))).resolves.toBeUndefined()
  })

  it('admits withClient work only while connected', async () => {
    const provider = createProvider()
    const operation = jest.fn(() => Promise.resolve(undefined))
    await expect(provider.withClient(operation)).rejects.toThrow(
      DatabaseUnavailableError,
    )
    expect(operation).not.toHaveBeenCalled()
    await provider.connect(new AbortController().signal)
    await expect(provider.withClient(operation)).resolves.toBeUndefined()
    await provider.close(new AbortController().signal)
    await expect(provider.withClient(operation)).rejects.toThrow(
      DatabaseUnavailableError,
    )
  })

  it('fails close when an admitted Prisma operation does not settle', async () => {
    const provider = createProvider()
    await provider.connect(new AbortController().signal)
    let settle: (() => void) | undefined
    const running = provider.withClient(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    )
    const closing = provider.close(abortAfter(25))
    await expect(closing).rejects.toThrow(DatabaseUnavailableError)
    await expect(
      provider.withClient(() => Promise.resolve(undefined)),
    ).rejects.toThrow(DatabaseUnavailableError)
    settle?.()
    await running
    await provider.close(new AbortController().signal)
  })

  it('handles an idle-client Pool error and can recover readiness', async () => {
    const provider = createProvider()
    await provider.connect(new AbortController().signal)
    const pool = resourcesOf(provider).pool
    pool.emit('error', new Error('idle client failure'), {})
    const probe = new PostgresReadinessProbe(provider, 2_000)

    await expect(probe.check(new AbortController().signal)).resolves.toBe('up')
    await provider.close(new AbortController().signal)
  })

  it('owns exactly one Pool error listener and removes it during close', async () => {
    const provider = createProvider()
    const pool = resourcesOf(provider).pool
    const ownedListener = pool.listeners('error')[0]
    expect(ownedListener).toBeDefined()
    expect(
      pool.listeners('error').filter((listener) => listener === ownedListener),
    ).toHaveLength(1)
    await provider.connect(new AbortController().signal)
    expect(
      pool.listeners('error').filter((listener) => listener === ownedListener),
    ).toHaveLength(1)
    await provider.close(new AbortController().signal)
    expect(pool.listeners('error')).not.toContain(ownedListener)
    await provider.close(new AbortController().signal)
    expect(pool.listeners('error')).not.toContain(ownedListener)
  })
})
