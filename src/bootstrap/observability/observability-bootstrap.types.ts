import type { ObservabilityRuntime } from '@/platform/observability/observability.runtime'

/** Result of pre-framework observability initialization. */
export interface ObservabilityBootstrapResult {
  readonly runtime: ObservabilityRuntime
  readonly enabled: boolean
}
