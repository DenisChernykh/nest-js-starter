import { createServer, type Server } from 'node:net'

import {
  captureChildOutput,
  spawnBuiltApi,
  waitForChildExit,
} from '@test/e2e/support/spawn-built-api'

interface StructuredLogRecord {
  readonly apiHost?: string
  readonly apiPort?: number
  readonly event?: string
  readonly level?: string
  readonly module?: string
  readonly reasonCode?: string
}

async function occupyPort(): Promise<{
  readonly port: number
  readonly server: Server
}> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('TCP listener address unavailable')
  }
  return { port: address.port, server }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
}

describe('compiled API occupied port startup failure', () => {
  let occupiedServer: Server | undefined

  afterEach(async () => {
    if (occupiedServer !== undefined) {
      await closeServer(occupiedServer)
      occupiedServer = undefined
    }
  })

  it('reports the occupied listener without exposing connection URLs', async () => {
    const occupied = await occupyPort()
    occupiedServer = occupied.server
    const baseUrl = `http://127.0.0.1:${occupied.port}`
    const databaseSentinel = 'DO_NOT_LOG_DATABASE_URL'
    const child = spawnBuiltApi({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: `postgresql://user:${databaseSentinel}@127.0.0.1:1/app`,
      REDIS_AUTH_URL: 'redis://127.0.0.1:1',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
      OTEL_SDK_DISABLED: 'true',
      API_HOST: '127.0.0.1',
      API_PORT: String(occupied.port),
      PUBLIC_API_URL: baseUrl,
      CORS_ORIGINS: baseUrl,
    })
    const readOutput = captureChildOutput(child)

    await expect(waitForChildExit(child, 5_000)).resolves.toEqual({
      code: 1,
      signal: null,
    })

    const output = readOutput()
    const records = output
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as StructuredLogRecord)
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'fatal',
        event: 'api_startup_failed',
        module: 'Bootstrap',
        reasonCode: 'ADDRESS_IN_USE',
        apiHost: '127.0.0.1',
        apiPort: occupied.port,
      }),
    )
    expect(output).not.toContain(databaseSentinel)
  })
})
