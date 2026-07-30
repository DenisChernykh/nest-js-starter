import type { Server } from 'node:http'

import { ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'

import type { AuthenticatedPrincipal } from '@/modules/auth/application/auth.types'
import { AuthenticateSessionUseCase } from '@/modules/auth/application/authenticate-session.use-case'
import { ChangePasswordUseCase } from '@/modules/auth/application/change-password.use-case'
import { GetCsrfTokenQuery } from '@/modules/auth/application/get-csrf-token.query'
import { GetMeQuery } from '@/modules/auth/application/get-me.query'
import { ListSessionsQuery } from '@/modules/auth/application/list-sessions.query'
import { LoginUseCase } from '@/modules/auth/application/login.use-case'
import { LogoutAllUseCase } from '@/modules/auth/application/logout-all.use-case'
import { LogoutUseCase } from '@/modules/auth/application/logout.use-case'
import { RevokeSessionUseCase } from '@/modules/auth/application/revoke-session.use-case'
import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import {
  AUTH_LOGIN_METADATA_FACTORY,
  AuthController,
} from '@/modules/auth/presentation/auth.controller'
import { AuthCookieAdapter } from '@/modules/auth/presentation/auth-cookie.adapter'
import { AuthRequestContext } from '@/modules/auth/presentation/auth-request.context'
import { AuthRequestInterceptor } from '@/modules/auth/presentation/auth-request.interceptor'
import { AuthenticationGuard } from '@/modules/auth/presentation/authentication.guard'
import { BrowserOriginGuard } from '@/modules/auth/presentation/browser-origin.guard'
import { PermissionGuard } from '@/modules/auth/presentation/permission.guard'
import { SessionCsrfGuard } from '@/modules/auth/presentation/session-csrf.guard'
import { RequestContext } from '@/platform/http/context/request-context'
import { createRequestContextMiddleware } from '@/platform/http/context/request-context.middleware'
import { ProblemExceptionFilter } from '@/platform/http/errors/problem-exception.filter'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import { RequestValidationError } from '@/platform/http/errors/request-validation.error'
import { mapValidationErrors } from '@/platform/http/errors/validation-error.mapper'

/** Deterministic auth use-case doubles exposed to transport contract tests. */
export interface AuthTestDoubles {
  readonly login: { readonly execute: jest.Mock }
  readonly authenticate: { readonly execute: jest.Mock }
  readonly csrf: { readonly execute: jest.Mock }
  readonly listSessions: { readonly execute: jest.Mock }
  readonly logout: { readonly execute: jest.Mock }
  readonly logoutAll: { readonly execute: jest.Mock }
  readonly revokeSession: { readonly execute: jest.Mock }
  readonly changePassword: { readonly execute: jest.Mock }
}

/** Running in-memory auth transport application and its deterministic fixtures. */
export interface AuthTestHarness {
  readonly app: INestApplication
  readonly server: Server
  readonly doubles: AuthTestDoubles
  readonly cookieName: string
  readonly rawToken: string
  readonly csrfToken: string
}

/** Starts the isolated browser-auth transport contract with deterministic fakes. */
export async function createAuthTestHarness(
  secureCookie = false,
): Promise<AuthTestHarness> {
  const rawToken = 'A'.repeat(43)
  const csrfToken = 'B'.repeat(43)
  const currentSessionId = 'C'.repeat(22)
  const cookieName = secureCookie ? '__Host-session' : 'nest-js-starter-session'
  const principal: AuthenticatedPrincipal = {
    userId: 'user-1',
    sessionId: currentSessionId,
    normalizedEmail: 'user@example.com',
    roleKeys: ['admin'],
    permissions: new Set(),
  }
  const doubles: AuthTestDoubles = {
    login: {
      execute: jest.fn(() =>
        Promise.resolve({
          rawToken,
          publicId: currentSessionId,
          csrfToken,
          absoluteExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
        }),
      ),
    },
    authenticate: { execute: jest.fn(() => Promise.resolve(principal)) },
    csrf: {
      execute: jest.fn(() => Promise.resolve({ csrfToken })),
    },
    listSessions: {
      execute: jest.fn(() =>
        Promise.resolve([
          {
            publicId: currentSessionId,
            createdAt: new Date('2029-01-01T00:00:00.000Z'),
            lastSeenAt: new Date('2029-01-02T00:00:00.000Z'),
            absoluteExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
            deviceLabel: 'test browser',
            current: true,
          },
        ]),
      ),
    },
    logout: { execute: jest.fn(() => Promise.resolve(true)) },
    logoutAll: {
      execute: jest.fn(() => Promise.resolve({ cleanupComplete: true })),
    },
    revokeSession: { execute: jest.fn(() => Promise.resolve(true)) },
    changePassword: {
      execute: jest.fn(() => Promise.resolve({ cleanupComplete: true })),
    },
  }
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      Reflector,
      AuthRequestContext,
      GetMeQuery,
      { provide: LoginUseCase, useValue: doubles.login },
      { provide: AuthenticateSessionUseCase, useValue: doubles.authenticate },
      { provide: GetCsrfTokenQuery, useValue: doubles.csrf },
      { provide: ListSessionsQuery, useValue: doubles.listSessions },
      { provide: LogoutUseCase, useValue: doubles.logout },
      { provide: LogoutAllUseCase, useValue: doubles.logoutAll },
      { provide: RevokeSessionUseCase, useValue: doubles.revokeSession },
      { provide: ChangePasswordUseCase, useValue: doubles.changePassword },
      {
        provide: AuthCookieAdapter,
        useValue: new AuthCookieAdapter(cookieName, secureCookie),
      },
      {
        provide: AUTH_LOGIN_METADATA_FACTORY,
        useValue: () => ({
          deviceLabel: 'test browser',
          networkFingerprint: 'test-network',
        }),
      },
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  const httpRequestContext = new RequestContext()
  app.use(createRequestContextMiddleware(httpRequestContext))
  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      exceptionFactory: (errors) =>
        new RequestValidationError(mapValidationErrors(errors)),
    }),
  )
  const reflector = app.get(Reflector)
  const requestContext = app.get(AuthRequestContext)
  app.useGlobalGuards(
    new AuthenticationGuard(
      reflector,
      doubles.authenticate as unknown as AuthenticateSessionUseCase,
      requestContext,
      cookieName,
    ),
    new BrowserOriginGuard(['https://app.example.com']),
    new SessionCsrfGuard(
      reflector,
      requestContext,
      doubles.csrf as unknown as GetCsrfTokenQuery,
      (left, right) => left === right,
    ),
    new PermissionGuard(reflector, requestContext),
  )
  app.useGlobalInterceptors(
    new AuthRequestInterceptor(reflector, requestContext),
  )
  app.useGlobalFilters(
    new ProblemExceptionFilter(
      app.get(HttpAdapterHost),
      httpRequestContext,
      { write: jest.fn() },
      new HttpProblemRegistry([
        CORE_HTTP_PROBLEM_CONTRIBUTION,
        AUTH_HTTP_PROBLEM_CONTRIBUTION,
      ]),
    ),
  )
  app.setGlobalPrefix('v1')
  await app.init()
  await app.listen(0, '127.0.0.1')
  return {
    app,
    server: app.getHttpServer() as Server,
    doubles,
    cookieName,
    rawToken,
    csrfToken,
  }
}
