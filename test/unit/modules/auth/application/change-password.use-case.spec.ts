import { ChangePasswordUseCase } from '@/modules/auth/authentication/application/change-password.use-case'
import type { PasswordCredentialPort } from '@/modules/auth/authentication/application/password-credential.port'
import type { PasswordHasherPort } from '@/modules/auth/authentication/application/password-hasher.port'
import type { SessionStorePort } from '@/modules/auth/sessions/application/session-store.port'
import { SessionCleanupService } from '@/modules/auth/sessions/application/session-cleanup.service'

function input(): {
  readonly userId: string
  readonly currentPassword: string
  readonly newPassword: string
} {
  return {
    userId: 'user',
    currentPassword: 'old',
    newPassword: 'new',
  }
}

describe('ChangePasswordUseCase', () => {
  it('commits CAS and generation before Redis cleanup', async () => {
    const order: string[] = []
    const credentials = {
      findCredentialByUserId: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          status: 'active' as const,
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          passwordHash: 'old',
          passwordVersion: 2,
        }),
      ),
      changePasswordAndInvalidate: jest.fn(() => {
        order.push('durable-transition')
        return Promise.resolve(true)
      }),
    } as unknown as PasswordCredentialPort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: true, needsRehash: false }),
      ),
      hash: jest.fn(() => {
        order.push('hash')
        return Promise.resolve('new')
      }),
    } as unknown as PasswordHasherPort
    const sessions = {
      revokeAll: jest.fn(() => {
        order.push('cleanup')
        return Promise.resolve(1)
      }),
    } as unknown as SessionStorePort
    const target = new ChangePasswordUseCase(
      credentials,
      passwords,
      new SessionCleanupService(sessions),
    )
    await expect(target.execute(input())).resolves.toEqual({
      cleanupComplete: true,
    })
    expect(order).toEqual(['hash', 'durable-transition', 'cleanup'])
  })
  it('reports partial cleanup after durable success', async () => {
    const credentials = {
      findCredentialByUserId: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          status: 'active' as const,
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          passwordHash: 'old',
          passwordVersion: 0,
        }),
      ),
      changePasswordAndInvalidate: jest.fn(() => Promise.resolve(true)),
    } as unknown as PasswordCredentialPort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: true, needsRehash: false }),
      ),
      hash: jest.fn(() => Promise.resolve('new')),
    } as unknown as PasswordHasherPort
    const target = new ChangePasswordUseCase(
      credentials,
      passwords,
      new SessionCleanupService({
        revokeAll: jest.fn(() => Promise.reject(new Error('redis'))),
      } as unknown as SessionStorePort),
    )
    await expect(target.execute(input())).resolves.toEqual({
      cleanupComplete: false,
    })
  })
})
