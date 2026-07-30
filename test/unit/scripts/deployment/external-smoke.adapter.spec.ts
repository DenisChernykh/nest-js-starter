import {
  ExternalSmokeAdapter,
  ExternalSmokeError,
} from '@scripts/deployment/external-smoke.adapter'

interface FetchCall {
  readonly url: string
  readonly init?: RequestInit
}

function createFetchFake(
  responses: readonly (Response | Error)[],
  calls: FetchCall[],
): typeof fetch {
  const queue = [...responses]
  return (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    calls.push({
      url,
      ...(init === undefined ? {} : { init }),
    })
    const response = queue.shift()
    if (response === undefined) {
      return Promise.reject(new Error('Missing fake response'))
    }
    return response instanceof Response
      ? Promise.resolve(response.clone())
      : Promise.reject(response)
  }
}

function healthResponse(status = 200): Response {
  return new Response('', { status })
}

function authResponse(
  body: unknown = { code: 'AUTHENTICATION_REQUIRED', status: 401 },
  contentType = 'application/problem+json; charset=utf-8',
): Response {
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { 'content-type': contentType },
  })
}

describe('ExternalSmokeAdapter', () => {
  it('checks public health and unauthenticated auth in fixed order', async () => {
    const calls: FetchCall[] = []
    const adapter = new ExternalSmokeAdapter({
      fetchImplementation: createFetchFake(
        [healthResponse(), healthResponse(), healthResponse(), authResponse()],
        calls,
      ),
    })

    await expect(
      adapter.verify('https://stage-api.example.com'),
    ).resolves.toEqual({
      live: true,
      startup: true,
      ready: true,
      unauthenticatedAuthProblem: true,
    })
    expect(calls.map(({ url }) => url)).toEqual([
      'https://stage-api.example.com/health/live',
      'https://stage-api.example.com/health/startup',
      'https://stage-api.example.com/health/ready',
      'https://stage-api.example.com/v1/auth/me',
    ])
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
      })
      expect(call.init?.headers).toBeUndefined()
      expect(call.init?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it.each([
    { name: 'live', failedIndex: 0 },
    { name: 'startup', failedIndex: 1 },
    { name: 'ready', failedIndex: 2 },
  ])('fails closed when $name health is not 200', async ({ failedIndex }) => {
    const responses = [
      healthResponse(),
      healthResponse(),
      healthResponse(),
      authResponse(),
    ]
    responses[failedIndex] = new Response('sentinel-private-body', {
      status: 503,
    })
    const calls: FetchCall[] = []
    const adapter = new ExternalSmokeAdapter({
      fetchImplementation: createFetchFake(responses, calls),
    })

    let failure: unknown
    try {
      await adapter.verify('https://stage-api.example.com')
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(ExternalSmokeError)
    expect(JSON.stringify(failure)).not.toContain('sentinel-private-body')
    expect(calls).toHaveLength(failedIndex + 1)
  })

  it.each([
    {
      name: 'wrong auth status',
      response: new Response('sentinel-private-body', { status: 200 }),
    },
    {
      name: 'wrong auth content type',
      response: authResponse(
        { code: 'AUTHENTICATION_REQUIRED', status: 401 },
        'text/html',
      ),
    },
    {
      name: 'malformed auth JSON',
      response: new Response('sentinel-private-body', {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      }),
    },
    {
      name: 'wrong auth problem',
      response: authResponse({ code: 'OTHER', status: 401 }),
    },
    {
      name: 'redirect response',
      response: new Response('', {
        status: 302,
        headers: { location: 'https://private.example.com' },
      }),
    },
  ])('rejects $name with a redacted error', async ({ response }) => {
    const adapter = new ExternalSmokeAdapter({
      fetchImplementation: createFetchFake(
        [healthResponse(), healthResponse(), healthResponse(), response],
        [],
      ),
    })

    let failure: unknown
    try {
      await adapter.verify('https://stage-api.example.com')
    } catch (error) {
      failure = error
    }

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'ExternalSmokeError',
        endpoint: 'auth',
      }),
    )
    expect(JSON.stringify(failure)).not.toContain('sentinel-private-body')
    expect(JSON.stringify(failure)).not.toContain('private.example.com')
  })

  it('maps a timeout without exposing its message', async () => {
    const adapter = new ExternalSmokeAdapter({
      fetchImplementation: createFetchFake(
        [new DOMException('sentinel-private-timeout', 'TimeoutError')],
        [],
      ),
    })

    let failure: unknown
    try {
      await adapter.verify('https://stage-api.example.com')
    } catch (error) {
      failure = error
    }

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'ExternalSmokeError',
        endpoint: 'live',
        category: 'timeout',
      }),
    )
    expect(JSON.stringify(failure)).not.toContain('sentinel-private-timeout')
  })
})
