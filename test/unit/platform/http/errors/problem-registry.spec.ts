import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  PROBLEM_CATALOG,
  getProblemDefinition,
} from '@/platform/http/errors/problem-registry'

describe('problem catalog', () => {
  it('publishes the complete immutable RFC 9457 catalogue', () => {
    expect(
      PROBLEM_CATALOG.map(({ slug, code, status, title, detail }) => [
        slug,
        code,
        status,
        title,
        detail,
      ]),
    ).toEqual([
      [
        'malformed-request',
        'MALFORMED_REQUEST',
        400,
        'Malformed request',
        'The request could not be parsed.',
      ],
      [
        'authentication-required',
        'AUTHENTICATION_REQUIRED',
        401,
        'Authentication required',
        'Valid authentication is required for this request.',
      ],
      [
        'authorization-denied',
        'AUTHORIZATION_DENIED',
        403,
        'Authorization denied',
        'The authenticated principal cannot perform this request.',
      ],
      [
        'not-found',
        'NOT_FOUND',
        404,
        'Resource not found',
        'The requested resource does not exist.',
      ],
      [
        'conflict',
        'CONFLICT',
        409,
        'Request conflict',
        'The request conflicts with the current resource state.',
      ],
      [
        'payload-too-large',
        'PAYLOAD_TOO_LARGE',
        413,
        'Payload too large',
        'The request payload exceeds the configured limit.',
      ],
      [
        'unsupported-media-type',
        'UNSUPPORTED_MEDIA_TYPE',
        415,
        'Unsupported media type',
        'The request content type is not supported.',
      ],
      [
        'validation-failed',
        'VALIDATION_FAILED',
        422,
        'Validation failed',
        'One or more request fields are invalid.',
      ],
      [
        'rate-limit-exceeded',
        'RATE_LIMIT_EXCEEDED',
        429,
        'Rate limit exceeded',
        'Too many requests were submitted in the allowed interval.',
      ],
      [
        'internal-error',
        'INTERNAL_ERROR',
        500,
        'Internal server error',
        'The server could not complete the request.',
      ],
      [
        'dependency-unavailable',
        'DEPENDENCY_UNAVAILABLE',
        503,
        'Dependency unavailable',
        'A required service is temporarily unavailable.',
      ],
    ])
    expect(Object.isFrozen(PROBLEM_CATALOG)).toBe(true)
    expect(getProblemDefinition('AUTHENTICATION_REQUIRED')).toBe(
      PROBLEM_CATALOG[1],
    )
    expect(() => getProblemDefinition('UNKNOWN' as never)).toThrow(
      'Unknown problem code: UNKNOWN',
    )
  })
  it('has exact parity with the committed human catalogue', () => {
    const markdown = readFileSync(
      join(process.cwd(), 'docs/api/problem-types.md'),
      'utf8',
    )
    const documented = markdown
      .split('\n')
      .filter((line) => line.startsWith('| https://'))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
    expect(documented).toEqual(
      PROBLEM_CATALOG.map((definition) => [
        definition.type,
        definition.code,
        String(definition.status),
        definition.title,
        definition.detail,
        definition.code === 'VALIDATION_FAILED' ? '`errors`' : '—',
      ]),
    )
  })
})
