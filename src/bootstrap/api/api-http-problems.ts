import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import { APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/approval-requests/composition/approval-request-http-problem.contribution'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import type { HttpProblemContribution } from '@/platform/http/errors/problem.contracts'

/** Ordered problem contributions installed by the API process root. */
export const API_HTTP_PROBLEM_CONTRIBUTIONS: readonly HttpProblemContribution[] =
  Object.freeze([
    CORE_HTTP_PROBLEM_CONTRIBUTION,
    AUTH_HTTP_PROBLEM_CONTRIBUTION,
    APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION,
  ])

/** Deterministic complete public problem catalog exposed by the API process. */
export const API_PROBLEM_CATALOG = new HttpProblemRegistry(
  API_HTTP_PROBLEM_CONTRIBUTIONS,
).definitions
