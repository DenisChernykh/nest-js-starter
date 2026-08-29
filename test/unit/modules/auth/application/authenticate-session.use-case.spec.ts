import { AuthenticateSessionUseCase } from '@/modules/auth/application/authenticate-session.use-case'
import { AuthDependencyUnavailableError } from '@/modules/auth/application/auth-errors'
import type { IdentitySecurityStatePort } from '@/modules/auth/identity/application/identity-security-state.port'
import { definePermissions } from '@/modules/auth/application/permission'
import { RoleRegistry } from '@/modules/auth/application/role-registry'
import type { SessionStorePort } from '@/modules/auth/sessions/application/session-store.port'
import { ResolveSessionIdentityQuery } from '@/modules/auth/sessions/application/resolve-session-identity.query'

/* eslint-disable @typescript-eslint/unbound-method */

const record = {
  schema: 1 as const,
  publicId: 'public',
  userId: 'user',
  sessionGeneration: '2',
  globalSessionEpoch: '3',
  csrfSeed: 'seed',
  createdAtMs: 1,
  lastSeenAtMs: 1,
  absoluteExpiresAtMs: 10_000,
  deviceLabel: 'browser',
  networkFingerprint: 'network',
}

describe('AuthenticateSessionUseCase', () => {
  it('refreshes durable projection and resolves roles on every request', async () => {
    const sessions = {
      readAndTouch: jest.fn(() => Promise.resolve(record)),
    } as unknown as SessionStorePort
    const persistence = {
      findAuthProjectionByUserId: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          email: 'User@Example.com',
          normalizedEmail: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 2n,
          roleKeys: ['member.reader'],
        }),
      ),
      readGlobalSessionEpoch: jest.fn(() => Promise.resolve(3n)),
    } as unknown as IdentitySecurityStatePort
    const target = new AuthenticateSessionUseCase(
      new ResolveSessionIdentityQuery(sessions, persistence),
      new RoleRegistry([
        {
          key: 'member.reader',
          permissions: definePermissions(['catalog.read']),
        },
      ]),
    )
    const principal = await target.execute('raw', 100)
    expect(principal).toMatchObject({ userId: 'user', sessionId: 'public' })
    expect([...principal.permissions]).toEqual(['catalog.read'])
    expect(persistence.findAuthProjectionByUserId).toHaveBeenCalledTimes(1)
  })
  it('fails closed for stale generation or missing sessions', async () => {
    const persistence = {
      findAuthProjectionByUserId: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          email: 'user@example.com',
          normalizedEmail: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 3n,
          roleKeys: [],
        }),
      ),
      readGlobalSessionEpoch: jest.fn(() => Promise.resolve(3n)),
    } as unknown as IdentitySecurityStatePort
    const stale = new AuthenticateSessionUseCase(
      new ResolveSessionIdentityQuery(
        {
          readAndTouch: jest.fn(() => Promise.resolve(record)),
        } as unknown as SessionStorePort,
        persistence,
      ),
      new RoleRegistry([]),
    )
    await expect(stale.execute('raw', 100)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
    const missing = new AuthenticateSessionUseCase(
      new ResolveSessionIdentityQuery(
        {
          readAndTouch: jest.fn(() => Promise.resolve(undefined)),
        } as unknown as SessionStorePort,
        {} as IdentitySecurityStatePort,
      ),
      new RoleRegistry([]),
    )
    await expect(missing.execute('raw', 100)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
  })
  it('maps unexpected adapter failures to dependency unavailable', async () => {
    const target = new AuthenticateSessionUseCase(
      new ResolveSessionIdentityQuery(
        {
          readAndTouch: jest.fn(() =>
            Promise.reject(new Error('driver detail')),
          ),
        } as unknown as SessionStorePort,
        {} as IdentitySecurityStatePort,
      ),
      new RoleRegistry([]),
    )
    await expect(target.execute('raw', 100)).rejects.toBeInstanceOf(
      AuthDependencyUnavailableError,
    )
  })
})
