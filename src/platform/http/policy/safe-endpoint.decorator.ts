import { SetMetadata } from '@nestjs/common'

/** Metadata key for explicitly reviewed side-effect-free GET/HEAD handlers. */
export const SAFE_ENDPOINT_METADATA = 'platform:http:safe-endpoint'

/** Marks a GET or HEAD handler as an explicitly reviewed safe endpoint. */
export function SafeEndpoint(): MethodDecorator {
  return SetMetadata(SAFE_ENDPOINT_METADATA, true)
}
