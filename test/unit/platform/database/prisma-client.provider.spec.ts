import type { PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'

describe('PrismaClientProvider', () => {
  it('preserves the exact database result', async () => {
    const provider = connectedProvider()
    await expect(
      provider.withClient(() => Promise.resolve({ id: 'owned' })),
    ).resolves.toEqual({ id: 'owned' })
  })
  it('preserves the exact database rejection', async () => {
    const provider = connectedProvider()
    const error = new Error('driver-owned')
    await expect(provider.withClient(() => Promise.reject(error))).rejects.toBe(
      error,
    )
  })
})

function connectedProvider(): PrismaClientProvider {
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
      ) => operation(prisma),
    },
  })
  return provider
}
