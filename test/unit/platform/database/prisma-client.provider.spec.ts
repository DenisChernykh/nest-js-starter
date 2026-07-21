import type { PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { RuntimeMetrics } from '@/platform/observability/runtime-metrics'

describe('PrismaClientProvider telemetry', () => {
  it('records settlement latency without exposing the operation identity', async () => {
    const metrics = { recordDependency: jest.fn() } as unknown as RuntimeMetrics
    const provider = connectedProvider(metrics)

    await expect(
      provider.withClient(() => Promise.resolve('database-result')),
    ).resolves.toBe('database-result')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordDependency).toHaveBeenCalledWith(
      'postgres',
      'success',
      expect.any(Number),
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordDependency).toHaveBeenCalledTimes(1)
  })

  it('preserves the exact database result when metric emission throws', async () => {
    const metrics = {
      recordDependency: jest.fn(() => {
        throw new Error('metric unavailable')
      }),
    } as unknown as RuntimeMetrics
    const provider = connectedProvider(metrics)

    await expect(
      provider.withClient(() => Promise.resolve({ id: 'owned' })),
    ).resolves.toEqual({ id: 'owned' })
  })

  it('records an error without replacing the database rejection', async () => {
    const metrics = { recordDependency: jest.fn() } as unknown as RuntimeMetrics
    const provider = connectedProvider(metrics)
    const driverError = new Error('driver-owned')

    await expect(
      provider.withClient(() => Promise.reject(driverError)),
    ).rejects.toBe(driverError)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordDependency).toHaveBeenCalledWith(
      'postgres',
      'error',
      expect.any(Number),
    )
  })
})

function connectedProvider(metrics: RuntimeMetrics): PrismaClientProvider {
  const provider = Object.create(
    PrismaClientProvider.prototype,
  ) as PrismaClientProvider
  const prisma = {} as PrismaClient
  Object.assign(provider, {
    state: 'connected',
    admissionOpen: true,
    prisma,
    activeOperations: new Set<Promise<unknown>>(),
    transactionContext: {
      withClient: <T>(
        _client: PrismaClient,
        operation: (client: PrismaClient) => Promise<T>,
      ): Promise<T> => operation(prisma),
    },
    metrics,
  })
  return provider
}
