import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { ChangePasswordUseCase } from '../application/change-password.use-case'
import { GetCsrfTokenQuery } from '../application/get-csrf-token.query'
import { GetMeQuery } from '../application/get-me.query'
import { ListSessionsQuery } from '../application/list-sessions.query'
import { LoginUseCase } from '../application/login.use-case'
import { LogoutAllUseCase } from '../application/logout-all.use-case'
import { LogoutUseCase } from '../application/logout.use-case'
import { RevokeSessionUseCase } from '../application/revoke-session.use-case'
import { AuthCookieAdapter } from './auth-cookie.adapter'
import {
  ChangePasswordRequestDto,
  LoginRequestDto,
  SessionPathDto,
} from './auth.dto'
import {
  AuthMutationResponseDto,
  CsrfTokenResponseDto,
  CurrentUserResponseDto,
  LoginResponseDto,
  SessionsResponseDto,
} from './auth-response.dto'
import { AuthRequestContext } from './auth-request.context'
import { CsrfTokenExempt } from './session-csrf.guard'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'
import { SafeEndpoint } from '@/platform/http/policy/safe-endpoint.decorator'

/** Dependency-injection token for redacted login request metadata. */
export const AUTH_LOGIN_METADATA_FACTORY = Symbol('auth:login-metadata-factory')

/** Safe metadata derived from untrusted HTTP request attributes. */
export interface LoginRequestMetadata {
  readonly deviceLabel: string
  readonly networkFingerprint: string
}

/** Converts request attributes into bounded labels and a keyed fingerprint. */
export type LoginRequestMetadataFactory = (input: {
  readonly ipAddress: string
  readonly userAgent: string | undefined
}) => LoginRequestMetadata

/** Hardened browser-session HTTP API with no raw-token response surface. */
@Controller('auth')
@ApiTags('auth')
export class AuthController {
  public constructor(
    @Inject(LoginUseCase)
    private readonly loginUseCase: LoginUseCase,
    @Inject(LogoutUseCase)
    private readonly logoutUseCase: LogoutUseCase,
    @Inject(GetMeQuery)
    private readonly getMeQuery: GetMeQuery,
    @Inject(GetCsrfTokenQuery)
    private readonly getCsrfTokenQuery: GetCsrfTokenQuery,
    @Inject(ChangePasswordUseCase)
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    @Inject(ListSessionsQuery)
    private readonly listSessionsQuery: ListSessionsQuery,
    @Inject(RevokeSessionUseCase)
    private readonly revokeSessionUseCase: RevokeSessionUseCase,
    @Inject(LogoutAllUseCase)
    private readonly logoutAllUseCase: LogoutAllUseCase,
    @Inject(AuthRequestContext)
    private readonly requestContext: AuthRequestContext,
    @Inject(AuthCookieAdapter)
    private readonly cookies: AuthCookieAdapter,
    @Inject(AUTH_LOGIN_METADATA_FACTORY)
    private readonly loginMetadata: LoginRequestMetadataFactory,
  ) {}

