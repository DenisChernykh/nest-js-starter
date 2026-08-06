import {
  ApiAcceptedResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import type { Request } from 'express'

import { ConfirmEmailVerificationUseCase } from '../application/confirm-email-verification.use-case'
import { ConfirmPasswordResetUseCase } from '../application/confirm-password-reset.use-case'
import { RegisterUserUseCase } from '../application/register-user.use-case'
import { RequestPasswordResetUseCase } from '../application/request-password-reset.use-case'
import { ResendEmailVerificationUseCase } from '../application/resend-email-verification.use-case'
import { CsrfTokenExempt } from './session-csrf.guard'
import {
  ConfirmEmailVerificationRequestDto,
  ConfirmPasswordResetRequestDto,
  RegisterUserRequestDto,
  SelfServiceEmailRequestDto,
} from './self-service-auth.dto'
import { PublicAuthResponseDelay } from './public-auth-response-delay'
import { AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM } from './auth-problem.definitions'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'
import { ApiProblemResponses as DocumentedProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'

@Controller('auth')
@ApiTags('auth')
export class SelfServiceAuthController {
  public constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly resendVerification: ResendEmailVerificationUseCase,
    private readonly confirmVerification: ConfirmEmailVerificationUseCase,
    private readonly requestPasswordReset: RequestPasswordResetUseCase,
    private readonly confirmPasswordReset: ConfirmPasswordResetUseCase,
    private readonly responseDelay: PublicAuthResponseDelay,
  ) {}

  @Post('register')
  @HttpCode(202)
  @PublicEndpoint()
  @CsrfTokenExempt()
  @ApiOperation({
    operationId: 'authRegister',
    summary: 'Register a password account',
    security: [],
  })
  @ApiBody({ type: RegisterUserRequestDto })
  @ApiAcceptedResponse({
    description: 'Accepted without revealing account eligibility.',
  })
  @DocumentedProblemResponses(
    'MALFORMED_REQUEST',
    'NOT_FOUND',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'RATE_LIMIT_EXCEEDED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
    'AUTHORIZATION_DENIED',
  )
  public async register(
    @Body() body: RegisterUserRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    const startedAt = Date.now()
    await this.registerUser.execute({
      email: body.email,
      password: body.password,
      ipAddress: request.ip ?? request.socket.remoteAddress ?? 'unknown',
      now: new Date(),
    })
    await this.responseDelay.wait(startedAt)
  }

  @Post('email-verification/resend')
  @HttpCode(202)
  @PublicEndpoint()
  @CsrfTokenExempt()
  @ApiOperation({
    operationId: 'authResendEmailVerification',
    summary: 'Resend email verification',
    security: [],
  })
  @ApiBody({ type: SelfServiceEmailRequestDto })
  @ApiAcceptedResponse({
    description: 'Accepted without revealing account eligibility.',
  })
  @DocumentedProblemResponses(
    'MALFORMED_REQUEST',
    'NOT_FOUND',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'RATE_LIMIT_EXCEEDED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
    'AUTHORIZATION_DENIED',
  )
  public async resend(
    @Body() body: SelfServiceEmailRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    const startedAt = Date.now()
    await this.resendVerification.execute({
      email: body.email,
      ipAddress: request.ip ?? request.socket.remoteAddress ?? 'unknown',
      now: new Date(),
    })
    await this.responseDelay.wait(startedAt)
  }

  @Post('email-verification/confirm')
  @HttpCode(204)
  @PublicEndpoint()
  @CsrfTokenExempt()
  @ApiOperation({
    operationId: 'authConfirmEmailVerification',
    summary: 'Confirm email verification',
    security: [],
  })
  @ApiBody({ type: ConfirmEmailVerificationRequestDto })
  @ApiNoContentResponse({ description: 'Email verification was confirmed.' })
  @DocumentedProblemResponses(
    'MALFORMED_REQUEST',
    'NOT_FOUND',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
    'AUTHORIZATION_DENIED',
    AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM,
  )
  public confirmEmail(
    @Body() body: ConfirmEmailVerificationRequestDto,
  ): Promise<void> {
    return this.confirmVerification.execute({
      token: body.token,
      now: new Date(),
    })
  }

  @Post('password-reset/request')
  @HttpCode(202)
  @PublicEndpoint()
  @CsrfTokenExempt()
  @ApiOperation({
    operationId: 'authRequestPasswordReset',
    summary: 'Request a password reset',
    security: [],
  })
  @ApiBody({ type: SelfServiceEmailRequestDto })
  @ApiAcceptedResponse({
    description: 'Accepted without revealing account eligibility.',
  })
  @DocumentedProblemResponses(
    'MALFORMED_REQUEST',
    'NOT_FOUND',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'RATE_LIMIT_EXCEEDED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
    'AUTHORIZATION_DENIED',
  )
  public async requestReset(
    @Body() body: SelfServiceEmailRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    const startedAt = Date.now()
    await this.requestPasswordReset.execute({
      email: body.email,
      ipAddress: request.ip ?? request.socket.remoteAddress ?? 'unknown',
      now: new Date(),
    })
    await this.responseDelay.wait(startedAt)
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  @PublicEndpoint()
  @CsrfTokenExempt()
  @ApiOperation({
    operationId: 'authConfirmPasswordReset',
    summary: 'Confirm a password reset',
    security: [],
  })
  @ApiBody({ type: ConfirmPasswordResetRequestDto })
  @ApiNoContentResponse({ description: 'Password reset was confirmed.' })
  @DocumentedProblemResponses(
    'MALFORMED_REQUEST',
    'NOT_FOUND',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
    'AUTHORIZATION_DENIED',
    AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM,
  )
  public confirmReset(
    @Body() body: ConfirmPasswordResetRequestDto,
  ): Promise<void> {
    return this.confirmPasswordReset
      .execute({
        token: body.token,
        newPassword: body.newPassword,
        now: new Date(),
      })
      .then(() => undefined)
  }
}
