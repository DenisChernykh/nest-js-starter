import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { AccountEmailWorkflowsService } from '../application/account-email-workflows.service'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
} from '../authorization/application/role-registry'
import { RequirePermission } from '../public-contracts/require-permission.decorator'
import {
  AccountMailDeliveryResponseDto,
  AdminAccountPathDto,
  CreateAccountInvitationRequestDto,
} from './admin-account.dto'
import { AuthRequestContext } from '../authorization/presentation/auth-request.context'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'

@Controller('admin/auth')
@ApiTags('admin auth')
export class AdminAccountEmailWorkflowsController {
  public constructor(
    private readonly emailWorkflows: AccountEmailWorkflowsService,
    private readonly requestContext: AuthRequestContext,
  ) {}

  @Post('account-invitations')
  @HttpCode(200)
  @RequirePermission(
    AUTH_ACCOUNTS_MANAGE_PERMISSION,
    AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  )
  @ApiOperation({
    operationId: 'adminAuthCreateAccountInvitation',
    summary: 'Create an account invitation',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiOkResponse({ type: AccountMailDeliveryResponseDto })
  @ApiBody({ type: CreateAccountInvitationRequestDto })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'CONFLICT',
    'MALFORMED_REQUEST',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'DEPENDENCY_UNAVAILABLE',
  )
  public invite(
    @Body() body: CreateAccountInvitationRequestDto,
  ): Promise<AccountMailDeliveryResponseDto> {
    return this.emailWorkflows.invite({
      actorId: this.requestContext.principal.userId,
      email: body.email,
      roleKeys: body.roleKeys,
      now: new Date(),
    })
  }

  @Post('accounts/:accountId/invitation/resend')
  @HttpCode(200)
  @RequirePermission(AUTH_ACCOUNTS_MANAGE_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthResendAccountInvitation',
    summary: 'Resend an account invitation',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: AccountMailDeliveryResponseDto })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'CONFLICT',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'DEPENDENCY_UNAVAILABLE',
  )
  public resendInvitation(
    @Param() path: AdminAccountPathDto,
  ): Promise<AccountMailDeliveryResponseDto> {
    return this.emailWorkflows.resendInvitation(
      this.requestContext.principal.userId,
      path.accountId,
      new Date(),
    )
  }

  @Post('accounts/:accountId/password-reset')
  @HttpCode(200)
  @RequirePermission(AUTH_ACCOUNTS_MANAGE_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthRequestPasswordReset',
    summary: 'Request an account password reset',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: AccountMailDeliveryResponseDto })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'CONFLICT',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'DEPENDENCY_UNAVAILABLE',
  )
  public requestPasswordReset(
    @Param() path: AdminAccountPathDto,
  ): Promise<AccountMailDeliveryResponseDto> {
    return this.emailWorkflows.resetPassword(
      this.requestContext.principal.userId,
      path.accountId,
      new Date(),
    )
  }
}
