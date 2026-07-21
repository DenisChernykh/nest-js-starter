import { AuthenticationRequiredError } from '@/modules/auth/application/auth-errors'
import type { AuthPersistencePort } from '@/modules/auth/application/auth-persistence.port'
import type {
  AuthenticatedPrincipal,
  AuthSessionCleanupObserver,
} from '@/modules/auth/application/auth.types'
import { GetCsrfTokenQuery } from '@/modules/auth/application/get-csrf-token.query'
import { GetMeQuery } from '@/modules/auth/application/get-me.query'
import { ListSessionsQuery } from '@/modules/auth/application/list-sessions.query'
import { LogoutAllUseCase } from '@/modules/auth/application/logout-all.use-case'
import { LogoutUseCase } from '@/modules/auth/application/logout.use-case'
import { definePermissions } from '@/modules/auth/application/permission'
import { RevokeSessionUseCase } from '@/modules/auth/application/revoke-session.use-case'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'
import type { TransactionPort } from '@/shared/application/transaction.port'

const principal: AuthenticatedPrincipal = {
  userId: 'user',
  sessionId: 'current',
  normalizedEmail: 'user@example.com',
  roleKeys: ['member.reader'],
  permissions: new Set(definePermissions(['catalog.read'])),
}

describe('auth session management', () => {
  it('keeps every session operation inside authenticated ownership', async () => {
    const sessions = {
      revoke: jest.fn(() => Promise.resolve(true)),
      list: jest.fn(() => Promise.resolve([])),
    } as unknown as SessionStorePort

    await new LogoutUseCase(sessions).execute('user', 'current')
    await new RevokeSessionUseCase(sessions).execute(principal, 'other')
    await new ListSessionsQuery(sessions).execute(principal)

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sessions.revoke).toHaveBeenNthCalledWith(1, 'user', 'current')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sessions.revoke).toHaveBeenNthCalledWith(2, 'user', 'other')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sessions.list).toHaveBeenCalledWith('user', 'current')
  })

  it('derives CSRF only from a currently valid stored record', async () => {
    const sessions = {
      readAndTouch: jest.fn(() => Promise.resolve(undefined)),
      csrfToken: jest.fn(() => 'csrf'),
    } as unknown as SessionStorePort
    const query = new GetCsrfTokenQuery(sessions)

    await expect(query.execute('raw', 100)).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sessions.csrfToken).not.toHaveBeenCalled()
  })

  it('returns a sorted immutable principal projection without I/O', () => {
    expect(new GetMeQuery().execute(principal)).toEqual({
      userId: 'user',
      normalizedEmail: 'user@example.com',
      roleKeys: ['member.reader'],
      permissions: ['catalog.read'],
    })
  })

  it('increments generation before cleanup and emits typed incomplete event', async () => {
    const order: string[] = []
    const persistence = {
      incrementSessionGeneration: jest.fn(() => {
        order.push('generation')
        return Promise.resolve(2n)
      }),
    } as unknown as AuthPersistencePort
    const transaction: TransactionPort = {
      run: async (operation) => {
        order.push('transaction')
        return operation()
      },
    }
    const sessions = {
      revokeAll: jest.fn(() => {
        order.push('cleanup')
        return Promise.reject(new Error('redis detail'))
      }),
    } as unknown as SessionStorePort
    const observer = {
      cleanupIncomplete: jest.fn(() => order.push('event')),
    } satisfies AuthSessionCleanupObserver
    const target = new LogoutAllUseCase(
      persistence,
      transaction,
      sessions,
      observer,
    )

    await expect(target.execute('user')).resolves.toEqual({
      cleanupComplete: false,
    })
    expect(order).toEqual(['transaction', 'generation', 'cleanup', 'event'])
    expect(observer.cleanupIncomplete).toHaveBeenCalledWith(
      'logout-all',
      'user',
    )
  })
})
