import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { reserveRuntimePort } from '@test/e2e/support/create-test-runtime'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { startRedisContainer } from '@test/integration/support/redis-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'

interface ExportedSpanSnapshot {
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly attributes: Readonly<Record<string, unknown>>
  readonly events: readonly unknown[]
  readonly links: readonly unknown[]
  readonly status: Readonly<Record<string, unknown>>
}

interface ExportedMetricSnapshot {
  readonly scope: string
  readonly name: string
  readonly attributes: Readonly<Record<string, unknown>>
  readonly value: unknown
}

interface PipelineSnapshot {
  readonly type: 'snapshot'
  readonly spans: readonly ExportedSpanSnapshot[]
  readonly metrics: readonly ExportedMetricSnapshot[]
}

describe('in-memory OpenTelemetry pipeline', () => {
  let postgres: StartedPostgreSqlContainer
  let redis: StartedRedisContainer
  let child: ChildProcess | undefined

  afterAll(async () => {
    if (child?.exitCode === null) child.kill('SIGKILL')
    await postgres?.stop()
    await redis?.stop()
  })

  it('correlates HTTP, auth, PostgreSQL and Redis while exporting no secrets', async () => {
    ;[postgres, redis] = await Promise.all([
      startPostgresContainer(),
      startRedisContainer(),
    ])
    const databaseUrl = postgres.getConnectionUri()
    const redisUrl = redis.getConnectionUrl()
    const migration = runPrismaCommand(
      ['migrate', 'deploy', '--config', 'prisma.config.ts'],
      databaseUrl,
    )
    expect(migration.exitCode).toBe(0)
    const port = await reserveRuntimePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const fixturePath = join(
      process.cwd(),
      'test/integration/platform/observability/fixtures/telemetry-pipeline.fixture.ts',
    )
    child = spawn(process.execPath, ['--import', 'tsx', fixturePath], {
      cwd: process.cwd(),
      env: pipelineEnvironment(databaseUrl, redisUrl, baseUrl),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    await waitForMessage(child, isReadyMessage).catch((error: unknown) => {
      throw new Error(
        `Telemetry fixture failed before ready (exit ${String(child?.exitCode)}): ${output}`,
        { cause: error },
      )
    })

    const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'
    const traceId = '0af7651916cd43dd8448eb211c80319c'
    const response = await fetch(
      `${baseUrl}/v1/auth/login?query_token=query-secret`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'session=cookie-secret; csrf=csrf-secret',
          origin: baseUrl,
          traceparent: `00-${traceId}-b7ad6b7169203331-01`,
          'x-csrf-token': 'csrf-secret',
          'x-request-id': requestId,
        },
        body: JSON.stringify({
          email: 'private-email@example.test',
          password: 'password-secret',
        }),
      },
    )
    const problem: unknown = await response.json()
    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBe(requestId)
    expect(problem).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      requestId,
      instance: `urn:request:${requestId}`,
    })

    child.send?.({ type: 'snapshot' })
    const snapshot = await waitForMessage(child, isPipelineSnapshot)
    await expect(waitForExit(child)).resolves.toBe(0)

    const records = parseJsonLines(output)
    const correlated = records.filter(
      (record) => record['requestId'] === requestId,
    )
    expect(correlated.some((record) => record['kind'] === 'audit')).toBe(true)
    expect(
      correlated.some((record) => record['event'] === 'http_request_completed'),
    ).toBe(true)
    const tracedRecords = correlated.filter(
      (record) => record['traceId'] === traceId,
    )
    expect(tracedRecords.length).toBeGreaterThan(0)
    expect(
      tracedRecords.every((record) => typeof record['spanId'] === 'string'),
    ).toBe(true)

    const requestSpan = snapshot.spans.find(
      (span) => span.name === 'POST /v1/auth/login',
    )
    const authSpan = snapshot.spans.find((span) => span.name === 'auth.login')
    expect(snapshot.spans.map((span) => span.name)).toContain(
      'POST /v1/auth/login',
    )
    expect(requestSpan).toMatchObject({
      traceId,
      attributes: { 'http.route': '/v1/auth/login' },
    })
    expect(authSpan).toMatchObject({
      traceId,
      parentSpanId: requestSpan?.spanId,
    })
    const dependencySpans = snapshot.spans.filter((span) =>
      ['postgresql', 'redis'].includes(databaseSystem(span.attributes)),
    )
    const requestDependencySpans = dependencySpans.filter(
      (span) => span.traceId === traceId,
    )
    expect(
      requestDependencySpans.some(
        (span) => databaseSystem(span.attributes) === 'postgresql',
      ),
    ).toBe(true)
    expect(
      requestDependencySpans.some(
        (span) => databaseSystem(span.attributes) === 'redis',
      ),
    ).toBe(true)
    const redisStatements = requestDependencySpans
      .filter((span) => databaseSystem(span.attributes) === 'redis')
      .flatMap((span) => [
        span.attributes['db.statement'],
        span.attributes['db.query.text'],
      ])
      .filter((value): value is string => typeof value === 'string')
    expect(redisStatements.length).toBeGreaterThan(0)
    expect(
      redisStatements.every((value) => /^[A-Z][A-Z0-9_]{0,31}$/u.test(value)),
    ).toBe(true)

    const applicationMetrics = snapshot.metrics.filter((metric) =>
      metric.scope.startsWith('nest-js-starter.'),
    )
    expect(
      applicationMetrics.some(
        (metric) => metric.name === 'auth.operation.count',
      ),
    ).toBe(true)
    const allowedMetricAttributes = new Set([
      'dependency',
      'event',
      'http.request.method',
      'http.response.status_class',
      'http.route',
      'operation',
      'outcome',
    ])
    expect(
      applicationMetrics.every((metric) =>
        Object.keys(metric.attributes).every((key) =>
          allowedMetricAttributes.has(key),
        ),
      ),
    ).toBe(true)

    const serialized = JSON.stringify({ problem, records, snapshot })
    for (const forbidden of [
      'private-email@example.test',
      'password-secret',
      'cookie-secret',
      'csrf-secret',
      'query-secret',
      'span-secret',
      databaseUrl,
      redisUrl,
      'url.full',
      'http.url',
      'db.statement":"SELECT',
      'db.query.text":"SELECT',
      'exception.message',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

function pipelineEnvironment(
  databaseUrl: string,
  redisUrl: string,
  baseUrl: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_COORDINATION_URL: redisUrl,
    API_HOST: '127.0.0.1',
    API_PORT: new URL(baseUrl).port,
    PUBLIC_API_URL: baseUrl,
    CORS_ORIGINS: baseUrl,
    AUTH_CSRF_ORIGINS: baseUrl,
    AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 21).toString('base64url'),
    AUTH_CSRF_SECRET: Buffer.alloc(32, 22).toString('base64url'),
    AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 23).toString('base64url'),
    AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 24).toString('base64url'),
    OTEL_SDK_DISABLED: 'false',
  }
}

