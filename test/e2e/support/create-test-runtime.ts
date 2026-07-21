import { createServer } from 'node:net'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { ApiRuntime } from '@/bootstrap/api/api-runtime'

/** Reserves and releases an available loopback TCP port for an e2e runtime. */
export async function reserveRuntimePort(): Promise<number> {
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

/** Starts an in-process API runtime connected to the supplied PostgreSQL container. */
export async function startTestRuntime(
  container: StartedPostgreSqlContainer,
  overrides: Record<string, string> = {},
): Promise<{ readonly runtime: ApiRuntime; readonly baseUrl: string }> {
  const port = await reserveRuntimePort()
  const baseUrl = `http://127.0.0.1:${port}`
  Object.assign(process.env, {
    DATABASE_URL: container.getConnectionUri(),
    API_HOST: '127.0.0.1',
    API_PORT: String(port),
    PUBLIC_API_URL: baseUrl,
    CORS_ORIGINS: baseUrl,
    ...overrides,
  })
  const runtime = new ApiRuntime()
  await runtime.start()
  return { runtime, baseUrl }
}

/** Removes process environment owned by the in-process API test harness. */
export function clearTestRuntimeEnvironment(): void {
  for (const key of [
    'DATABASE_URL',
    'API_HOST',
    'API_PORT',
    'PUBLIC_API_URL',
    'CORS_ORIGINS',
    'DATABASE_CONNECTION_TIMEOUT_MS',
    'DATABASE_HEALTH_TIMEOUT_MS',
  ]) {
    delete process.env[key]
  }
}
