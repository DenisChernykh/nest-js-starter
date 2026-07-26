import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'

import {
  clearTestRuntimeEnvironment,
  startTestRuntime,
} from '@test/e2e/support/create-test-runtime'
import {
  assertPostgresSignalSupport,
  resumePostgres,
  suspendPostgres,
} from '@test/integration/support/postgres-outage'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'
import { startRedisContainer } from '@test/integration/support/redis-container'

describe('PostgreSQL outage readiness', () => {
  let container: StartedPostgreSqlContainer
  let redis: StartedRedisContainer
  let suspended = false

  it('transitions ready green to red to green while startup stays latched', async () => {
    container = await startPostgresContainer()
    redis = await startRedisContainer()
    const { runtime, baseUrl } = await startTestRuntime(container, redis)
    try {
      await assertPostgresSignalSupport(container)
      expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200)
      expect((await fetch(`${baseUrl}/health/startup`)).status).toBe(200)
      expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200)
      await suspendPostgres(container)
      suspended = true
      await waitForCondition(
        async () => (await fetch(`${baseUrl}/health/ready`)).status === 503,
        2_000,
      )
      expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200)
      expect((await fetch(`${baseUrl}/health/startup`)).status).toBe(200)
      await resumePostgres(container)
      suspended = false
      await waitForCondition(
        async () => (await fetch(`${baseUrl}/health/ready`)).status === 200,
        3_000,
      )
    } finally {
      if (suspended) await resumePostgres(container)
      await runtime.stop()
      await container.stop()
      await redis.stop()
      clearTestRuntimeEnvironment()
    }
  })
})
