import { performance } from 'node:perf_hooks'

import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'
import { reserveRuntimePort } from '@test/e2e/support/create-test-runtime'
import { waitForChildExit } from '@test/e2e/support/spawn-built-api'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('OTLP collector outage isolation', () => {
  let runtime: AuthE2eRuntime

  afterAll(async () => runtime?.stop())

  it('keeps startup, readiness, requests and bounded shutdown independent', async () => {
    const collectorPort = await reserveRuntimePort()
    runtime = await createAuthTestRuntime(1, {
      OTEL_SDK_DISABLED: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorPort}`,
      OTEL_EXPORTER_OTLP_TIMEOUT: '50',
      OTEL_METRIC_EXPORT_INTERVAL: '1000',
      OTEL_METRIC_EXPORT_TIMEOUT: '50',
      OTEL_BSP_SCHEDULE_DELAY: '10',
      OTEL_BSP_EXPORT_TIMEOUT: '50',
    })
    const instance = runtime.instances[0]
    if (instance === undefined) throw new Error('Expected one API instance')

    expect((await fetch(`${instance.baseUrl}/health/ready`)).status).toBe(200)
    const startedAt = performance.now()
    const response = await fetch(`${instance.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: instance.baseUrl,
      },
      body: JSON.stringify({
        email: 'missing@example.test',
        password: 'valid-shaped-password',
      }),
    })
    const durationMs = performance.now() - startedAt
    expect(response.status).toBe(401)
    expect(durationMs).toBeLessThan(1_000)
    await waitForCondition(
      () =>
        Promise.resolve(
          instance.output().includes('"event":"otel_diagnostic"'),
        ),
      4_000,
    )
    expect((await fetch(`${instance.baseUrl}/health/ready`)).status).toBe(200)

    const shutdownStartedAt = performance.now()
    expect(instance.child.kill('SIGTERM')).toBe(true)
    const exit = await waitForChildExit(instance.child, 12_000)
    expect(performance.now() - shutdownStartedAt).toBeLessThan(12_000)
    expect(exit).toEqual({ code: 1, signal: null })
  })
})
