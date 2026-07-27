import { INJECTABLE_WATERMARK } from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'

import {
  AUTH_PERSISTENCE,
  type AuthPersistencePort,
} from '@/modules/auth/application/auth-persistence.port'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
} from '@/modules/auth/application/auth-audit.port'
import {
  AUTH_DUMMY_PASSWORD_HASH,
  AUTH_SESSION_CLEANUP_OBSERVER,
  type AuthenticatedPrincipal,
  type AuthSessionCleanupObserver,
} from '@/modules/auth/application/auth.types'
import { AuthenticateSessionUseCase } from '@/modules/auth/application/authenticate-session.use-case'
import { ChangePasswordUseCase } from '@/modules/auth/application/change-password.use-case'
import { CreateInitialAdminUseCase } from '@/modules/auth/application/create-initial-admin.use-case'
import { GetCsrfTokenQuery } from '@/modules/auth/application/get-csrf-token.query'
import { GetMeQuery } from '@/modules/auth/application/get-me.query'
import {
  LOGIN_RATE_LIMITER,
  type LoginRateLimiterPort,
} from '@/modules/auth/application/login-rate-limiter.port'
import { ListSessionsQuery } from '@/modules/auth/application/list-sessions.query'
import { LoginUseCase } from '@/modules/auth/application/login.use-case'
import { LogoutAllUseCase } from '@/modules/auth/application/logout-all.use-case'
import { LogoutUseCase } from '@/modules/auth/application/logout.use-case'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '@/modules/auth/application/password-hasher.port'
import type { PermissionKey } from '@/modules/auth/application/permission'
import { RevokeSessionUseCase } from '@/modules/auth/application/revoke-session.use-case'
import {
  createAuthRoleRegistry,
  RoleRegistry,
} from '@/modules/auth/application/role-registry'
import {
  SESSION_STORE,
  type SessionStorePort,
} from '@/modules/auth/application/session-store.port'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

const applicationClasses = [
  AuthenticateSessionUseCase,
  ChangePasswordUseCase,
  CreateInitialAdminUseCase,
  GetCsrfTokenQuery,
  GetMeQuery,
  ListSessionsQuery,
  LoginUseCase,
  LogoutAllUseCase,
  LogoutUseCase,
  RevokeSessionUseCase,
] as const

describe('auth application Nest dependency injection', () => {
  it('constructs runtime application classes directly through port tokens', async () => {
    const persistence: AuthPersistencePort = {
      bootstrapInitialAdmin: jest.fn(),
      findAuthProjectionByUserId: jest.fn(),
      findCredentialByNormalizedEmail: jest.fn(),
      incrementSessionGeneration: jest.fn(),
      readGlobalSessionEpoch: jest.fn(),
      replacePasswordIfVersion: jest.fn(),
    }
    const passwords: PasswordHasherPort = {
      hash: jest.fn(),
      verify: jest.fn(),
    }
    const limiter: LoginRateLimiterPort = {
      consume: jest.fn(),
    }
    const listSessions: jest.MockedFunction<SessionStorePort['list']> = jest
      .fn()
      .mockResolvedValue([])
    const sessions: SessionStorePort = {
      csrfToken: jest.fn(),
      issue: jest.fn(),
      list: listSessions,
      readAndTouch: jest.fn(),
      revoke: jest.fn(),
      revokeAll: jest.fn(),
    }
    const transaction: TransactionPort = {
      run: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
    }
    const cleanupObserver: AuthSessionCleanupObserver = {
      cleanupIncomplete: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        ...applicationClasses,
        { provide: AUTH_PERSISTENCE, useValue: persistence },
        { provide: PASSWORD_HASHER, useValue: passwords },
        { provide: LOGIN_RATE_LIMITER, useValue: limiter },
        { provide: SESSION_STORE, useValue: sessions },
        { provide: TRANSACTION_PORT, useValue: transaction },
        { provide: AUTH_AUDIT, useValue: NOOP_AUTH_AUDIT },
        {
          provide: AUTH_SESSION_CLEANUP_OBSERVER,
          useValue: cleanupObserver,
        },
        { provide: AUTH_DUMMY_PASSWORD_HASH, useValue: 'dummy-hash' },
        { provide: RoleRegistry, useValue: createAuthRoleRegistry() },
      ],
    }).compile()

    for (const applicationClass of applicationClasses) {
      expect(Reflect.getMetadata(INJECTABLE_WATERMARK, applicationClass)).toBe(
        true,
      )
      expect(moduleRef.get(applicationClass)).toBeInstanceOf(applicationClass)
    }

    const principal: AuthenticatedPrincipal = {
      userId: 'user-1',
      sessionId: 'session-1',
      normalizedEmail: 'admin@example.com',
      roleKeys: [],
      permissions: new Set<PermissionKey>(),
    }
    await expect(
      moduleRef.get(ListSessionsQuery).execute(principal),
    ).resolves.toEqual([])
    expect(listSessions).toHaveBeenCalledWith('user-1', 'session-1')

    await moduleRef.close()
  })
})
