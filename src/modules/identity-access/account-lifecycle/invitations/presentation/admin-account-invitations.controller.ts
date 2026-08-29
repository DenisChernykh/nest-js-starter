import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { CreateAccountInvitationUseCase } from '../application/create-account-invitation.use-case'
import { ResendAccountInvitationUseCase } from '../application/resend-account-invitation.use-case'
import { CreateAccountInvitationRequestDto } from './invitation.dto'
import { AccountMailDeliveryResponseDto } from '../../presentation/account-mail-delivery-response.dto'
import { AccountLifecyclePathDto } from '../../presentation/account-lifecycle-path.dto'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
} from '../../../authorization/application/role-registry'
import type { AuthenticatedPrincipal } from '../../../public-contracts/authenticated-principal'
import { CurrentPrincipal } from '../../../public-contracts/current-principal.decorator'
import { RequirePermission } from '../../../public-contracts/require-permission.decorator'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'

@Controller('admin/auth')
@ApiTags('admin auth')
export class AdminAccountInvitationsController {
  public constructor(
    private readonly createInvitation: CreateAccountInvitationUseCase,
    private readonly resendInvitation: ResendAccountInvitationUseCase,
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
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateAccountInvitationRequestDto,
  ): Promise<AccountMailDeliveryResponseDto> {
    return this.createInvitation.execute({
      actorId: principal.userId,
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
  public resend(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() path: AccountLifecyclePathDto,
  ): Promise<AccountMailDeliveryResponseDto> {
    return this.resendInvitation.execute({
      actorId: principal.userId,
      accountId: path.accountId,
      now: new Date(),
    })
  }
}
