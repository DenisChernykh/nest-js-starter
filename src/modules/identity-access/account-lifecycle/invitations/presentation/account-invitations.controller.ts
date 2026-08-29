import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { AcceptAccountInvitationUseCase } from '../application/accept-account-invitation.use-case'
import { AcceptAccountInvitationRequestDto } from './invitation.dto'
import { CsrfTokenExempt } from '../../../public-contracts/csrf-token-exempt.decorator'
import { AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM } from '../../presentation/account-lifecycle-problem.definitions'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'

@Controller('auth')
@ApiTags('auth')
export class AccountInvitationsController {
  public constructor(
    private readonly acceptInvitation: AcceptAccountInvitationUseCase,
  ) {}

  @Post('account-invitations/accept')
  @HttpCode(204)
  @PublicEndpoint()
  @CsrfTokenExempt()
  @ApiOperation({
    operationId: 'authAcceptAccountInvitation',
    summary: 'Accept an account invitation without creating a session',
    security: [],
  })
  @ApiNoContentResponse({
    description: 'Invitation accepted without a browser session.',
  })
  @ApiBody({ type: AcceptAccountInvitationRequestDto })
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
    AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM,
  )
  public execute(
    @Body() body: AcceptAccountInvitationRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    return this.acceptInvitation.execute({
      token: body.token,
      password: body.password,
      ipAddress: request.ip ?? request.socket.remoteAddress ?? 'unknown',
      now: new Date(),
    })
  }
}
