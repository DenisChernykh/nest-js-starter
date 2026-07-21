import type { Request } from 'express'

import { resolveHttpRouteTemplate } from '@/platform/logging/http-route-template'

describe('resolveHttpRouteTemplate', () => {
  it.each([
    [
      { baseUrl: '/v1', route: { path: '/users/:userId' } },
      '/v1/users/:userId',
    ],
    [{ baseUrl: '', route: { path: '/health/live' } }, '/health/live'],
    [{ baseUrl: '/v1', route: undefined }, 'unmatched'],
    [{ baseUrl: '/v1', route: { path: ['/one', '/two'] } }, 'unmatched'],
  ])('resolves a finite route template', (request, expected) => {
    expect(resolveHttpRouteTemplate(request as unknown as Request)).toBe(
      expected,
    )
  })

  it('never reads original URL, query or concrete params', () => {
    const request = {
      baseUrl: '/v1',
      route: { path: '/places/:placeId' },
      get originalUrl(): never {
        throw new Error('originalUrl must not be read')
      },
      get query(): never {
        throw new Error('query must not be read')
      },
      get params(): never {
        throw new Error('params must not be read')
      },
    }

    expect(resolveHttpRouteTemplate(request as unknown as Request)).toBe(
      '/v1/places/:placeId',
    )
  })
})
