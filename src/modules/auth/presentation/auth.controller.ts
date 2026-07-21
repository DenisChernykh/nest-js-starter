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

import { ChangePasswordUseCase } from '../application/change-password.use-case'
import { GetCsrfTokenQuery } from '../application/get-csrf-token.query'
import { GetMeQuery } from '../application/get-me.query'
import { ListSessionsQuery } from '../application/list-sessions.query'
import { LoginUseCase } from '../application/login.use-case'
import { LogoutAllUseCase } from '../application/logout-all.use-case'
import { LogoutUseCase } from '../application/logout.use-case'
import { RevokeSessionUseCase } from '../application/revoke-session.use-case'
import type { AuthDurableMutationResult } from '../application/auth.types'
import type { BrowserSessionSummary } from '../application/session-store.port'
import { AuthCookieAdapter } from './auth-cookie.adapter'
import {
  ChangePasswordRequestDto,
  type LoginResponseDto,
  LoginRequestDto,
  SessionPathDto,
} from './auth.dto'
import { AuthRequestContext } from './auth-request.context'
import { CsrfTokenExempt } from './session-csrf.guard'
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
export class AuthController {
  public constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getMeQuery: GetMeQuery,
    private readonly getCsrfTokenQuery: GetCsrfTokenQuery,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly listSessionsQuery: ListSessionsQuery,
    private readonly revokeSessionUseCase: RevokeSessionUseCase,
    private readonly logoutAllUseCase: LogoutAllUseCase,
    private readonly requestContext: AuthRequestContext,
    private readonly cookies: AuthCookieAdapter,
    @Inject(AUTH_LOGIN_METADATA_FACTORY)
    private readonly loginMetadata: LoginRequestMetadataFactory,
  ) {}

  @Post('login')
  @HttpCode(200)
  @PublicEndpoint()
  @CsrfTokenExempt()
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
  public async logout(
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const principal = this.requestContext.principal
    await this.logoutUseCase.execute(principal.userId, principal.sessionId)
    this.cookies.clear(response)
  }

  @Get('me')
  @SafeEndpoint()
  public me(): ReturnType<GetMeQuery['execute']> {
    return this.getMeQuery.execute(this.requestContext.principal)
  }

  @Get('csrf')
  @SafeEndpoint()
  public csrf(): ReturnType<GetCsrfTokenQuery['execute']> {
    return this.getCsrfTokenQuery.execute(
      this.requestContext.rawToken,
      Date.now(),
    )
  }

  @Put('password')
  public async changePassword(
    @Body() body: ChangePasswordRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthDurableMutationResult> {
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
  public async sessions(): Promise<{
    readonly sessions: readonly BrowserSessionSummary[]
  }> {
    return {
      sessions: await this.listSessionsQuery.execute(
        this.requestContext.principal,
      ),
    }
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  public async revokeSession(@Param() path: SessionPathDto): Promise<void> {
    await this.revokeSessionUseCase.execute(
      this.requestContext.principal,
      path.sessionId,
    )
  }

  @Delete('sessions')
  public async logoutAll(
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthDurableMutationResult> {
    const result = await this.logoutAllUseCase.execute(
      this.requestContext.principal.userId,
    )
    this.cookies.clear(response)
    return result
  }
}
