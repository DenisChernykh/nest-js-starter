import type { AuthPersistencePort } from '@/modules/auth/application/auth-persistence.port'
import { ChangePasswordUseCase } from '@/modules/auth/application/change-password.use-case'
import type { PasswordHasherPort } from '@/modules/auth/application/password-hasher.port'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'

function input(): {
  readonly userId: string
  readonly normalizedEmail: string
  readonly currentPassword: string
  readonly newPassword: string
} {
  return {
    userId: 'user',
    normalizedEmail: 'user@example.com',
    currentPassword: 'old',
    newPassword: 'new',
  }
}

describe('ChangePasswordUseCase', () => {
  it('commits CAS and generation before Redis cleanup', async () => {
    const order: string[] = []
    const persistence = {
      findCredentialByNormalizedEmail: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          email: 'user@example.com',
          normalizedEmail: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 0n,
          passwordHash: 'old',
          passwordVersion: 2,
          roleKeys: [],
        }),
      ),
      replacePasswordIfVersion: jest.fn(() => {
        order.push('replace')
        return Promise.resolve(true)
      }),
      deletePasswordResetToken: jest.fn(() => {
        order.push('delete-reset-token')
        return Promise.resolve()
      }),
      incrementSessionGeneration: jest.fn(() => {
        order.push('generation')
        return Promise.resolve(1n)
      }),
    } as unknown as AuthPersistencePort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: true, needsRehash: false }),
      ),
      hash: jest.fn(() => {
        order.push('hash')
        return Promise.resolve('new')
      }),
    } as unknown as PasswordHasherPort
    const transaction = {
      run: async <T>(operation: () => Promise<T>) => {
        order.push('transaction')
        return operation()
      },
    }
    const sessions = {
      revokeAll: jest.fn(() => {
        order.push('cleanup')
        return Promise.resolve(1)
      }),
    } as unknown as SessionStorePort
    const target = new ChangePasswordUseCase(
      persistence,
      passwords,
      transaction,
      sessions,
    )
    await expect(target.execute(input())).resolves.toEqual({
      cleanupComplete: true,
    })
    expect(order).toEqual([
      'hash',
      'transaction',
      'replace',
      'delete-reset-token',
      'generation',
      'cleanup',
    ])
  })
  it('reports partial cleanup after durable success', async () => {
    const persistence = {
      findCredentialByNormalizedEmail: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          email: 'user@example.com',
          normalizedEmail: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 0n,
          passwordHash: 'old',
          passwordVersion: 0,
          roleKeys: [],
        }),
      ),
      replacePasswordIfVersion: jest.fn(() => Promise.resolve(true)),
      deletePasswordResetToken: jest.fn(() => Promise.resolve()),
      incrementSessionGeneration: jest.fn(() => Promise.resolve(1n)),
    } as unknown as AuthPersistencePort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: true, needsRehash: false }),
      ),
      hash: jest.fn(() => Promise.resolve('new')),
    } as unknown as PasswordHasherPort
    const target = new ChangePasswordUseCase(
      persistence,
      passwords,
      { run: (operation) => operation() },
      {
        revokeAll: jest.fn(() => Promise.reject(new Error('redis'))),
      } as unknown as SessionStorePort,
    )
    await expect(target.execute(input())).resolves.toEqual({
      cleanupComplete: false,
    })
  })
})
