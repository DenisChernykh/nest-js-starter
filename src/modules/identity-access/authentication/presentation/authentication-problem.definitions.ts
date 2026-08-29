import { defineProblemDefinition } from '@/platform/http/errors/problem-registry'

export const EMAIL_VERIFICATION_REQUIRED_PROBLEM = defineProblemDefinition({
  slug: 'email-verification-required',
  code: 'EMAIL_VERIFICATION_REQUIRED',
  status: 403,
  title: 'Email verification required',
  detail: 'Email verification is required before authentication can continue.',
})
