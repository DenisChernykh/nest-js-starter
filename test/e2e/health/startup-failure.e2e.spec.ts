import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { reserveRuntimePort } from '@test/e2e/support/create-test-runtime'
import {
  spawnBuiltApi,
  waitForChildExit,
} from '@test/e2e/support/spawn-built-api'
import {
  assertPostgresSignalSupport,
  resumePostgres,
  suspendPostgres,
} from '@test/integration/support/postgres-outage'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('compiled API startup failure', () => {
  let container: StartedPostgreSqlContainer
  let child: ChildProcessWithoutNullStreams | undefined
  let suspended = false

  afterEach(async () => {
    if (child?.exitCode === null) child.kill('SIGKILL')
    if (suspended) {
      await resumePostgres(container)
      suspended = false
    }
    await container?.stop()
  })

  it('exposes startup failure, rejects traffic and exits one within the database deadline', async () => {
    container = await startPostgresContainer()
    await assertPostgresSignalSupport(container)
    await suspendPostgres(container)
    suspended = true

    const port = await reserveRuntimePort()
    const baseUrl = `http://127.0.0.1:${port}`
    child = spawnBuiltApi({
      ...process.env,
      DATABASE_URL: container.getConnectionUri(),
      REDIS_COORDINATION_URL: 'redis://127.0.0.1:1',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
      AUTH_CSRF_ORIGINS: baseUrl,
      API_HOST: '127.0.0.1',
      API_PORT: String(port),
      PUBLIC_API_URL: baseUrl,
      CORS_ORIGINS: baseUrl,
      DATABASE_CONNECTION_TIMEOUT_MS: '1200',
      DATABASE_HEALTH_TIMEOUT_MS: '1200',
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
        return (await fetch(`${baseUrl}/health/startup`)).status === 503
      } catch {
        return false
      }
    }, 1_000)
    expect((await fetch(`${baseUrl}/v1`)).status).toBe(503)

    await expect(waitForChildExit(child, 2_500)).resolves.toEqual({
      code: 1,
      signal: null,
    })
    await expect(fetch(`${baseUrl}/health/live`)).rejects.toThrow()
    expect(output).not.toContain(container.getConnectionUri())
  })
})
