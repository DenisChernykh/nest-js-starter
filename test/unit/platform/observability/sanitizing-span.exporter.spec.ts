import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import { SanitizingSpanExporter } from '@/platform/observability/sanitizing-span.exporter'

describe('SanitizingSpanExporter', () => {
  it('removes sensitive attributes, events, links and status message before delegate', () => {
    const batches: ReadableSpan[][] = []
    const delegate = {
      export: jest.fn((spans: ReadableSpan[]) => batches.push(spans)),
      shutdown: jest.fn(() => Promise.resolve()),
    }
    const exporter = new SanitizingSpanExporter(delegate)
    const span = {
      name: 'GET /v1/items/:itemId',
      attributes: {
        'http.request.method': 'GET',
        'http.route': '/v1/items/:itemId',
        'http.response.status_code': 500,
        'url.full': 'https://user:secret@example.test/private?token=secret',
        'db.statement': 'SELECT password FROM users',
        'db.query.text': 'SELECT secret',
        'server.address': 'private.internal',
      },
      events: [
        {
          name: 'exception',
          attributes: { 'exception.message': 'password=secret' },
        },
      ],
      links: [{ attributes: { token: 'secret' } }],
      status: { code: 2, message: 'password=secret' },
      spanContext: () => ({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      }),
    } as unknown as ReadableSpan
    const callback = jest.fn()

    exporter.export([span], callback)

    expect(delegate.export).toHaveBeenCalledTimes(1)
    const exported = batches[0]?.[0]
    expect(exported?.attributes).toEqual({
      'http.request.method': 'GET',
      'http.route': '/v1/items/:itemId',
      'http.response.status_code': 500,
    })
    expect(exported?.events).toEqual([])
    expect(exported?.links).toEqual([])
    expect(exported?.status).toEqual({ code: 2 })
    expect(exported?.spanContext()).toEqual(span.spanContext())
    expect(JSON.stringify(exported)).not.toContain('secret')
  })

  it('keeps only command-only Redis statements and removes their arguments', () => {
    const batches: ReadableSpan[][] = []
    const delegate = {
      export: jest.fn((spans: ReadableSpan[]) => batches.push(spans)),
      shutdown: jest.fn(() => Promise.resolve()),
    }
    const exporter = new SanitizingSpanExporter(delegate)
    const redis = {
      attributes: {
        'db.system': 'redis',
        'db.statement': 'GET',
        'db.query.text': 'GET',
      },
      events: [],
      links: [],
      status: { code: 0 },
    } as unknown as ReadableSpan
    const unsafe = {
      attributes: {
        'db.system': 'redis',
        'db.statement': 'GET private:key',
        'db.query.text': 'SELECT secret FROM users',
      },
      events: [],
      links: [],
      status: { code: 0 },
    } as unknown as ReadableSpan

    exporter.export([redis, unsafe], jest.fn())

    expect(batches[0]?.[0]?.attributes).toEqual({
      'db.system': 'redis',
      'db.statement': 'GET',
      'db.query.text': 'GET',
    })
    expect(batches[0]?.[1]?.attributes).toEqual({ 'db.system': 'redis' })
  })
})
