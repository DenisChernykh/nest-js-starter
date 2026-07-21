import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { reserveRuntimePort } from '@test/e2e/support/create-test-runtime'
import {
  spawnBuiltApi,
  waitForChildExit,
} from '@test/e2e/support/spawn-built-api'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('compiled API process SIGTERM', () => {
  let container: StartedPostgreSqlContainer
  let child: ChildProcessWithoutNullStreams | undefined

  afterAll(async () => {
    if (child?.exitCode === null) child.kill('SIGKILL')
    await container?.stop()
  })

  it('drains and exits zero after a real SIGTERM', async () => {
    container = await startPostgresContainer()
    const port = await reserveRuntimePort()
    const baseUrl = `http://127.0.0.1:${port}`
    child = spawnBuiltApi({
      ...process.env,
      DATABASE_URL: container.getConnectionUri(),
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
