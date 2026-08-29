import { AuthenticationFailedError } from '@/modules/auth/public-contracts/auth-errors'
import type { IdentitySecurityStatePort } from '@/modules/auth/identity/application/identity-security-state.port'
import { SessionIssuer } from '@/modules/auth/sessions/application/session-issuer'
import type { SessionStorePort } from '@/modules/auth/sessions/application/session-store.port'

function createHarness(status: 'active' | 'disabled' | 'missing' = 'active'): {
  readonly issuer: SessionIssuer
  readonly identity: IdentitySecurityStatePort
  readonly issue: jest.Mock
} {
  const identity = {
    findAuthProjectionByUserId: jest.fn(() =>
      Promise.resolve(
        status === 'missing'
          ? undefined
          : {
              userId: 'user-1',
              email: 'user@example.com',
              normalizedEmail: 'user@example.com',
              status,
              sessionGeneration: 7n,
              roleKeys: ['system.admin'],
            },
      ),
    ),
    readGlobalSessionEpoch: jest.fn(() => Promise.resolve(11n)),
  } as unknown as IdentitySecurityStatePort
  const issue = jest.fn(() =>
    Promise.resolve({
      rawToken: 'raw',
      publicId: 'public',
      csrfToken: 'csrf',
      absoluteExpiresAt: new Date(20_000),
    }),
  )
  const sessions = { issue } as unknown as SessionStorePort
  return { issuer: new SessionIssuer(identity, sessions), identity, issue }
}

describe('SessionIssuer', () => {
  it('derives generation and epoch from durable identity state', async () => {
    const target = createHarness()

    await expect(
      target.issuer.issue({
        userId: 'user-1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).resolves.toMatchObject({ publicId: 'public' })

    expect(target.issue).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionGeneration: 7n,
      globalSessionEpoch: 11n,
      nowMs: 1_000,
      deviceLabel: 'browser',
      networkFingerprint: 'network',
    })
  })

  it.each(['missing', 'disabled'] as const)(
    'does not issue a session for %s identity state',
    async (status) => {
      const target = createHarness(status)

      await expect(
        target.issuer.issue({
          userId: 'user-1',
          nowMs: 1_000,
          deviceLabel: 'browser',
          networkFingerprint: 'network',
        }),
      ).rejects.toBeInstanceOf(AuthenticationFailedError)
      expect(target.issue).not.toHaveBeenCalled()
    },
  )
})
