import { assertOpenApiOperations } from '@scripts/openapi/check-openapi-operations'

function operation(operationId: string): Readonly<Record<string, unknown>> {
  return {
    operationId,
    responses: { 200: { description: 'Success' } },
    security: [],
    summary: 'Stable operation summary',
    tags: ['health'],
  }
}

function document(
  paths: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    openapi: '3.0.3',
    paths,
  }
}

describe('assertOpenApiOperations', () => {
  it('accepts stable unique operations with explicit structural metadata', () => {
    expect(() =>
      assertOpenApiOperations(
        document({
          '/health/live': { get: operation('healthLive') },
          '/v1/auth/sessions': {
            delete: operation('authLogoutAll'),
            get: operation('authListSessions'),
          },
        }),
      ),
    ).not.toThrow()
  })

  it('rejects a missing operationId', () => {
    expect(() =>
      assertOpenApiOperations(
        document({
          '/health/live': {
            get: { ...operation('healthLive'), operationId: undefined },
          },
        }),
      ),
    ).toThrow('Invalid OpenAPI operation contract')
  })

  it('rejects duplicate operationIds', () => {
    expect(() =>
      assertOpenApiOperations(
        document({
          '/health/live': { get: operation('healthLive') },
          '/health/ready': { get: operation('healthLive') },
        }),
      ),
    ).toThrow('Invalid OpenAPI operation contract')
  })

  it('rejects fallback or otherwise unstable operationIds', () => {
    expect(() =>
      assertOpenApiOperations(
        document({
          '/health/live': { get: operation('HealthController.live') },
        }),
      ),
    ).toThrow('Invalid OpenAPI operation contract')
  })

  it('rejects undocumented path-item method objects', () => {
    expect(() =>
      assertOpenApiOperations(
        document({
          '/health/live': {
            fetch: operation('healthFetch'),
            get: operation('healthLive'),
          },
        }),
      ),
    ).toThrow('Invalid OpenAPI operation contract')
  })

  it.each(['responses', 'security', 'summary', 'tags'])(
    'rejects an operation without explicit %s metadata',
    (field) => {
      const candidate = { ...operation('healthLive') }
      delete candidate[field]

      expect(() =>
        assertOpenApiOperations(
          document({ '/health/live': { get: candidate } }),
        ),
      ).toThrow('Invalid OpenAPI operation contract')
    },
  )
})
