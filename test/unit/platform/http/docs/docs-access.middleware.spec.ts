import type { NextFunction, Request, Response } from 'express'

import type { DocsAccessPolicy } from '@/platform/http/docs/docs-access.contracts'
import {
  createDocsAccessMiddleware,
  isDocsAccessPath,
} from '@/platform/http/docs/docs-access.middleware'
import { RequestContext } from '@/platform/http/context/request-context'

interface ResponseState {
  body?: unknown
  contentType?: string
  statusCode?: number
}

function response(state: ResponseState): Response {
  const target = {} as Response
  target.status = jest.fn((statusCode: number): Response => {
    state.statusCode = statusCode
    return target
  })
  target.type = jest.fn((contentType: string): Response => {
    state.contentType = contentType
    return target
  })
  target.json = jest.fn((body: unknown): Response => {
    state.body = body
    return target
  })
  return target
}

async function invoke(
  policy: DocsAccessPolicy,
  path: string,
  state: ResponseState,
  next: NextFunction,
  cookie?: string,
): Promise<void> {
  const context = new RequestContext()
  const middleware = createDocsAccessMiddleware(policy, context, () => 123)
  const request = {
    path,
    headers: cookie === undefined ? {} : { cookie },
  } as Request
  await context.run('019f0000-0000-7000-8000-000000000001', async () => {
    await Promise.resolve(middleware(request, response(state), next))
  })
}

describe('docs access middleware', () => {
  it.each(['/docs', '/docs/', '/docs/index.css', '/openapi.json'])(
    'matches the exact documentation surface %s',
    (path) => expect(isDocsAccessPath(path)).toBe(true),
  )

  it.each([
    '/documentation',
    '/docs-legacy',
    '/openapi.json.backup',
    '/v1/docs',
  ])('does not match the near miss %s', (path) =>
    expect(isDocsAccessPath(path)).toBe(false),
  )

  it('bypasses non-docs requests without calling the policy', async () => {
    const authorize = jest.fn()
    const next = jest.fn()
    await invoke({ authorize }, '/documentation', {}, next)

    expect(authorize).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledWith()
  })

  it('passes an authorized docs request downstream', async () => {
    const authorize = jest.fn(() => Promise.resolve({ allowed: true } as const))
    const next = jest.fn()
    await invoke(
      { authorize },
      '/docs',
      {},
      next,
      'nest-js-starter-session=token',
    )

    expect(authorize).toHaveBeenCalledWith('nest-js-starter-session=token', 123)
    expect(next).toHaveBeenCalledWith()
  })

  it.each([
    ['AUTHENTICATION_REQUIRED', 401],
    ['AUTHORIZATION_DENIED', 403],
    ['DEPENDENCY_UNAVAILABLE', 503],
  ] as const)('writes an RFC 9457 %s denial', async (problemCode, status) => {
    const state: ResponseState = {}
    const next = jest.fn()
    await invoke(
      {
        authorize: () => Promise.resolve({ allowed: false, problemCode }),
      },
      '/openapi.json',
      state,
      next,
    )

    expect(next).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(status)
    expect(state.contentType).toBe('application/problem+json')
    expect(state.body).toMatchObject({
      status,
      code: problemCode,
      requestId: '019f0000-0000-7000-8000-000000000001',
      instance: 'urn:request:019f0000-0000-7000-8000-000000000001',
    })
  })
})
