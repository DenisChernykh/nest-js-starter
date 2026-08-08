import { spawnSync } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'
import { Pool } from 'pg'
import { createClient } from 'redis'

import { Argon2PasswordHasher } from '@/modules/auth/infrastructure/argon2-password.hasher'
import { reserveRuntimePort } from '@test/e2e/support/create-test-runtime'
import {
  captureChildOutput,
  spawnBuiltApi,
  waitForChildExit,
} from '@test/e2e/support/spawn-built-api'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { startRedisContainer } from '@test/integration/support/redis-container'
import {
  mailpitSmtpUrl,
  startMailpitContainer,
  type StartedMailpitContainer,
} from '@test/integration/support/mailpit-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

/** One separately spawned compiled API process in the auth acceptance runtime. */
export interface AuthApiInstance {
  readonly baseUrl: string
  readonly child: ChildProcessWithoutNullStreams
  readonly output: () => string
}

/** Isolated shared dependencies and API instances owned by one auth e2e suite. */
export interface AuthE2eRuntime {
  readonly postgres: StartedPostgreSqlContainer
  readonly redis: StartedRedisContainer
  readonly mailpit?: StartedMailpitContainer
  readonly pool: Pool
  readonly instances: readonly AuthApiInstance[]
  /**
   * Persists one login-ready user and exactly the requested role rows.
   *
   * @param email - Unique user email normalized by the fixture.
   * @param passwordHash - Optional precomputed hash; defaults to `valid password`.
   * @param roleKeys - Exact role rows to insert; defaults to `system.admin`.
   * @returns The generated durable user identifier.
   */
  createUser(
    email: string,
    passwordHash?: string,
    roleKeys?: readonly string[],
  ): Promise<string>
  flushRedis(): Promise<void>
  suspendRedis(): Promise<() => Promise<void>>
  stop(): Promise<void>
}

export interface AuthTestRuntimeOptions {
  readonly smtpFailure?: boolean
}

export interface AuthApiStartupDiagnostic {
  readonly baseUrl: string
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  readonly output: () => string
}

const smtpFailureUrl = 'smtp://127.0.0.1:1'
const authApiStartupTimeoutMs = 20_000
const startupOutputTailLength = 4_096

export function createAuthApiStartupError(
  instances: readonly AuthApiStartupDiagnostic[],
  cause: unknown,
): Error {
  const diagnostics = instances
    .map((instance, index) => {
      const output = instance.output()
      const outputTail = output.slice(-startupOutputTailLength)
      return [
        `instance=${index}`,
        `baseUrl=${instance.baseUrl}`,
        `exitCode=${instance.exitCode ?? 'running'}`,
        `signal=${instance.signalCode ?? 'none'}`,
        `outputTail=${outputTail.length === 0 ? '<empty>' : outputTail}`,
      ].join(' ')
    })
    .join('\n')
  const error = new Error(`Auth test API startup failed\n${diagnostics}`, {
    cause,
  })
  error.name = 'AuthTestApiStartupError'
  return error
}

function authEnvironment(
  databaseUrl: string,
  redisUrl: string,
  baseUrl: string,
  origins: string,
  overrides: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_AUTH_URL: redisUrl,
    API_HOST: '127.0.0.1',
    API_PORT: new URL(baseUrl).port,
    PUBLIC_API_URL: baseUrl,
    CORS_ORIGINS: origins,
    AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 11).toString('base64url'),
    AUTH_CSRF_SECRET: Buffer.alloc(32, 12).toString('base64url'),
    AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 13).toString('base64url'),
    AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 14).toString('base64url'),
    ...overrides,
  }
}

