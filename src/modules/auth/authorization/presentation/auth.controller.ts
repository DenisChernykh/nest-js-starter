import { Controller, Get, Inject } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { GetMeQuery } from '../application/get-me.query'
import type { AuthenticatedPrincipal } from '../../public-contracts/authenticated-principal'
import { CurrentPrincipal } from '../../public-contracts/current-principal.decorator'
import { CurrentUserResponseDto } from './auth-response.dto'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  public constructor(
    @Inject(GetMeQuery)
    private readonly getMeQuery: GetMeQuery,
  ) {}

  @Get('me')
  @ApiOperation({
    operationId: 'authGetMe',
    summary: 'Get the current authenticated identity',
    security: [{ sessionCookie: [] }],
  })
  @ApiOkResponse({
    type: CurrentUserResponseDto,
    description: 'Fresh current-user projection.',
  })
  @ApiProblemResponses(
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public me(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): CurrentUserResponseDto {
    return this.getMeQuery.execute(principal)
  }
}
