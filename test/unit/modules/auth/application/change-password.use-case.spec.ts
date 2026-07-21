import type { AuthPersistencePort } from '@/modules/auth/application/auth-persistence.port'
import { ChangePasswordUseCase } from '@/modules/auth/application/change-password.use-case'
import type { PasswordHasherPort } from '@/modules/auth/application/password-hasher.port'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'
import type { TransactionPort } from '@/shared/application/transaction.port'
import type { TelemetryPort } from '@/shared/application/telemetry.port'

describe('ChangePasswordUseCase', () => {
  it('hashes outside transaction, commits CAS plus generation, then cleans Redis', async () => {
    const order: string[] = []
    const persistence = {
      findCredentialByNormalizedEmail: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          email: 'user@example.com',
          normalizedEmail: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 0n,
          passwordHash: 'old-hash',
          passwordVersion: 2,
          roleKeys: [],
        }),
      ),
      replacePasswordIfVersion: jest.fn(() => {
        order.push('replace')
        return Promise.resolve(true)
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
        return Promise.resolve('new-hash')
      }),
    } as unknown as PasswordHasherPort
    const transaction = {
      run: async <T>(operation: () => Promise<T>): Promise<T> => {
        order.push('transaction')
        return operation()
      },
    } satisfies TransactionPort
    const sessions = {
      revokeAll: jest.fn(() => {
        order.push('cleanup')
        return Promise.resolve(2)
      }),
    } as unknown as SessionStorePort
    const audit = { emit: jest.fn(() => order.push('audit')) }
    const telemetry = {
      runAuthOperation: jest.fn((_operation, work) => work()),
      recordAuthOutcome: jest.fn(),
    } as jest.Mocked<TelemetryPort>
    const target = new ChangePasswordUseCase(
      persistence,
      passwords,
      transaction,
      sessions,
      undefined,
      audit,
      telemetry,
    )

    await expect(
      target.execute({
        userId: 'user',
        normalizedEmail: 'user@example.com',
        currentPassword: 'old',
        newPassword: 'new',
      }),
    ).resolves.toEqual({ cleanupComplete: true })
    expect(order).toEqual([
      'hash',
      'transaction',
      'replace',
      'generation',
      'cleanup',
      'audit',
    ])
    expect(audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'password_change',
        outcome: 'success',
        reasonCode: 'PASSWORD_CHANGED',
      }),
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(telemetry.runAuthOperation).toHaveBeenCalledWith(
      'change_password',
      expect.any(Function),
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(telemetry.recordAuthOutcome).toHaveBeenCalledWith(
      'change_password',
      'success',
    )
  })

  it('returns durable success with incomplete cleanup after Redis failure', async () => {
    const persistence = {
      findCredentialByNormalizedEmail: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          normalizedEmail: 'user@example.com',
          email: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 0n,
          passwordHash: 'old',
          passwordVersion: 0,
          roleKeys: [],
        }),
      ),
      replacePasswordIfVersion: jest.fn(() => Promise.resolve(true)),
      incrementSessionGeneration: jest.fn(() => Promise.resolve(1n)),
    } as unknown as AuthPersistencePort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: true, needsRehash: false }),
      ),
      hash: jest.fn(() => Promise.resolve('new')),
    } as unknown as PasswordHasherPort
    const sessions = {
      revokeAll: jest.fn(() => Promise.reject(new Error('redis detail'))),
    } as unknown as SessionStorePort
    const audit = { emit: jest.fn() }
    const target = new ChangePasswordUseCase(
      persistence,
      passwords,
      { run: (operation) => operation() },
      sessions,
      undefined,
      audit,
    )

    await expect(
      target.execute({
        userId: 'user',
        normalizedEmail: 'user@example.com',
        currentPassword: 'old',
        newPassword: 'new',
      }),
    ).resolves.toEqual({ cleanupComplete: false })
    expect(audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'partial',
        reasonCode: 'CLEANUP_INCOMPLETE',
      }),
    )
  })

  it('rejects an incorrect current password before hashing or mutation', async () => {
    const persistence = {
      findCredentialByNormalizedEmail: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          normalizedEmail: 'user@example.com',
          email: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 0n,
          passwordHash: 'old',
          passwordVersion: 0,
          roleKeys: [],
        }),
      ),
    } as unknown as AuthPersistencePort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: false, needsRehash: false }),
      ),
      hash: jest.fn(),
    } as unknown as PasswordHasherPort
    const target = new ChangePasswordUseCase(
      persistence,
      passwords,
      { run: (operation) => operation() },
      {} as SessionStorePort,
    )

    await expect(
      target.execute({
        userId: 'user',
        normalizedEmail: 'user@example.com',
        currentPassword: 'wrong',
        newPassword: 'new',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(passwords.hash).not.toHaveBeenCalled()
  })

  it('rejects a stale password version inside the transaction', async () => {
    const persistence = {
      findCredentialByNormalizedEmail: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          normalizedEmail: 'user@example.com',
          email: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 0n,
          passwordHash: 'old',
          passwordVersion: 1,
          roleKeys: [],
        }),
      ),
      replacePasswordIfVersion: jest.fn(() => Promise.resolve(false)),
    } as unknown as AuthPersistencePort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: true, needsRehash: false }),
      ),
      hash: jest.fn(() => Promise.resolve('new-hash')),
    } as unknown as PasswordHasherPort
    const target = new ChangePasswordUseCase(
      persistence,
      passwords,
      { run: (operation) => operation() },
      {} as SessionStorePort,
    )

    await expect(
      target.execute({
        userId: 'user',
        normalizedEmail: 'user@example.com',
        currentPassword: 'old',
        newPassword: 'new',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_STATE_CONFLICT' })
  })
})
