import { createParamDecorator } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'

import type { AuthenticatedPrincipal } from './authenticated-principal'
import { readAuthenticatedPrincipal } from './authenticated-request'

export const CurrentPrincipal: (
  ...dataOrPipes: unknown[]
) => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal =>
    readAuthenticatedPrincipal(context.switchToHttp().getRequest<object>()),
)
