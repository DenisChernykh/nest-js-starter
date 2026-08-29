import { defineProblemDefinition } from '@/platform/http/errors/problem-registry'

export const AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM = defineProblemDefinition({
  slug: 'auth-token-invalid-or-expired',
  code: 'AUTH_TOKEN_INVALID_OR_EXPIRED',
  status: 400,
  title: 'Authentication token invalid or expired',
  detail: 'The authentication token is invalid or expired.',
})
