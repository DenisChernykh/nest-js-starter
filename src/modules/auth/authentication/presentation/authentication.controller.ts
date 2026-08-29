import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { ChangePasswordUseCase } from '../application/change-password.use-case'
import { LoginUseCase } from '../application/login.use-case'
import type { AuthenticatedPrincipal } from '../../public-contracts/authenticated-principal'
import { AuthMutationResponseDto } from '../../public-contracts/auth-mutation-response.dto'
import { CurrentPrincipal } from '../../public-contracts/current-principal.decorator'
import { CsrfTokenExempt } from '../../public-contracts/csrf-token-exempt.decorator'
import { EMAIL_VERIFICATION_REQUIRED_PROBLEM } from '../../presentation/auth-problem.definitions'
import { AuthCookieAdapter } from '../../sessions/presentation/auth-cookie.adapter'
import { ChangePasswordRequestDto, LoginRequestDto } from './authentication.dto'
import { LoginResponseDto } from './authentication-response.dto'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'

export const AUTH_LOGIN_METADATA_FACTORY = Symbol('auth:login-metadata-factory')

export interface LoginRequestMetadata {
  readonly deviceLabel: string
  readonly networkFingerprint: string
}

export type LoginRequestMetadataFactory = (input: {
  readonly ipAddress: string
  readonly userAgent: string | undefined
}) => LoginRequestMetadata

@Controller('auth')
@ApiTags('auth')
export class AuthenticationController {
  public constructor(
    @Inject(LoginUseCase)
    private readonly loginUseCase: LoginUseCase,
    @Inject(ChangePasswordUseCase)
    private readonly changePasswordUseCase: ChangePasswordUseCase,
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
    EMAIL_VERIFICATION_REQUIRED_PROBLEM,
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
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthMutationResponseDto> {
    const result = await this.changePasswordUseCase.execute({
      userId: principal.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    })
    this.cookies.clear(response)
    return result
  }
}
