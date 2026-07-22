import type { AuthPersistencePort } from '@/modules/auth/application/auth-persistence.port'
import { AuthenticateSessionUseCase } from '@/modules/auth/application/authenticate-session.use-case'
import {
  AuthDependencyUnavailableError,
  AuthorizationDeniedError,
} from '@/modules/auth/application/auth-errors'
import { definePermissions } from '@/modules/auth/application/permission'
import { RoleRegistry } from '@/modules/auth/application/role-registry'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'
import type { AuthTelemetryPort } from '@/modules/auth/application/auth-telemetry.port'

describe('AuthenticateSessionUseCase', () => {
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

  it('refreshes projection and epoch on every request and resolves roles', async () => {
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
    } as unknown as AuthPersistencePort
    const roles = new RoleRegistry([
      {
        key: 'member.reader',
        permissions: definePermissions(['catalog.read']),
      },
    ])
    const target = new AuthenticateSessionUseCase(sessions, persistence, roles)

    await target.execute('raw', 100)
    const principal = await target.execute('raw', 200)

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(persistence.findAuthProjectionByUserId).toHaveBeenCalledTimes(2)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(persistence.readGlobalSessionEpoch).toHaveBeenCalledTimes(2)
    expect([...principal.permissions]).toEqual(['catalog.read'])
  })

  it('fails closed for stale generation or epoch', async () => {
    const sessions = {
      readAndTouch: jest.fn(() => Promise.resolve(record)),
    } as unknown as SessionStorePort
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
    } as unknown as AuthPersistencePort
    const target = new AuthenticateSessionUseCase(
      sessions,
      persistence,
      new RoleRegistry([]),
    )

    await expect(target.execute('raw', 100)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
  })

  it('fails closed when the opaque session no longer exists', async () => {
    const target = new AuthenticateSessionUseCase(
      {
        readAndTouch: jest.fn(() => Promise.resolve(undefined)),
      } as unknown as SessionStorePort,
      {} as AuthPersistencePort,
      new RoleRegistry([]),
    )

    await expect(target.execute('raw', 100)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
  })

  it('preserves typed dependency outages without exposing their cause', async () => {
    const target = new AuthenticateSessionUseCase(
      {
        readAndTouch: jest.fn(() =>
          Promise.reject(new AuthDependencyUnavailableError()),
        ),
      } as unknown as SessionStorePort,
      {} as AuthPersistencePort,
      new RoleRegistry([]),
    )

    await expect(target.execute('raw', 100)).rejects.toBeInstanceOf(
      AuthDependencyUnavailableError,
    )
  })

  it('maps authorization state errors to an unauthenticated result', async () => {
    const sessions = {
      readAndTouch: jest.fn(() => Promise.resolve(record)),
    } as unknown as SessionStorePort
    const persistence = {
      findAuthProjectionByUserId: jest.fn(() =>
        Promise.resolve({
          userId: 'user',
          email: 'user@example.com',
          normalizedEmail: 'user@example.com',
          status: 'active' as const,
          sessionGeneration: 2n,
          roleKeys: [],
        }),
      ),
      readGlobalSessionEpoch: jest.fn(() => Promise.resolve(3n)),
    } as unknown as AuthPersistencePort
    const roles = {
      resolve: jest.fn(() => {
        throw new AuthorizationDeniedError()
      }),
    } as unknown as RoleRegistry

    await expect(
      new AuthenticateSessionUseCase(sessions, persistence, roles).execute(
        'raw',
        100,
      ),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
  })

  it('maps unexpected adapter failures to a dependency outage', async () => {
    const target = new AuthenticateSessionUseCase(
      {
        readAndTouch: jest.fn(() => Promise.reject(new Error('driver detail'))),
      } as unknown as SessionStorePort,
      {} as AuthPersistencePort,
      new RoleRegistry([]),
    )

    await expect(target.execute('raw', 100)).rejects.toBeInstanceOf(
      AuthDependencyUnavailableError,
    )
  })

  it('records a fixed span and dependency outcome without session identifiers', async () => {
    const telemetry = {
      runAuthOperation: jest.fn((_operation, work) => work()),
      recordAuthOutcome: jest.fn(),
    } as jest.Mocked<AuthTelemetryPort>
    const target = new AuthenticateSessionUseCase(
      {
        readAndTouch: jest.fn(() => Promise.reject(new Error('driver detail'))),
      } as unknown as SessionStorePort,
      {} as AuthPersistencePort,
      new RoleRegistry([]),
      telemetry,
    )

    await expect(
      target.execute('raw-private-token', 100),
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(telemetry.runAuthOperation).toHaveBeenCalledWith(
      'authenticate',
      expect.any(Function),
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(telemetry.recordAuthOutcome).toHaveBeenCalledWith(
      'authenticate',
      'dependency_error',
    )
  })
})
