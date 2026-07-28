import type { ArgumentsHost } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import type { AbstractHttpAdapter } from '@nestjs/core'

import { AuthCsrfRejectedError } from '@/modules/auth/application/auth-errors'
import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import { RequestContext } from '@/platform/http/context/request-context'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import { ProblemExceptionFilter } from '@/platform/http/errors/problem-exception.filter'

describe('ProblemExceptionFilter', () => {
  it('writes one exact problem response and no error log for expected failures', () => {
    const fixture = createFixture()
    const error = new AuthCsrfRejectedError()

    fixture.requestContext.run(fixture.requestId, () =>
      fixture.filter.catch(error, fixture.host),
    )

    expect(fixture.adapter.setHeader).toHaveBeenCalledWith(
      fixture.response,
      'Content-Type',
      'application/problem+json',
    )
    expect(fixture.adapter.reply).toHaveBeenCalledTimes(1)
    expect(fixture.adapter.reply).toHaveBeenCalledWith(
      fixture.response,
      {
        type: 'https://nest-js-starter.invalid/problems/authorization-denied',
        title: 'Authorization denied',
        status: 403,
        detail: 'The authenticated principal cannot perform this request.',
        instance: `urn:request:${fixture.requestId}`,
        code: 'AUTHORIZATION_DENIED',
        requestId: fixture.requestId,
      },
      403,
    )
    expect(fixture.logger.write).not.toHaveBeenCalled()
  })

  it('logs one safe sink-owned error record for an unknown 500', () => {
    const fixture = createFixture()
    const error = new Error('password=top-secret')

    fixture.requestContext.run(fixture.requestId, () =>
      fixture.filter.catch(error, fixture.host),
    )

    expect(fixture.logger.write).toHaveBeenCalledTimes(1)
    expect(fixture.logger.write).toHaveBeenCalledWith({
      level: 'error',
      event: 'http_unhandled_error',
      module: 'ProblemExceptionFilter',
      error,
    })
    expect(fixture.adapter.reply).toHaveBeenCalledWith(
      fixture.response,
      expect.objectContaining({
        status: 500,
        code: 'INTERNAL_ERROR',
        detail: 'The server could not complete the request.',
        requestId: fixture.requestId,
      }),
      500,
    )
  })

  it('does not write or log after headers have already been sent', () => {
    const fixture = createFixture(true)

    fixture.filter.catch(new Error('late failure'), fixture.host)

    expect(fixture.adapter.setHeader).not.toHaveBeenCalled()
    expect(fixture.adapter.reply).not.toHaveBeenCalled()
    expect(fixture.logger.write).not.toHaveBeenCalled()
  })
})

function createFixture(headersSent = false): {
  readonly filter: ProblemExceptionFilter
  readonly requestContext: RequestContext
  readonly adapter: {
    readonly isHeadersSent: jest.Mock
    readonly setHeader: jest.Mock
    readonly reply: jest.Mock
  }
  readonly logger: { readonly write: jest.Mock }
  readonly host: ArgumentsHost
  readonly response: object
  readonly requestId: string
} {
  const response = {}
  const adapter = {
    isHeadersSent: jest.fn(() => headersSent),
    setHeader: jest.fn(),
    reply: jest.fn(),
  }
  const adapterHost = new HttpAdapterHost()
  adapterHost.httpAdapter = adapter as unknown as AbstractHttpAdapter
  const requestContext = new RequestContext()
  const logger = { write: jest.fn() }
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as ArgumentsHost
  return {
    filter: new ProblemExceptionFilter(
      adapterHost,
      requestContext,
      logger,
      new HttpProblemRegistry([
        CORE_HTTP_PROBLEM_CONTRIBUTION,
        AUTH_HTTP_PROBLEM_CONTRIBUTION,
      ]),
    ),
    requestContext,
    adapter,
    logger,
    host,
    response,
    requestId: '019219c3-dc52-7cc1-9e70-f293ca14c198',
  }
}
