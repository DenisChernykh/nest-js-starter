import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { AccountEmailWorkflowsService } from '../application/account-email-workflows.service'
import { AcceptAccountInvitationRequestDto } from './admin-account.dto'
import { CsrfTokenExempt } from './session-csrf.guard'
import { PublicEndpoint } from '@/platform/http/policy/public-endpoint.decorator'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM } from './auth-problem.definitions'

@Controller('auth')
@ApiTags('auth')
export class AccountEmailWorkflowsController {
  public constructor(
    private readonly workflows: AccountEmailWorkflowsService,
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
  public async accept(
    @Body() body: AcceptAccountInvitationRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.workflows.acceptInvitation({
      token: body.token,
      password: body.password,
      ipAddress: request.ip ?? request.socket.remoteAddress ?? 'unknown',
      now: new Date(),
    })
  }
}
