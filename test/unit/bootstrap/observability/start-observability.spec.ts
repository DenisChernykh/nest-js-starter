import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { startObservability } from '@/bootstrap/observability/start-observability'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

describe('pre-framework observability bootstrap', () => {
  it('uses only the OTLP HTTP protobuf exporter packages', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/bootstrap/observability/start-observability.ts'),
      'utf8',
    )

    expect(source).toContain('@opentelemetry/exporter-trace-otlp-proto')
    expect(source).toContain('@opentelemetry/exporter-metrics-otlp-proto')
    expect(source).not.toContain('@opentelemetry/exporter-trace-otlp-http')
    expect(source).not.toContain('@opentelemetry/exporter-metrics-otlp-http')
  })

  it('keeps API runtime behind a dynamic import in main', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/bootstrap/api/main.ts'),
      'utf8',
    )

    expect(source).toContain("await import('./run-api.js')")
    expect(source).not.toMatch(
      /from ['"].*(api-runtime|configure-api|run-api)/u,
    )
  })

  it('returns a no-op runtime without constructing a collector dependency', async () => {
    const config = buildApiRuntimeConfig(
      requiredRuntimeEnvironment({
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        OTEL_SDK_DISABLED: 'true',
      }),
    )
    const logger = { write: jest.fn() }

    const result = startObservability(config, logger)

    expect(result.enabled).toBe(false)
    await expect(
      result.runtime.close(new AbortController().signal),
    ).resolves.toBeUndefined()
    expect(logger.write).not.toHaveBeenCalled()
  })
})
