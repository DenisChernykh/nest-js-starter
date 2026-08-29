import { SetMetadata } from '@nestjs/common'

export const CSRF_TOKEN_EXEMPT_METADATA = Symbol('auth:csrf-token-exempt')

export const CsrfTokenExempt = (): MethodDecorator =>
  SetMetadata(CSRF_TOKEN_EXEMPT_METADATA, true)
