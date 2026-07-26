import { EventEmitter } from 'node:events'

import type { NextFunction, Request, Response } from 'express'

import { createHttpAccessLogMiddleware } from '@/platform/logging/http-access-log.middleware'

describe('HTTP access log finalizer', () => {
  it.each([
    ['finish', 204, true, 'info'],
    ['finish', 422, true, 'info'],
    ['finish', 500, true, 'error'],
    ['close', 200, false, 'info'],
  ] as const)(
    'emits one final record for %s status %s',
    (event, statusCode, writableFinished, level) => {
      const fixture = createFixture()
      fixture.response.statusCode = statusCode
      fixture.response.writableFinished = writableFinished

      fixture.middleware(
        fixture.request,
        fixture.response as unknown as Response,
        jest.fn() as NextFunction,
      )
      fixture.response.emit(event)
      fixture.response.emit(event === 'finish' ? 'close' : 'finish')

      expect(fixture.logger.write.mock.calls).toEqual([
        [
          {
            level,
            event: 'http_request_completed',
            module: 'HttpAccess',
            correlation: {
              requestId: 'request-a',
              traceId: '0af7651916cd43dd8448eb211c80319c',
              spanId: 'b7ad6b7169203331',
            },
            attributes: {
              route: '/v1/items/:itemId',
              method: 'GET',
              status: event === 'close' ? 499 : statusCode,
              durationMs: 15,
            },
          },
        ],
      ])
    },
  )

  it('attaches finish and close listeners before downstream middleware', () => {
    const fixture = createFixture()
    const next = jest.fn(() => {
      expect(fixture.response.listenerCount('finish')).toBe(1)
      expect(fixture.response.listenerCount('close')).toBe(1)
    })

    fixture.middleware(
      fixture.request,
      fixture.response as unknown as Response,
      next as NextFunction,
    )

    expect(next).toHaveBeenCalledTimes(1)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects invalid duration %s before partial emission',
    (end) => {
      const fixture = createFixture([10, end])
      fixture.middleware(
        fixture.request,
        fixture.response as unknown as Response,
        jest.fn() as NextFunction,
      )

      expect(() => fixture.response.emit('finish')).toThrow(
        'Invalid HTTP access duration',
      )
      expect(fixture.logger.write).not.toHaveBeenCalled()
    },
  )
})

function createFixture(clock = [10, 25]): {
  readonly middleware: ReturnType<typeof createHttpAccessLogMiddleware>
  readonly request: Request
  readonly response: EventEmitter & {
    statusCode: number
    writableFinished: boolean
  }
  readonly logger: { readonly write: jest.Mock }
} {
  const logger = { write: jest.fn() }
  const correlation = {
    getFields: jest.fn(() => ({
      requestId: 'request-a',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
    })),
  }
  const values = [...clock]
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: true,
  })
  return {
    middleware: createHttpAccessLogMiddleware({
      logger,
      correlation,
      now: () => values.shift() ?? 25,
    }),
    request: {
      method: 'GET',
      baseUrl: '/v1',
      route: { path: '/items/:itemId' },
    } as unknown as Request,
    response,
    logger,
  }
}
