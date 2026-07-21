import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { reserveRuntimePort } from '@test/e2e/support/create-test-runtime'
import {
  spawnBuiltApi,
  waitForChildExit,
} from '@test/e2e/support/spawn-built-api'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'
import { startRedisContainer } from '@test/integration/support/redis-container'

describe('compiled API process SIGTERM', () => {
  let container: StartedPostgreSqlContainer
  let redis: StartedRedisContainer
  let child: ChildProcessWithoutNullStreams | undefined

  afterAll(async () => {
    if (child?.exitCode === null) child.kill('SIGKILL')
    await container?.stop()
    await redis?.stop()
  })

  it('drains and exits zero after a real SIGTERM', async () => {
    ;[container, redis] = await Promise.all([
      startPostgresContainer(),
      startRedisContainer(),
    ])
    const port = await reserveRuntimePort()
    const baseUrl = `http://127.0.0.1:${port}`
    child = spawnBuiltApi({
      ...process.env,
      DATABASE_URL: container.getConnectionUri(),
      REDIS_COORDINATION_URL: redis.getConnectionUrl(),
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
      AUTH_CSRF_ORIGINS: baseUrl,
      OTEL_SDK_DISABLED: 'true',
      API_HOST: '127.0.0.1',
      API_PORT: String(port),
      PUBLIC_API_URL: baseUrl,
      CORS_ORIGINS: baseUrl,
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    await waitForCondition(async () => {
      try {
        return (await fetch(`${baseUrl}/health/ready`)).status === 200
      } catch {
        return false
      }
    }, 5_000)

    expect(child.kill('SIGTERM')).toBe(true)
    await expect(waitForChildExit(child, 5_000)).resolves.toEqual({
      code: 0,
      signal: null,
    })
    expect(output).not.toContain(container.getConnectionUri())
  })
})
