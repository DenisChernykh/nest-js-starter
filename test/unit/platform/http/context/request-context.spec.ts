import { trace, TraceFlags } from '@opentelemetry/api'

import { CorrelationFieldsProvider } from '@/platform/http/context/correlation-fields.provider'
import { RequestContext } from '@/platform/http/context/request-context'

describe('RequestContext', () => {
  it('exposes only request ID and its problem instance inside the callback', () => {
    const requestContext = new RequestContext()

    expect(requestContext.getRequestId()).toBeUndefined()
    expect(requestContext.getProblemInstance()).toBeUndefined()
    requestContext.run('request-a', () => {
      expect(requestContext.getRequestId()).toBe('request-a')
      expect(requestContext.getProblemInstance()).toBe('urn:request:request-a')
    })
    expect(requestContext.getRequestId()).toBeUndefined()
  })

  it('isolates concurrent asynchronous request chains', async () => {
    const requestContext = new RequestContext()
    let releaseA: (() => void) | undefined
    const holdA = new Promise<void>((resolve) => {
      releaseA = resolve
    })

    const first = requestContext.run('request-a', async () => {
      await holdA
      return requestContext.getRequestId()
    })
    const second = requestContext.run('request-b', async () => {
      await Promise.resolve()
      releaseA?.()
      return requestContext.getRequestId()
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      'request-a',
      'request-b',
    ])
  })
})

describe('CorrelationFieldsProvider', () => {
  it('returns no invented identifiers outside active contexts', () => {
    const provider = new CorrelationFieldsProvider(new RequestContext())
    expect(provider.getFields()).toEqual({})
  })

  it('reads request and valid active span identifiers at lookup time', () => {
    const requestContext = new RequestContext()
    const provider = new CorrelationFieldsProvider(requestContext)
    const span = trace.wrapSpanContext({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: TraceFlags.SAMPLED,
    })
    const activeSpan = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span)

    const fields = requestContext.run('request-a', () => provider.getFields())
    activeSpan.mockRestore()

    expect(fields).toEqual({
      requestId: 'request-a',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
    })
  })

  it('omits invalid active span identifiers', () => {
    const provider = new CorrelationFieldsProvider(new RequestContext())
    const invalid = trace.wrapSpanContext({
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: TraceFlags.NONE,
    })
    const activeSpan = jest
      .spyOn(trace, 'getActiveSpan')
      .mockReturnValue(invalid)

    expect(provider.getFields()).toEqual({})
    activeSpan.mockRestore()
  })
})
