import { createServer } from 'node:net'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { GracefulShutdownCoordinator } from '@/bootstrap/api/graceful-shutdown'
import { ApiRuntime } from '@/bootstrap/api/api-runtime'
import { startPostgresContainer } from '@test/integration/support/postgres-container'

async function reserveShutdownPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

describe('graceful shutdown runtime', () => {
  let container: StartedPostgreSqlContainer
  let runtime: ApiRuntime

  afterAll(async () => {
    await runtime?.stop()
    await container?.stop()
    for (const key of [
      'DATABASE_URL',
      'API_HOST',
      'API_PORT',
      'PUBLIC_API_URL',
      'CORS_ORIGINS',
    ]) {
      delete process.env[key]
    }
  })

  it('closes the database participant and stops accepting TCP', async () => {
    container = await startPostgresContainer()
    const port = await reserveShutdownPort()
    const baseUrl = `http://127.0.0.1:${port}`
    process.env['DATABASE_URL'] = container.getConnectionUri()
    process.env['API_HOST'] = '127.0.0.1'
    process.env['API_PORT'] = String(port)
    process.env['PUBLIC_API_URL'] = baseUrl
    process.env['CORS_ORIGINS'] = baseUrl
    runtime = new ApiRuntime()
    await runtime.start()

    const result = await new GracefulShutdownCoordinator(runtime).shutdown(
      'test',
    )
    expect(result).toEqual({ exitCode: 0, forced: false })
    await expect(
      fetch(`${baseUrl}/health/live`, { signal: AbortSignal.timeout(200) }),
    ).rejects.toBeDefined()
  })
})
