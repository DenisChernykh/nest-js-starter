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

import { DatabaseUnavailableError } from '@/platform/database/database.contracts'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import { RequestValidationError } from '@/platform/http/errors/request-validation.error'

const registry = new HttpProblemRegistry([CORE_HTTP_PROBLEM_CONTRIBUTION])

describe('CORE_HTTP_PROBLEM_CONTRIBUTION', () => {
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
    const mapped = registry.map(error)

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
    const mapped = registry.map(new RequestValidationError(errors))

    expect(mapped.definition.code).toBe('VALIDATION_FAILED')
    expect(mapped.errors).toEqual(errors)
    expect(mapped.unexpected).toBe(false)
  })

  it('maps the finite body-parser payload discriminator without its message', () => {
    const error = Object.assign(new Error('raw body-parser secret'), {
      type: 'entity.too.large',
      status: 413,
    })

    const mapped = registry.map(error)

    expect(mapped.definition.code).toBe('PAYLOAD_TOO_LARGE')
    expect(mapped.unexpected).toBe(false)
    expect(JSON.stringify(mapped)).not.toContain('raw body-parser secret')
  })

  it('maps an explicit database outage without its internal message', () => {
    const mapped = registry.map(new DatabaseUnavailableError())

    expect(mapped.definition.code).toBe('DEPENDENCY_UNAVAILABLE')
    expect(mapped.definition.status).toBe(503)
    expect(mapped.unexpected).toBe(false)
    expect(JSON.stringify(mapped)).not.toContain('Database is unavailable')
  })

  it.each([
    new Error('password=top-secret postgresql://user:secret@db/internal'),
    Object.assign(new Error('raw auth detail'), {
      code: 'AUTHENTICATION_REQUIRED',
    }),
    new HttpException('token=top-secret', 418),
    new HttpException('secret', 500),
  ])('maps unknown failures to one constant internal problem', (error) => {
    const mapped = registry.map(error)

    expect(mapped.definition.code).toBe('INTERNAL_ERROR')
    expect(mapped.definition.status).toBe(500)
    expect(mapped.unexpected).toBe(true)
    expect(JSON.stringify(mapped)).not.toContain('top-secret')
  })
})
