import { createServer } from 'node:net'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { GracefulShutdownCoordinator } from '@/bootstrap/api/graceful-shutdown'
import { ApiRuntime } from '@/bootstrap/api/api-runtime'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { startRedisContainer } from '@test/integration/support/redis-container'

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
  let redis: StartedRedisContainer
  let runtime: ApiRuntime

  afterAll(async () => {
    await runtime?.stop()
    await container?.stop()
    await redis?.stop()
    for (const key of [
      'DATABASE_URL',
      'REDIS_AUTH_URL',
      'AUTH_SESSION_KEY_SECRET',
      'AUTH_CSRF_SECRET',
      'AUTH_RATE_LIMIT_KEY_SECRET',
      'AUTH_NETWORK_METADATA_SECRET',
      'API_HOST',
      'API_PORT',
      'PUBLIC_API_URL',
      'CORS_ORIGINS',
    ]) {
      delete process.env[key]
    }
  })

  it('closes the database participant and stops accepting TCP', async () => {
    ;[container, redis] = await Promise.all([
      startPostgresContainer(),
      startRedisContainer(),
    ])
    const port = await reserveShutdownPort()
    const baseUrl = `http://127.0.0.1:${port}`
    process.env['DATABASE_URL'] = container.getConnectionUri()
    process.env['REDIS_AUTH_URL'] = redis.getConnectionUrl()
    process.env['AUTH_SESSION_KEY_SECRET'] = Buffer.alloc(32, 1).toString(
      'base64url',
    )
    process.env['AUTH_CSRF_SECRET'] = Buffer.alloc(32, 2).toString('base64url')
    process.env['AUTH_RATE_LIMIT_KEY_SECRET'] = Buffer.alloc(32, 3).toString(
      'base64url',
    )
    process.env['AUTH_NETWORK_METADATA_SECRET'] = Buffer.alloc(32, 4).toString(
      'base64url',
    )
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