  @Post('login')
  @HttpCode(200)
  @PublicEndpoint()
  @CsrfTokenExempt()
  @ApiOperation({
    operationId: 'authLogin',
    summary: 'Create a browser session',
    security: [],
  })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({
    type: LoginResponseDto,
    description: 'Browser session created and its HttpOnly cookie issued.',
  })
  @ApiProblemResponses(
    'MALFORMED_REQUEST',
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'RATE_LIMIT_EXCEEDED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async login(
    @Body() body: LoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const ipAddress = request.ip ?? request.socket.remoteAddress ?? 'unknown'
    const metadata = this.loginMetadata({
      ipAddress,
      userAgent: request.get('user-agent'),
    })
    const session = await this.loginUseCase.execute({
      email: body.email,
      password: body.password,
      ipAddress,
      nowMs: Date.now(),
      deviceLabel: metadata.deviceLabel,
      networkFingerprint: metadata.networkFingerprint,
    })
    this.cookies.set(response, session)
    return {
      csrfToken: session.csrfToken,
      session: {
        publicId: session.publicId,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'authLogout',
    summary: 'Revoke the current browser session',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiNoContentResponse({
    description: 'Current session revoked and its browser cookie cleared.',
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'UNSUPPORTED_MEDIA_TYPE',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async logout(
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const principal = this.requestContext.principal
    await this.logoutUseCase.execute(principal.userId, principal.sessionId)
    this.cookies.clear(response)
  }

  @Get('me')
  @SafeEndpoint()
  @ApiOperation({
    operationId: 'authGetMe',
    summary: 'Get the current authenticated identity',
    security: [{ sessionCookie: [] }],
  })
  @ApiOkResponse({
    type: CurrentUserResponseDto,
    description: 'Fresh current-user projection.',
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public me(): CurrentUserResponseDto {
    return this.getMeQuery.execute(this.requestContext.principal)
  }

  @Get('csrf')
  @SafeEndpoint()
  @ApiOperation({
    operationId: 'authGetCsrfToken',
    summary: 'Get the current session-bound CSRF token',
    security: [{ sessionCookie: [] }],
  })
  @ApiOkResponse({
    type: CsrfTokenResponseDto,
    description: 'Session-bound CSRF token for unsafe browser requests.',
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public csrf(): Promise<CsrfTokenResponseDto> {
    return this.getCsrfTokenQuery.execute(
      this.requestContext.rawToken,
      Date.now(),
    )
  }

  @Put('password')
  @ApiOperation({
    operationId: 'authChangePassword',
    summary: 'Change the current account password',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiBody({ type: ChangePasswordRequestDto })
  @ApiOkResponse({
    type: AuthMutationResponseDto,
    description: 'Password changed durably and session cleanup attempted.',
  })
  @ApiProblemResponses(
    'MALFORMED_REQUEST',
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'CONFLICT',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async changePassword(
    @Body() body: ChangePasswordRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthMutationResponseDto> {
    const principal = this.requestContext.principal
    const result = await this.changePasswordUseCase.execute({
      userId: principal.userId,
      normalizedEmail: principal.normalizedEmail,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    })
    this.cookies.clear(response)
    return result
  }

  @Get('sessions')
  @SafeEndpoint()
  @ApiOperation({
    operationId: 'authListSessions',
    summary: 'List browser sessions owned by the current user',
    security: [{ sessionCookie: [] }],
  })
  @ApiOkResponse({
    type: SessionsResponseDto,
    description: 'Owned browser sessions with safe device metadata.',
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async sessions(): Promise<SessionsResponseDto> {
    return {
      sessions: await this.listSessionsQuery.execute(
        this.requestContext.principal,
      ),
    }
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'authRevokeSession',
    summary: 'Revoke one owned browser session',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({
    name: 'sessionId',
    required: true,
    schema: {
      type: 'string',
      minLength: 22,
      maxLength: 22,
      pattern: '^[A-Za-z0-9_-]{22}$',
      example: 'AbCdEfGhIjKlMnOpQrStUv',
    },
  })
  @ApiNoContentResponse({ description: 'Owned session revoked if present.' })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async revokeSession(@Param() path: SessionPathDto): Promise<void> {
    await this.revokeSessionUseCase.execute(
      this.requestContext.principal,
      path.sessionId,
    )
  }

  @Delete('sessions')
  @ApiOperation({
    operationId: 'authLogoutAll',
    summary: 'Revoke every browser session for the current user',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiOkResponse({
    type: AuthMutationResponseDto,
    description: 'All sessions revoked durably and Redis cleanup attempted.',
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'UNSUPPORTED_MEDIA_TYPE',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async logoutAll(
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthMutationResponseDto> {
    const result = await this.logoutAllUseCase.execute(
      this.requestContext.principal.userId,
    )
    this.cookies.clear(response)
    return result
  }
}
