import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { RegisterUserUseCase } from '../application/register-user.use-case'
import { RegisterUserRequestDto } from './registration.dto'
import { PublicAuthResponseDelay } from '../../presentation/public-auth-response-delay'
import { CsrfTokenExempt } from '../../../public-contracts/csrf-token-exempt.decorator'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'

@Controller('auth')
@ApiTags('auth')
export class RegistrationController {
  public constructor(
    private readonly registerUser: RegisterUserUseCase,
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
  public async register(
    @Body() body: RegisterUserRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    const startedAt = performance.now()
    await this.registerUser.execute({
      email: body.email,
      password: body.password,
      ipAddress: request.ip ?? request.socket.remoteAddress ?? 'unknown',
      now: new Date(),
    })
    await this.responseDelay.wait(startedAt)
  }
}
