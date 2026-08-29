import { defineProblemDefinition } from '@/platform/http/errors/problem-registry'

export const AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM = defineProblemDefinition({
  slug: 'auth-account-etag-malformed',
  code: 'AUTH_ACCOUNT_ETAG_MALFORMED',
  status: 400,
  title: 'Malformed account ETag',
  detail: 'The If-Match header is not a valid account ETag.',
})

export const AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM =
  defineProblemDefinition({
    slug: 'auth-account-precondition-required',
    code: 'AUTH_ACCOUNT_PRECONDITION_REQUIRED',
    status: 428,
    title: 'Account ETag required',
    detail: 'A current account ETag is required for this mutation.',
  })

export const AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM = defineProblemDefinition(
  {
    slug: 'auth-account-precondition-failed',
    code: 'AUTH_ACCOUNT_PRECONDITION_FAILED',
    status: 412,
    title: 'Account ETag no longer current',
    detail: 'The account has changed since the supplied ETag was issued.',
  },
)
