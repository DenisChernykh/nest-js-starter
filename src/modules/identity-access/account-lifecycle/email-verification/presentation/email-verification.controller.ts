import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { ConfirmEmailVerificationUseCase } from '../application/confirm-email-verification.use-case'
import { ResendEmailVerificationUseCase } from '../application/resend-email-verification.use-case'
import { ConfirmEmailVerificationRequestDto } from './email-verification.dto'
import { PublicAuthResponseDelay } from '../../presentation/public-auth-response-delay'
import { SelfServiceEmailRequestDto } from '../../presentation/self-service-email-request.dto'
import { CsrfTokenExempt } from '../../../public-contracts/csrf-token-exempt.decorator'
import { AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM } from '../../presentation/account-lifecycle-problem.definitions'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'

@Controller('auth')
@ApiTags('auth')
export class EmailVerificationController {
  public constructor(
    private readonly resendVerification: ResendEmailVerificationUseCase,
    private readonly confirmVerification: ConfirmEmailVerificationUseCase,
    private readonly responseDelay: PublicAuthResponseDelay,
  ) {}

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
  public async resend(
    @Body() body: SelfServiceEmailRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    const startedAt = performance.now()
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
  public confirmEmail(
    @Body() body: ConfirmEmailVerificationRequestDto,
  ): Promise<void> {
    return this.confirmVerification.execute({
      token: body.token,
      now: new Date(),
    })
  }
}
