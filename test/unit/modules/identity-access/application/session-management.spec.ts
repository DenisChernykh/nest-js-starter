import { AuthenticationRequiredError } from '@/modules/identity-access/public-contracts/auth-errors'
import {
  SessionCleanupService,
  type AuthSessionCleanupObserver,
} from '@/modules/identity-access/sessions/application/session-cleanup.service'
import { GetCsrfTokenQuery } from '@/modules/identity-access/sessions/application/get-csrf-token.query'
import { ListSessionsQuery } from '@/modules/identity-access/sessions/application/list-sessions.query'
import { LogoutAllUseCase } from '@/modules/identity-access/sessions/application/logout-all.use-case'
import { LogoutUseCase } from '@/modules/identity-access/sessions/application/logout.use-case'
import { definePermissions } from '@/shared/application/permission'
import { RevokeSessionUseCase } from '@/modules/identity-access/sessions/application/revoke-session.use-case'
import type { SessionStorePort } from '@/modules/identity-access/sessions/application/session-store.port'
import type { SessionGenerationPort } from '@/modules/identity-access/sessions/application/session-generation.port'
import type { AuthenticatedPrincipal } from '@/modules/identity-access/public-contracts/authenticated-principal'

/* eslint-disable @typescript-eslint/unbound-method */

const principal: AuthenticatedPrincipal = {
  userId: 'user',
  sessionId: 'current',
  normalizedEmail: 'user@example.com',
  roleKeys: ['member.reader'],
  permissions: new Set(definePermissions(['catalog.read'])),
}

describe('auth session management', () => {
  it('keeps session operations inside authenticated ownership', async () => {
    const sessions = {
      revoke: jest.fn(() => Promise.resolve(true)),
      list: jest.fn(() => Promise.resolve([])),
    } as unknown as SessionStorePort
    await new LogoutUseCase(sessions).execute('user', 'current')
    await new RevokeSessionUseCase(sessions).execute(principal, 'other')
    await new ListSessionsQuery(sessions).execute(principal)
    expect(sessions.revoke).toHaveBeenNthCalledWith(1, 'user', 'current')
    expect(sessions.revoke).toHaveBeenNthCalledWith(2, 'user', 'other')
    expect(sessions.list).toHaveBeenCalledWith('user', 'current')
  })
  it('derives CSRF only from a currently valid stored record', async () => {
    const sessions = {
      readAndTouch: jest.fn(() => Promise.resolve(undefined)),
      csrfToken: jest.fn(() => 'csrf'),
    } as unknown as SessionStorePort
    await expect(
      new GetCsrfTokenQuery(sessions).execute('raw', 100),
    ).rejects.toBeInstanceOf(AuthenticationRequiredError)
    expect(sessions.csrfToken).not.toHaveBeenCalled()
  })
  it('returns the current CSRF token for a live session', async () => {
    const record = {
      schema: 1 as const,
      publicId: 'current',
      userId: 'user',
      sessionGeneration: '1',
      globalSessionEpoch: '1',
      csrfSeed: 'seed',
      createdAtMs: 1,
      lastSeenAtMs: 1,
      absoluteExpiresAtMs: 10,
      deviceLabel: 'browser',
      networkFingerprint: 'network',
    }
    const sessions = {
      readAndTouch: jest.fn(() => Promise.resolve(record)),
      csrfToken: jest.fn(() => 'csrf'),
    } as unknown as SessionStorePort
    await expect(
      new GetCsrfTokenQuery(sessions).execute('raw', 2),
    ).resolves.toEqual({ csrfToken: 'csrf' })
  })
  it('increments generation before best-effort logout-all cleanup', async () => {
    const order: string[] = []
    const generation = {
      incrementSessionGeneration: jest.fn(() => {
        order.push('generation')
        return Promise.resolve(2n)
      }),
    } as unknown as SessionGenerationPort
    const sessions = {
      revokeAll: jest.fn(() => {
        order.push('cleanup')
        return Promise.reject(new Error('redis'))
      }),
    } as unknown as SessionStorePort
    const observer = {
      cleanupIncomplete: jest.fn(() => order.push('event')),
    } satisfies AuthSessionCleanupObserver
    await expect(
      new LogoutAllUseCase(
        generation,
        new SessionCleanupService(sessions, observer),
      ).execute('user'),
    ).resolves.toEqual({ cleanupComplete: false })
    expect(order).toEqual(['generation', 'cleanup', 'event'])
  })
})
