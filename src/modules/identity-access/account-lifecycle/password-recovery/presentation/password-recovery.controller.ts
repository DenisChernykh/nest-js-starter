import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { ConfirmPasswordResetUseCase } from '../application/confirm-password-reset.use-case'
import { RequestPasswordResetUseCase } from '../application/request-password-reset.use-case'
import { ConfirmPasswordResetRequestDto } from './password-recovery.dto'
import { PublicAuthResponseDelay } from '../../presentation/public-auth-response-delay'
import { SelfServiceEmailRequestDto } from '../../presentation/self-service-email-request.dto'
import { CsrfTokenExempt } from '../../../public-contracts/csrf-token-exempt.decorator'
import { AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM } from '../../presentation/account-lifecycle-problem.definitions'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'

@Controller('auth')
@ApiTags('auth')
export class PasswordRecoveryController {
  public constructor(
    private readonly requestPasswordReset: RequestPasswordResetUseCase,
    private readonly confirmPasswordReset: ConfirmPasswordResetUseCase,
    private readonly responseDelay: PublicAuthResponseDelay,
  ) {}

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
  @ApiProblemResponses(
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
    const startedAt = performance.now()
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
  @ApiProblemResponses(
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
