import type { Server } from 'node:http'

import { ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'

import type { AuthenticatedPrincipal } from '@/modules/auth/public-contracts/authenticated-principal'
import { AuthenticateSessionUseCase } from '@/modules/auth/authorization/application/authenticate-session.use-case'
import { ChangePasswordUseCase } from '@/modules/auth/authentication/application/change-password.use-case'
import { ConfirmEmailVerificationUseCase } from '@/modules/auth/application/confirm-email-verification.use-case'
import { ConfirmPasswordResetUseCase } from '@/modules/auth/application/confirm-password-reset.use-case'
import { GetCsrfTokenQuery } from '@/modules/auth/sessions/application/get-csrf-token.query'
import { GetMeQuery } from '@/modules/auth/authorization/application/get-me.query'
import { ListSessionsQuery } from '@/modules/auth/sessions/application/list-sessions.query'
import { LoginUseCase } from '@/modules/auth/authentication/application/login.use-case'
import { LogoutAllUseCase } from '@/modules/auth/sessions/application/logout-all.use-case'
import { LogoutUseCase } from '@/modules/auth/sessions/application/logout.use-case'
import { RevokeSessionUseCase } from '@/modules/auth/sessions/application/revoke-session.use-case'
import { RegisterUserUseCase } from '@/modules/auth/application/register-user.use-case'
import { RequestPasswordResetUseCase } from '@/modules/auth/application/request-password-reset.use-case'
import { ResendEmailVerificationUseCase } from '@/modules/auth/application/resend-email-verification.use-case'
import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import {
  AUTH_LOGIN_METADATA_FACTORY,
  AuthenticationController,
} from '@/modules/auth/authentication/presentation/authentication.controller'
import { AuthController } from '@/modules/auth/authorization/presentation/auth.controller'
import { SessionsController } from '@/modules/auth/sessions/presentation/sessions.controller'
import { AuthCookieAdapter } from '@/modules/auth/sessions'
import { AuthRequestContext } from '@/modules/auth/authorization/presentation/auth-request.context'
import { AuthRequestInterceptor } from '@/modules/auth/authorization/presentation/auth-request.interceptor'
import { AuthenticationGuard } from '@/modules/auth/authorization/presentation/authentication.guard'
import { BrowserOriginGuard } from '@/modules/auth/authorization/presentation/browser-origin.guard'
import { PublicAuthResponseDelay } from '@/modules/auth/presentation/public-auth-response-delay'
import { PermissionGuard } from '@/modules/auth/authorization/presentation/permission.guard'
import { SelfServiceAuthController } from '@/modules/auth/presentation/self-service-auth.controller'
import { SessionCsrfGuard } from '@/modules/auth/authorization/presentation/session-csrf.guard'
import { RequestContext } from '@/platform/http/context/request-context'
import { createRequestContextMiddleware } from '@/platform/http/context/request-context.middleware'
import { ProblemExceptionFilter } from '@/platform/http/errors/problem-exception.filter'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import { RequestValidationError } from '@/platform/http/errors/request-validation.error'
import { mapValidationErrors } from '@/platform/http/errors/validation-error.mapper'

type AuthUseCaseMock = jest.Mock<Promise<unknown>, [] | [unknown]>

/** Deterministic auth use-case doubles exposed to transport contract tests. */
export interface AuthTestDoubles {
  readonly login: { readonly execute: AuthUseCaseMock }
  readonly authenticate: { readonly execute: AuthUseCaseMock }
  readonly csrf: { readonly execute: AuthUseCaseMock }
  readonly listSessions: { readonly execute: AuthUseCaseMock }
  readonly logout: { readonly execute: AuthUseCaseMock }
  readonly logoutAll: { readonly execute: AuthUseCaseMock }
  readonly revokeSession: { readonly execute: AuthUseCaseMock }
  readonly changePassword: { readonly execute: AuthUseCaseMock }
  readonly register: { readonly execute: AuthUseCaseMock }
  readonly resendVerification: { readonly execute: AuthUseCaseMock }
  readonly confirmVerification: { readonly execute: AuthUseCaseMock }
  readonly requestPasswordReset: { readonly execute: AuthUseCaseMock }
  readonly confirmPasswordReset: { readonly execute: AuthUseCaseMock }
  readonly responseDelay: { readonly wait: AuthUseCaseMock }
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
    register: { execute: jest.fn(() => Promise.resolve({ accepted: true })) },
    resendVerification: {
      execute: jest.fn(() => Promise.resolve({ accepted: true })),
    },
    confirmVerification: { execute: jest.fn(() => Promise.resolve()) },
    requestPasswordReset: {
      execute: jest.fn(() => Promise.resolve({ accepted: true })),
    },
    confirmPasswordReset: { execute: jest.fn(() => Promise.resolve()) },
    responseDelay: { wait: jest.fn(() => Promise.resolve()) },
  }
  const moduleRef = await Test.createTestingModule({
    controllers: [
      AuthController,
      AuthenticationController,
      SessionsController,
      SelfServiceAuthController,
    ],
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
      { provide: RegisterUserUseCase, useValue: doubles.register },
      {
        provide: ResendEmailVerificationUseCase,
        useValue: doubles.resendVerification,
      },
      {
        provide: ConfirmEmailVerificationUseCase,
        useValue: doubles.confirmVerification,
      },
      {
        provide: RequestPasswordResetUseCase,
        useValue: doubles.requestPasswordReset,
      },
      {
        provide: ConfirmPasswordResetUseCase,
        useValue: doubles.confirmPasswordReset,
      },
      { provide: PublicAuthResponseDelay, useValue: doubles.responseDelay },
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