function isReadyMessage(value: unknown): value is { readonly type: 'ready' } {
  return isRecord(value) && value['type'] === 'ready'
}

function isPipelineSnapshot(value: unknown): value is PipelineSnapshot {
  return (
    isRecord(value) &&
    value['type'] === 'snapshot' &&
    Array.isArray(value['spans']) &&
    Array.isArray(value['metrics'])
  )
}

function waitForMessage<T>(
  processHandle: ChildProcess,
  predicate: (value: unknown) => value is T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Telemetry fixture message deadline exceeded')),
      20_000,
    )
    const onMessage = (message: unknown): void => {
      if (!predicate(message)) return
      clearTimeout(timeout)
      processHandle.off('message', onMessage)
      resolve(message)
    }
    processHandle.on('message', onMessage)
  })
}

function waitForExit(processHandle: ChildProcess): Promise<number | null> {
  if (processHandle.exitCode !== null)
    return Promise.resolve(processHandle.exitCode)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Telemetry fixture exit deadline exceeded')),
      20_000,
    )
    processHandle.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
}

function parseJsonLines(output: string): Readonly<Record<string, unknown>>[] {
  const records: Readonly<Record<string, unknown>>[] = []
  for (const line of output.split('\n')) {
    try {
      const value: unknown = JSON.parse(line)
      if (isRecord(value)) records.push(value)
    } catch {
      // Non-JSON SDK diagnostics are excluded from structured log assertions.
    }
  }
  return records
}

function databaseSystem(attributes: Readonly<Record<string, unknown>>): string {
  const value = attributes['db.system.name'] ?? attributes['db.system']
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