/** Starts isolated real dependencies and separate compiled API processes. */
export async function createAuthTestRuntime(
  instanceCount = 2,
  overrides: Record<string, string> = {},
  options: AuthTestRuntimeOptions = {},
): Promise<AuthE2eRuntime> {
  const [postgres, redis] = await Promise.all([
    startPostgresContainer(),
    startRedisContainer(),
  ])
  let mailpit: StartedMailpitContainer | undefined
  try {
    mailpit =
      (overrides.AUTH_SELF_SERVICE_MODE === 'open' ||
        overrides.AUTH_ACCOUNT_EMAIL_WORKFLOWS_MODE === 'enabled') &&
      !options.smtpFailure
        ? await startMailpitContainer()
        : undefined
  } catch (error: unknown) {
    await Promise.all([postgres.stop(), redis.stop()])
    throw error
  }
  const databaseUrl = postgres.getConnectionUri()
  const migration = runPrismaCommand(
    ['migrate', 'deploy', '--config', 'prisma.config.ts'],
    databaseUrl,
  )
  if (migration.exitCode !== 0) {
    await Promise.all([
      postgres.stop(),
      redis.stop(),
      mailpit?.stop() ?? Promise.resolve(),
    ])
    throw new Error('Auth test migration failed')
  }
  const ports = await Promise.all(
    Array.from({ length: instanceCount }, () => reserveRuntimePort()),
  )
  const baseUrls = ports.map((port) => `http://127.0.0.1:${port}`)
  const origins = baseUrls.join(',')
  const instances: AuthApiInstance[] = []
  try {
    for (const baseUrl of baseUrls) {
      const child = spawnBuiltApi(
        authEnvironment(
          databaseUrl,
          redis.getConnectionUrl(),
          baseUrl,
          origins,
          {
            ...overrides,
            ...(mailpit === undefined
              ? options.smtpFailure
                ? {
                    AUTH_PUBLIC_APP_URL:
                      overrides.AUTH_PUBLIC_APP_URL ?? baseUrl,
                    AUTH_SMTP_URL: smtpFailureUrl,
                    AUTH_MAIL_FROM:
                      overrides.AUTH_MAIL_FROM ?? 'no-reply@example.com',
                  }
                : {}
              : {
                  AUTH_PUBLIC_APP_URL: overrides.AUTH_PUBLIC_APP_URL ?? baseUrl,
                  AUTH_SMTP_URL: mailpitSmtpUrl(mailpit),
                  AUTH_MAIL_FROM:
                    overrides.AUTH_MAIL_FROM ?? 'no-reply@example.com',
                }),
          },
        ),
      )
      instances.push({ baseUrl, child, output: captureChildOutput(child) })
    }
    await Promise.all(
      instances.map(({ baseUrl }) =>
        waitForCondition(async () => {
          try {
            return (await fetch(`${baseUrl}/health/ready`)).status === 200
          } catch {
            return false
          }
        }, authApiStartupTimeoutMs),
      ),
    )
  } catch (error: unknown) {
    const startupError = createAuthApiStartupError(
      instances.map(({ baseUrl, child, output }) => ({
        baseUrl,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        output,
      })),
      error,
    )
    for (const { child } of instances) {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    await Promise.all([
      postgres.stop(),
      redis.stop(),
      mailpit?.stop() ?? Promise.resolve(),
    ])
    throw startupError
  }
  const pool = new Pool({ connectionString: databaseUrl })
  pool.on('error', () => undefined)
  const stop = async (): Promise<void> => {
    await pool.end()
    await Promise.all(
      instances.map(async ({ child }) => {
        if (child.exitCode !== null) return
        child.kill('SIGTERM')
        await waitForChildExit(child, 5_000).catch(() => {
          child.kill('SIGKILL')
        })
      }),
    )
    await Promise.all([
      postgres.stop(),
      redis.stop(),
      mailpit?.stop() ?? Promise.resolve(),
    ])
  }
  return {
    postgres,
    redis,
    ...(mailpit === undefined ? {} : { mailpit }),
    pool,
    instances,
    createUser: async (email, passwordHash, roleKeys = ['system.admin']) => {
      const hash =
        passwordHash ??
        (await new Argon2PasswordHasher().hash('valid password'))
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (
           email, normalized_email, email_verified_at, updated_at
         ) VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
        [email, email.trim().toLowerCase()],
      )
      const userId = user.rows[0]?.id
      if (userId === undefined) throw new Error('Auth user fixture failed')
      await pool.query(
        `INSERT INTO password_credentials (user_id, password_hash, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [userId, hash],
      )
      for (const roleKey of roleKeys) {
        await pool.query(
          'INSERT INTO user_roles (user_id, role_key) VALUES ($1, $2)',
          [userId, roleKey],
        )
      }
      return userId
    },
    flushRedis: async () => {
      const client = createClient({
        url: redis.getConnectionUrl(),
        disableOfflineQueue: true,
        socket: { reconnectStrategy: false },
      })
      client.on('error', () => undefined)
      try {
        await client.connect()
        await client.flushDb()
      } finally {
        client.destroy()
      }
    },
    suspendRedis: () => {
      runDockerControl('pause', redis.getId())
      let resumed = false
      return Promise.resolve(() => {
        if (resumed) return Promise.resolve()
        runDockerControl('unpause', redis.getId())
        resumed = true
        return Promise.resolve()
      })
    },
    stop,
  }
}

function runDockerControl(
  action: 'pause' | 'unpause',
  containerId: string,
): void {
  const result = spawnSync('docker', [action, containerId], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      `Docker ${action} failed with status ${String(result.status)}`,
    )
  }
}
