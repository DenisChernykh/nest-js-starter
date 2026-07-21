import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  PROBLEM_REGISTRY,
  ProblemRegistry,
} from '@/platform/http/errors/problem-registry'
import type { ProblemDefinition } from '@/platform/http/errors/problem.contracts'

const expectedDefinitions = [
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
] as const

describe('ProblemRegistry', () => {
  it('publishes the complete stable absolute RFC 9457 catalogue', () => {
    expect(
      PROBLEM_REGISTRY.definitions.map((definition) => [
        definition.slug,
        definition.code,
        definition.status,
        definition.title,
        definition.detail,
      ]),
    ).toEqual(expectedDefinitions)
    for (const definition of PROBLEM_REGISTRY.definitions) {
      expect(definition.type).toBe(
        `https://nest-js-starter.invalid/problems/${definition.slug}`,
      )
      expect(new URL(definition.type).protocol).toBe('https:')
      expect(Object.isFrozen(definition)).toBe(true)
      expect(PROBLEM_REGISTRY.get(definition.code)).toBe(definition)
    }
    expect(Object.isFrozen(PROBLEM_REGISTRY.definitions)).toBe(true)
  })

  it.each([
    [
      'duplicate code',
      [definition('one', 'DUPLICATE'), definition('two', 'DUPLICATE')],
    ],
    [
      'duplicate slug',
      [definition('duplicate', 'ONE'), definition('duplicate', 'TWO')],
    ],
    ['invalid slug', [definition('../escape', 'INVALID_SLUG')]],
    ['invalid code', [definition('invalid-code', 'invalid')]],
    ['invalid status', [definition('invalid-status', 'INVALID_STATUS', 200)]],
  ])('rejects %s at construction', (_name, definitions) => {
    expect(() => new ProblemRegistry(definitions)).toThrow(
      'Invalid problem registry',
    )
  })

  it('rejects an unknown code instead of inventing a definition', () => {
    expect(() => PROBLEM_REGISTRY.get('UNKNOWN')).toThrow(
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
    const expected = PROBLEM_REGISTRY.definitions.map((definition) => [
      definition.type,
      definition.code,
      String(definition.status),
      definition.title,
      definition.detail,
      definition.code === 'VALIDATION_FAILED' ? '`errors`' : '—',
    ])

    expect(documented).toEqual(expected)
  })
})

function definition(
  slug: string,
  code: string,
  status = 400,
): ProblemDefinition {
  return {
    slug,
    code,
    status,
    title: 'Test problem',
    detail: 'A stable test detail.',
  }
}
