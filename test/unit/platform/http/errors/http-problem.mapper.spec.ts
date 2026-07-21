import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'

import type { AuthFailureCode } from '@/modules/auth/application/auth-errors'
import {
  AUTH_FAILURE_PROBLEM_CODES,
  mapHttpProblem,
} from '@/platform/http/errors/http-problem.mapper'
import type { ProblemCode } from '@/platform/http/errors/problem-registry'
import { RequestValidationError } from '@/platform/http/errors/request-validation.error'

const completeAuthMapping: Readonly<Record<AuthFailureCode, ProblemCode>> =
  AUTH_FAILURE_PROBLEM_CODES
void completeAuthMapping

describe('mapHttpProblem', () => {
  it.each([
    [new BadRequestException('raw secret'), 'MALFORMED_REQUEST', 400],
    [new UnauthorizedException('raw secret'), 'AUTHENTICATION_REQUIRED', 401],
    [new ForbiddenException('raw secret'), 'AUTHORIZATION_DENIED', 403],
    [new NotFoundException('raw secret'), 'NOT_FOUND', 404],
    [new ConflictException('raw secret'), 'CONFLICT', 409],
    [new PayloadTooLargeException('raw secret'), 'PAYLOAD_TOO_LARGE', 413],
    [
      new UnsupportedMediaTypeException('raw secret'),
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    ],
    [new HttpException('raw secret', 429), 'RATE_LIMIT_EXCEEDED', 429],
    [
      new ServiceUnavailableException('raw secret'),
      'DEPENDENCY_UNAVAILABLE',
      503,
    ],
  ])('maps expected HTTP failure to %s', (error, code, status) => {
    const mapped = mapHttpProblem(error)

    expect(mapped.definition.code).toBe(code)
    expect(mapped.definition.status).toBe(status)
    expect(mapped.unexpected).toBe(false)
    expect(JSON.stringify(mapped)).not.toContain('raw secret')
  })

  it('preserves only mapped validation field issues', () => {
    const errors = Object.freeze([
      Object.freeze({
        pointer: '/email',
        code: 'invalid_format',
        detail: 'Field has an invalid format.',
      }),
    ])
    const mapped = mapHttpProblem(new RequestValidationError(errors))

    expect(mapped.definition.code).toBe('VALIDATION_FAILED')
    expect(mapped.errors).toEqual(errors)
    expect(mapped.unexpected).toBe(false)
  })

  it('maps the finite body-parser payload discriminator without its message', () => {
    const error = Object.assign(new Error('raw body-parser secret'), {
      type: 'entity.too.large',
      status: 413,
    })

    const mapped = mapHttpProblem(error)

    expect(mapped.definition.code).toBe('PAYLOAD_TOO_LARGE')
    expect(mapped.unexpected).toBe(false)
    expect(JSON.stringify(mapped)).not.toContain('raw body-parser secret')
  })

  it.each([
    ['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_REQUIRED', 401],
    ['AUTHENTICATION_FAILED', 'AUTHENTICATION_REQUIRED', 401],
    ['AUTHORIZATION_DENIED', 'AUTHORIZATION_DENIED', 403],
    ['AUTH_CSRF_REJECTED', 'AUTHORIZATION_DENIED', 403],
    ['AUTH_SESSION_NOT_FOUND', 'NOT_FOUND', 404],
    ['AUTH_STATE_CONFLICT', 'CONFLICT', 409],
    ['AUTH_RATE_LIMITED', 'RATE_LIMIT_EXCEEDED', 429],
    ['AUTH_DEPENDENCY_UNAVAILABLE', 'DEPENDENCY_UNAVAILABLE', 503],
  ] as const)(
    'exhaustively maps auth code %s',
    (authCode, problemCode, status) => {
      const error = Object.assign(new Error('raw auth detail'), {
        code: authCode,
        ...(authCode === 'AUTH_RATE_LIMITED' ? { retryAfterMs: 1_001 } : {}),
      })
      const mapped = mapHttpProblem(error)

      expect(mapped.definition.code).toBe(problemCode)
      expect(mapped.definition.status).toBe(status)
      expect(mapped.retryAfterSeconds).toBe(
        authCode === 'AUTH_RATE_LIMITED' ? 2 : undefined,
      )
      expect(mapped.unexpected).toBe(false)
    },
  )

  it.each([
    new Error('password=top-secret postgresql://user:secret@db/internal'),
    new HttpException('token=top-secret', 418),
    new HttpException('secret', 500),
  ])('maps unknown failures to one constant internal problem', (error) => {
    const mapped = mapHttpProblem(error)

    expect(mapped.definition.code).toBe('INTERNAL_ERROR')
    expect(mapped.definition.status).toBe(500)
    expect(mapped.unexpected).toBe(true)
    expect(JSON.stringify(mapped)).not.toContain('top-secret')
  })
})
