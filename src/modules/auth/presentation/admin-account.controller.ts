import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Put,
  Query,
  Res,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBody,
  ApiHeader,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'

import {
  AccountAdministrationService,
  AccountNotFoundError,
} from '../application/account-administration.service'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_READ_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
} from '../application/role-registry'
import { RequirePermission } from '../public-contracts/require-permission.decorator'
import { AuthRequestContext } from './auth-request.context'
import {
  AdminAccountListResponseDto,
  AdminAccountPathDto,
  AdminAccountResponseDto,
  AdminRoleCatalogResponseDto,
  ListAdminAccountsQueryDto,
  ReplaceAccountRolesRequestDto,
  UpdateAccountStatusRequestDto,
} from './admin-account.dto'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import {
  AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
  AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
  AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
} from './auth-problem.definitions'
import { formatAccountEtag, parseAccountEtag } from './account-etag.codec'

@Controller('admin/auth')
@ApiTags('admin auth')
export class AdminAccountController {
  public constructor(
    private readonly accounts: AccountAdministrationService,
    private readonly requestContext: AuthRequestContext,
  ) {}

  @Get('accounts')
  @RequirePermission(AUTH_ACCOUNTS_READ_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthListAccounts',
    summary: 'List accounts',
    security: [{ sessionCookie: [] }],
  })
  @ApiOkResponse({ type: AdminAccountListResponseDto })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['invited', 'active', 'disabled', 'retired'],
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
  )
  public list(
    @Query() query: ListAdminAccountsQueryDto,
  ): Promise<AdminAccountListResponseDto> {
    return this.accounts.listAccounts(query)
  }

  @Get('accounts/:accountId')
  @RequirePermission(AUTH_ACCOUNTS_READ_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthGetAccount',
    summary: 'Get one account',
    security: [{ sessionCookie: [] }],
  })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    type: AdminAccountResponseDto,
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'VALIDATION_FAILED',
  )
  public async get(
    @Param() path: AdminAccountPathDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminAccountResponseDto> {
    const account = await this.accounts.getAccount(path.accountId)
    if (account === undefined) return failAccountNotFound()
    response.setHeader('ETag', formatAccountEtag(account))
    return account
  }

  @Put('accounts/:accountId/status')
  @RequirePermission(AUTH_ACCOUNTS_MANAGE_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthUpdateAccountStatus',
    summary: 'Update account status',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    schema: { type: 'string', pattern: '^"account-[0-9a-f-]+-[0-9]+"$' },
  })
  @ApiBody({ type: UpdateAccountStatusRequestDto })
  @ApiOkResponse({
    type: AdminAccountResponseDto,
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'CONFLICT',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
    AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
    AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
  )
  public async updateStatus(
    @Param() path: AdminAccountPathDto,
    @Body() body: UpdateAccountStatusRequestDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminAccountResponseDto> {
    const account = await this.accounts.changeStatus({
      actorId: this.requestContext.principal.userId,
      accountId: path.accountId,
      status: body.status,
      expectedRevision: parseAccountEtag(path.accountId, ifMatch),
    })
    if (account === undefined) return failAccountNotFound()
    response.setHeader('ETag', formatAccountEtag(account))
    return account
  }

  @Put('accounts/:accountId/roles')
  @RequirePermission(AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthReplaceAccountRoles',
    summary: 'Replace account roles',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    schema: { type: 'string', pattern: '^"account-[0-9a-f-]+-[0-9]+"$' },
  })
  @ApiBody({ type: ReplaceAccountRolesRequestDto })
  @ApiOkResponse({
    type: AdminAccountResponseDto,
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'CONFLICT',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
    AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
    AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
  )
  public async replaceRoles(
    @Param() path: AdminAccountPathDto,
    @Body() body: ReplaceAccountRolesRequestDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminAccountResponseDto> {
    const account = await this.accounts.replaceRoles({
      actorId: this.requestContext.principal.userId,
      accountId: path.accountId,
      roleKeys: body.roleKeys,
      expectedRevision: parseAccountEtag(path.accountId, ifMatch),
    })
    if (account === undefined) return failAccountNotFound()
    response.setHeader('ETag', formatAccountEtag(account))
    return account
  }

  @Delete('accounts/:accountId')
  @HttpCode(204)
  @RequirePermission(AUTH_ACCOUNTS_MANAGE_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthRetireAccount',
    summary: 'Retire an account',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    schema: { type: 'string', pattern: '^"account-[0-9a-f-]+-[0-9]+"$' },
  })
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
    AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
    AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
  )
  public async retire(
    @Param() path: AdminAccountPathDto,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<void> {
    const retired = await this.accounts.retireAccount({
      actorId: this.requestContext.principal.userId,
      accountId: path.accountId,
      expectedRevision: parseAccountEtag(path.accountId, ifMatch),
    })
    if (!retired) failAccountNotFound()
  }

  @Delete('accounts/:accountId/sessions')
  @HttpCode(204)
  @RequirePermission(AUTH_ACCOUNTS_MANAGE_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthLogoutAll',
    summary: 'Revoke every account session',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({ name: 'accountId', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
  )
  public async logoutAll(@Param() path: AdminAccountPathDto): Promise<void> {
    const revoked = await this.accounts.revokeAllSessions({
      actorId: this.requestContext.principal.userId,
      accountId: path.accountId,
    })
    if (!revoked) failAccountNotFound()
  }

  @Get('roles')
  @RequirePermission(AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION)
  @ApiOperation({
    operationId: 'adminAuthListRoles',
    summary: 'List code-owned roles',
    security: [{ sessionCookie: [] }],
  })
  @ApiOkResponse({ type: AdminRoleCatalogResponseDto })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'NOT_FOUND',
  )
  public roles(): AdminRoleCatalogResponseDto {
    return { roles: this.accounts.listRoles() }
  }
}

function failAccountNotFound(): never {
  throw new AccountNotFoundError()
}
