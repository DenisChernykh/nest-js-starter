import { HttpException } from '@nestjs/common'

import { DatabaseUnavailableError } from '@/platform/database/database.contracts'

import type {
  HttpProblemContribution,
  HttpProblemMapping,
} from './problem.contracts'
import { PROBLEM_CATALOG, type CoreProblemCode } from './problem-registry'
import { RequestValidationError } from './request-validation.error'

const httpProblemCodes: Readonly<Record<number, CoreProblemCode>> =
  Object.freeze({
    400: 'MALFORMED_REQUEST',
    401: 'AUTHENTICATION_REQUIRED',
    403: 'AUTHORIZATION_DENIED',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    422: 'VALIDATION_FAILED',
    429: 'RATE_LIMIT_EXCEEDED',
    503: 'DEPENDENCY_UNAVAILABLE',
  })

/** Core HTTP definitions and explicit framework/platform error projection. */
export const CORE_HTTP_PROBLEM_CONTRIBUTION: HttpProblemContribution =
  Object.freeze({
    definitions: PROBLEM_CATALOG,
    map: mapCoreHttpProblem,
  })

/**
 * Maps known framework and platform failures to safe public metadata.
 *
 * @param error - Unknown failure captured at the HTTP transport boundary.
 * @returns Public metadata for an explicit core error, otherwise `undefined`.
 */
function mapCoreHttpProblem(error: unknown): HttpProblemMapping | undefined {
  if (error instanceof RequestValidationError) {
    return {
      code: 'VALIDATION_FAILED',
      errors: error.errors,
    }
  }

  if (isPayloadTooLargeError(error)) {
    return { code: 'PAYLOAD_TOO_LARGE' }
  }

  if (error instanceof HttpException) {
    const problemCode = httpProblemCodes[error.getStatus()]
    if (problemCode !== undefined) return { code: problemCode }
  }

  if (error instanceof DatabaseUnavailableError) {
    return { code: 'DEPENDENCY_UNAVAILABLE' }
  }

  return undefined
}

function isPayloadTooLargeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'type' in error &&
    error.type === 'entity.too.large' &&
    'status' in error &&
    error.status === 413
  )
}
