import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'

import {
  clearTestRuntimeEnvironment,
  startTestRuntime,
} from '@test/e2e/support/create-test-runtime'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import {
  resumeRedis,
  suspendRedis,
} from '@test/integration/support/redis-outage'
import { startRedisContainer } from '@test/integration/support/redis-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('coordination Redis outage readiness', () => {
  let postgres: StartedPostgreSqlContainer
  let redis: StartedRedisContainer
  let suspended = false

  it('fails readiness and auth closed, then recovers after Redis resumes', async () => {
    ;[postgres, redis] = await Promise.all([
      startPostgresContainer(),
      startRedisContainer(),
    ])
    const { runtime, baseUrl } = await startTestRuntime(postgres, redis)
    try {
      expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200)
      await suspendRedis(redis)
      suspended = true
      await waitForCondition(
        async () => (await fetch(`${baseUrl}/health/ready`)).status === 503,
        2_500,
      )
      expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200)
      expect((await fetch(`${baseUrl}/health/startup`)).status).toBe(200)
      const authentication = await fetch(`${baseUrl}/v1/auth/me`, {
        headers: {
          cookie: `nest-js-starter-session=${'A'.repeat(43)}`,
        },
      })
      expect(authentication.status).toBe(503)
      const body = await authentication.text()
      expect(body).not.toContain(redis.getConnectionUrl())
      expect(body).not.toContain('redis://')

      await resumeRedis(redis)
      suspended = false
      await waitForCondition(
        async () => (await fetch(`${baseUrl}/health/ready`)).status === 200,
        4_000,
      )
    } finally {
      if (suspended) await resumeRedis(redis)
      await runtime.stop()
      await Promise.all([postgres.stop(), redis.stop()])
      clearTestRuntimeEnvironment()
    }
  })
})
