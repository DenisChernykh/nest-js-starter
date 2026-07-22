import type { UserConfig } from '@hey-api/openapi-ts'

/**
 * Builds the local-only Hey API configuration for a disposable output path.
 *
 * @param output - Directory that receives generated TypeScript files.
 * @returns Exact OpenAPI input, Fetch client and SDK generation settings.
 */
export function createOpenApiClientConfig(output: string): UserConfig {
  return {
    input: 'docs/api/openapi.json',
    output,
    plugins: ['@hey-api/typescript', '@hey-api/client-fetch', '@hey-api/sdk'],
  }
}

/** Default CLI configuration; its output is disposable and Git-ignored. */
const openApiClientConfig = createOpenApiClientConfig(
  'test/fixtures/openapi-client/.generated',
)

export default openApiClientConfig
