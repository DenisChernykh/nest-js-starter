import type { OutboxRelayRuntimeConfig } from './runtime-config.types'
import { buildOutboxRelayRuntimeConfig } from './runtime-environment'

export function createOutboxRelayRuntimeConfig(): OutboxRelayRuntimeConfig {
  return buildOutboxRelayRuntimeConfig(process.env)
}
