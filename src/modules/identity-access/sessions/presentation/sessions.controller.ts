import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import type { AuthenticatedPrincipal } from '../../public-contracts/authenticated-principal'
import { AuthenticationRequiredError } from '../../public-contracts/auth-errors'
import { AuthMutationResponseDto } from '../../public-contracts/auth-mutation-response.dto'
import { CurrentPrincipal } from '../../public-contracts/current-principal.decorator'
import { GetCsrfTokenQuery } from '../application/get-csrf-token.query'
import { ListSessionsQuery } from '../application/list-sessions.query'
import { LogoutAllUseCase } from '../application/logout-all.use-case'
import { LogoutUseCase } from '../application/logout.use-case'
import { RevokeSessionUseCase } from '../application/revoke-session.use-case'
import { AuthCookieAdapter } from './auth-cookie.adapter'
import { SessionPathDto } from './sessions.dto'
import {
  CsrfTokenResponseDto,
  SessionsResponseDto,
} from './sessions-response.dto'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'

@Controller('auth')
@ApiTags('auth')
export class SessionsController {
  public constructor(
    @Inject(LogoutUseCase)
    private readonly logoutUseCase: LogoutUseCase,
    @Inject(GetCsrfTokenQuery)
    private readonly getCsrfTokenQuery: GetCsrfTokenQuery,
    @Inject(ListSessionsQuery)
    private readonly listSessionsQuery: ListSessionsQuery,
    @Inject(RevokeSessionUseCase)
    private readonly revokeSessionUseCase: RevokeSessionUseCase,
    @Inject(LogoutAllUseCase)
    private readonly logoutAllUseCase: LogoutAllUseCase,
    @Inject(AuthCookieAdapter)
    private readonly cookies: AuthCookieAdapter,
  ) {}

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
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.logoutUseCase.execute(principal.userId, principal.sessionId)
    this.cookies.clear(response)
  }

  @Get('csrf')
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
  public csrf(@Req() request: Request): Promise<CsrfTokenResponseDto> {
    const rawToken = this.cookies.read(request)
    if (rawToken === undefined) throw new AuthenticationRequiredError()
    return this.getCsrfTokenQuery.execute(rawToken, Date.now())
  }

  @Get('sessions')
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
  public async sessions(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<SessionsResponseDto> {
    return { sessions: await this.listSessionsQuery.execute(principal) }
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
  public async revokeSession(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() path: SessionPathDto,
  ): Promise<void> {
    await this.revokeSessionUseCase.execute(principal, path.sessionId)
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
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthMutationResponseDto> {
    const result = await this.logoutAllUseCase.execute(principal.userId)
    this.cookies.clear(response)
    return result
  }
}
