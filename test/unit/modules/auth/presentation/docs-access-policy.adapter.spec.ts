import type { AuthenticateSessionUseCase } from '@/modules/auth/application/authenticate-session.use-case'
import type { AuthAuditPort } from '@/modules/auth/application/auth-audit.port'
import {
  AuthDependencyUnavailableError,
  AuthenticationRequiredError,
} from '@/modules/auth/application/auth-errors'
import { definePermissions } from '@/modules/auth/application/permission'
import { DocsAccessPolicyAdapter } from '@/modules/auth/presentation/docs-access-policy.adapter'

describe('DocsAccessPolicyAdapter', () => {
  const rawToken = 'A'.repeat(43)
  const cookieName = 'nest-js-starter-session'
  const principal = {
    userId: 'user-1',
    sessionId: 'session-1',
    normalizedEmail: 'user@example.com',
    roleKeys: [],
    permissions: new Set(definePermissions(['system.docs.read'])),
  }

  function createPolicy(
    execute: jest.Mock,
    emit: jest.Mock = jest.fn(),
  ): { readonly policy: DocsAccessPolicyAdapter; readonly emit: jest.Mock } {
    return {
      policy: new DocsAccessPolicyAdapter(
        { execute } as unknown as AuthenticateSessionUseCase,
        { emit } satisfies AuthAuditPort,
        cookieName,
      ),
      emit,
    }
  }

  it('lives in presentation instead of the DI-only composition layer', () => {
    expect(
      existsSync(
        resolve('src/modules/auth/composition/docs-access-policy.adapter.ts'),
      ),
    ).toBe(false)
    expect(
      existsSync(
        resolve('src/modules/auth/presentation/docs-access-policy.adapter.ts'),
      ),
    ).toBe(true)
  })

  it.each([
    undefined,
    `${cookieName}=short`,
    `${cookieName}=${rawToken}; ${cookieName}=${'B'.repeat(43)}`,
  ])('rejects missing, malformed or duplicate cookie %j', async (cookie) => {
    const execute = jest.fn()
    const { policy, emit } = createPolicy(execute)

    await expect(policy.authorize(cookie, 123)).resolves.toEqual({
      allowed: false,
      problemCode: 'AUTHENTICATION_REQUIRED',
    })
    expect(execute).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith({
      action: 'docs_access',
      outcome: 'denied',
      reasonCode: 'AUTHENTICATION_REQUIRED',
    })
  })

  it('maps an expired session to authentication required', async () => {
    const { policy, emit } = createPolicy(
      jest.fn(() => Promise.reject(new AuthenticationRequiredError())),
    )

    await expect(
      policy.authorize(`${cookieName}=${rawToken}`, 123),
    ).resolves.toEqual({
      allowed: false,
      problemCode: 'AUTHENTICATION_REQUIRED',
    })
    expect(emit).toHaveBeenCalledWith({
      action: 'docs_access',
      outcome: 'denied',
      reasonCode: 'AUTHENTICATION_REQUIRED',
    })
  })

  it('maps an auth dependency outage without identity data', async () => {
    const { policy, emit } = createPolicy(
      jest.fn(() => Promise.reject(new AuthDependencyUnavailableError())),
    )

    await expect(
      policy.authorize(`${cookieName}=${rawToken}`, 123),
    ).resolves.toEqual({
      allowed: false,
      problemCode: 'DEPENDENCY_UNAVAILABLE',
    })
    expect(emit).toHaveBeenCalledWith({
      action: 'docs_access',
      outcome: 'denied',
      reasonCode: 'DEPENDENCY_UNAVAILABLE',
    })
  })

  it('denies an authenticated principal without the docs permission', async () => {
    const { policy, emit } = createPolicy(
      jest.fn(() => Promise.resolve({ ...principal, permissions: new Set() })),
    )

    await expect(
      policy.authorize(`${cookieName}=${rawToken}`, 123),
    ).resolves.toEqual({
      allowed: false,
      problemCode: 'AUTHORIZATION_DENIED',
    })
    expect(emit).toHaveBeenCalledWith({
      action: 'docs_access',
      outcome: 'denied',
      reasonCode: 'AUTHORIZATION_DENIED',
      actorId: 'user-1',
      sessionId: 'session-1',
    })
  })

  it('allows an authenticated principal with system.docs.read', async () => {
    const execute = jest.fn(() => Promise.resolve(principal))
    const { policy, emit } = createPolicy(execute)

    await expect(
      policy.authorize(`${cookieName}=${rawToken}`, 123),
    ).resolves.toEqual({ allowed: true })
    expect(execute).toHaveBeenCalledWith(rawToken, 123)
    expect(emit).not.toHaveBeenCalled()
  })
})
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
