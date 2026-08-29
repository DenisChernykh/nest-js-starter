import { Controller, HttpCode, Param, Post } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { RequestAdministratorPasswordResetUseCase } from '../application/request-administrator-password-reset.use-case'
import { AccountLifecyclePathDto } from '../../presentation/account-lifecycle-path.dto'
import { AccountMailDeliveryResponseDto } from '../../presentation/account-mail-delivery-response.dto'
import { AUTH_ACCOUNTS_MANAGE_PERMISSION } from '../../../authorization/application/role-registry'
import type { AuthenticatedPrincipal } from '../../../public-contracts/authenticated-principal'
import { CurrentPrincipal } from '../../../public-contracts/current-principal.decorator'
import { RequirePermission } from '../../../public-contracts/require-permission.decorator'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'

@Controller('admin/auth')
@ApiTags('admin auth')
export class AdminPasswordRecoveryController {
  public constructor(
    private readonly requestAdministratorPasswordReset: RequestAdministratorPasswordResetUseCase,
  ) {}

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
  public execute(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() path: AccountLifecyclePathDto,
  ): Promise<AccountMailDeliveryResponseDto> {
    return this.requestAdministratorPasswordReset.execute({
      actorId: principal.userId,
      accountId: path.accountId,
      now: new Date(),
    })
  }
}
