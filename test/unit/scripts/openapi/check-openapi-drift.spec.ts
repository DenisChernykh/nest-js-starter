import { assertOpenApiArtifactBytes } from '@scripts/openapi/check-openapi-drift'

describe('assertOpenApiArtifactBytes', () => {
  it('accepts an exact byte match', () => {
    expect(() =>
      assertOpenApiArtifactBytes(
        '{"openapi":"3.0.3"}\n',
        '{"openapi":"3.0.3"}\n',
      ),
    ).not.toThrow()
  })

  it('rejects a one-byte committed artifact change', () => {
    expect(() =>
      assertOpenApiArtifactBytes(
        '{"openapi":"3.0.2"}\n',
        '{"openapi":"3.0.3"}\n',
      ),
    ).toThrow('OpenAPI artifact drift detected')
  })
})
