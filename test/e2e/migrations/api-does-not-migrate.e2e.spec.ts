import { createServer } from 'node:net'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'
import { Pool } from 'pg'

import { ApiRuntime } from '@/bootstrap/api/api-runtime'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { startRedisContainer } from '@test/integration/support/redis-container'

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('TCP port reservation failed')
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  )
  return address.port
}

describe('API migration ownership', () => {
  let container: StartedPostgreSqlContainer
  let redis: StartedRedisContainer
  let runtime: ApiRuntime | undefined

  afterEach(async () => {
    await runtime?.stop()
    runtime = undefined
    if (container !== undefined) await container.stop()
    if (redis !== undefined) await redis.stop()
    for (const key of [
      'DATABASE_URL',
      'REDIS_COORDINATION_URL',
      'AUTH_SESSION_KEY_SECRET',
      'AUTH_CSRF_SECRET',
      'AUTH_RATE_LIMIT_KEY_SECRET',
      'AUTH_NETWORK_METADATA_SECRET',
      'AUTH_CSRF_ORIGINS',
      'API_HOST',
      'API_PORT',
      'PUBLIC_API_URL',
      'CORS_ORIGINS',
    ]) {
      delete process.env[key]
    }
  })

  it('starts ready against an empty database without creating migration metadata', async () => {
    ;[container, redis] = await Promise.all([
      startPostgresContainer(),
      startRedisContainer(),
    ])
    const port = await reservePort()
    const baseUrl = `http://127.0.0.1:${port}`
    process.env['DATABASE_URL'] = container.getConnectionUri()
    process.env['REDIS_COORDINATION_URL'] = redis.getConnectionUrl()
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
    process.env['AUTH_CSRF_ORIGINS'] = baseUrl
    process.env['API_HOST'] = '127.0.0.1'
    process.env['API_PORT'] = String(port)
    process.env['PUBLIC_API_URL'] = baseUrl
    process.env['CORS_ORIGINS'] = baseUrl
    runtime = new ApiRuntime()

    await runtime.start()
    const startup = await fetch(`${baseUrl}/health/startup`, {
      signal: AbortSignal.timeout(2_000),
    })
    expect(startup.status).toBe(200)
    expect(await startup.json()).toEqual({ status: 'ok' })
    const ready = await fetch(`${baseUrl}/health/ready`, {
      signal: AbortSignal.timeout(2_000),
    })
    expect(ready.status).toBe(200)

    const pool = new Pool({ connectionString: container.getConnectionUri() })
    try {
      const result = await pool.query<{ migrations: string | null }>(
        "SELECT to_regclass('public._prisma_migrations')::text AS migrations",
      )
      expect(result.rows).toEqual([{ migrations: null }])
    } finally {
      await pool.end()
    }
  })
})
