import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  type DeploymentCliDependencies,
  type DeploymentCliIo,
  runDeploymentCli,
} from '@scripts/deployment/cli'
import * as deploymentCliModule from '@scripts/deployment/cli'
import {
  DeploymentExecutionError,
  type ApplyDeploymentInput,
} from '@scripts/deployment/deployment-orchestrator'
import type { DeploymentLiveEnvironment } from '@scripts/deployment/live-environment'
import type { DeploymentEvidence } from '@scripts/deployment/ports'

const manifestPath = resolve('docs/runbooks/release-manifest.example.json')
const candidateRevision = '1'.repeat(40)
const secretValues = {
  apiKey: 'sentinel-dokploy-api-key',
  registryPassword: 'sentinel-registry-password',
  migrationDatabaseUrl:
    'postgresql://migrator:sentinel@database.example.com/app',
  runtimeDatabaseUrl: 'postgresql://runtime:sentinel@database.example.com/app',
  applicationEnvironment: [
    'NODE_ENV=production',
    'DATABASE_URL=postgresql://runtime:sentinel@database.example.com/app',
    `SERVICE_REVISION=${candidateRevision}`,
  ].join('\n'),
  previousApplicationEnvironment: [
    'NODE_ENV=production',
    'DATABASE_URL=postgresql://previous:sentinel@database.example.com/app',
    `SERVICE_REVISION=${'2'.repeat(40)}`,
  ].join('\n'),
} as const

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    DOKPLOY_BASE_URL: 'https://dokploy.example.com',
    DOKPLOY_API_KEY: secretValues.apiKey,
    DOKPLOY_APPLICATION_ID: 'application-id',
    DOKPLOY_APPLICATION_ENV: secretValues.applicationEnvironment,
    DOKPLOY_PREVIOUS_APPLICATION_ENV:
      secretValues.previousApplicationEnvironment,
    GHCR_REGISTRY_URL: 'https://ghcr.io',
    GHCR_USERNAME: 'registry-user',
    GHCR_PASSWORD: secretValues.registryPassword,
    MIGRATION_DATABASE_URL: secretValues.migrationDatabaseUrl,
    RUNTIME_DATABASE_URL: secretValues.runtimeDatabaseUrl,
  }
}

function successfulEvidence(
  operation: 'promote' | 'rollback',
): DeploymentEvidence {
  return {
    schemaVersion: 1,
    operation,
    environment: 'stage',
    repository: 'DenisChernykh/nest-js-starter',
    candidate: {
      imageRef:
        'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      revision: candidateRevision,
    },
    rollback: {
      imageRef:
        'ghcr.io/denischernykh/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      revision: '2'.repeat(40),
    },
    workflowRunUrl:
      'https://github.com/DenisChernykh/nest-js-starter/actions/runs/123456789',
    startedAt: '2026-07-30T10:00:00.000Z',
    finishedAt: '2026-07-30T10:01:00.000Z',
    steps: [],
    deploymentId: `${operation}-deployment`,
    terminalStatus: 'done',
    migrationOutcome: operation === 'promote' ? 'succeeded' : 'not-run',
    restorationAttempted: false,
    restorationSucceeded: false,
    outcome: 'succeeded',
  }
}

function createIo(): {
  readonly io: DeploymentCliIo
  readonly stdout: () => string
  readonly stderr: () => string
} {
  let stdout = ''
  let stderr = ''
  return {
    io: {
      stdout: {
        write: (chunk: string | Uint8Array) => {
          stdout += chunk.toString()
          return true
        },
      },
      stderr: {
        write: (chunk: string | Uint8Array) => {
          stderr += chunk.toString()
          return true
        },
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  }
}

function assertNoSecrets(output: string): void {
  for (const secret of Object.values(secretValues)) {
    expect(output).not.toContain(secret)
  }
}

describe('runDeploymentCli', () => {
  it('prints only the approved preflight artifact identity', async () => {
    const output = createIo()

    await expect(
      runDeploymentCli(
        ['preflight', '--manifest', manifestPath],
        {},
        output.io,
      ),
    ).resolves.toBe(0)

    expect(JSON.parse(output.stdout())).toEqual({
      repository: 'DenisChernykh/nest-js-starter',
      environment: 'stage',
      candidate: {
        imageRef:
          'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        revision: candidateRevision,
      },
      rollback: {
        imageRef:
          'ghcr.io/denischernykh/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        revision: '2'.repeat(40),
      },
    })
    expect(output.stderr()).toBe('')
  })

  it('prints an ordered offline promotion plan without constructing adapters', async () => {
    const output = createIo()
    let createCalls = 0
    const dependencies = {
      createOrchestrator: () => {
        createCalls += 1
        throw new Error('must not construct')
      },
    } satisfies DeploymentCliDependencies

    await expect(
      runDeploymentCli(
        ['promote', '--manifest', manifestPath],
        {},
        output.io,
        dependencies,
      ),
    ).resolves.toBe(0)

    const parsed = JSON.parse(output.stdout()) as {
      operation: string
      apply: boolean
      steps: string[]
    }
    expect(parsed).toMatchObject({
      operation: 'promote',
      apply: false,
    })
    expect(parsed.steps).toEqual([
      'validate release manifest',
      'verify candidate GHCR digest and OCI revision',
      'run one-shot Prisma migrator',
      'save complete Dokploy runtime environment',
      'save exact candidate Docker provider',
      'deploy and identify one Dokploy record',
      'poll identified deployment to done',
      'run external health/auth smoke',
      'write redacted evidence',
    ])
    expect(createCalls).toBe(0)
  })

  it('validates live environment before constructing apply adapters', async () => {
    const output = createIo()
    let createCalls = 0
    const dependencies = {
      createOrchestrator: () => {
        createCalls += 1
        throw new Error('must not construct')
      },
    } satisfies DeploymentCliDependencies

    await expect(
      runDeploymentCli(
        [
          'promote',
          '--manifest',
          manifestPath,
          '--apply',
          '--evidence',
          'promotion.json',
        ],
        {},
        output.io,
        dependencies,
      ),
    ).resolves.toBe(1)

    expect(createCalls).toBe(0)
    expect(output.stderr()).toContain('"error":"input"')
    expect(output.stderr()).toContain('"path":"DOKPLOY_BASE_URL"')
    assertNoSecrets(output.stderr())
  })

  it.each(['promote', 'rollback'] as const)(
    'delegates an explicit %s apply to that operation only',
    async (operation) => {
      const output = createIo()
      const calls: {
        operation: string
        input: ApplyDeploymentInput
      }[] = []
      let receivedLive: DeploymentLiveEnvironment | undefined
      const dependencies: DeploymentCliDependencies = {
        createOrchestrator: (live) => {
          receivedLive = live
          return {
            promote: (input: ApplyDeploymentInput) => {
              calls.push({ operation: 'promote', input })
              return Promise.resolve(successfulEvidence('promote'))
            },
            rollback: (input: ApplyDeploymentInput) => {
              calls.push({ operation: 'rollback', input })
              return Promise.resolve(successfulEvidence('rollback'))
            },
          } as never
        },
      }

      await expect(
        runDeploymentCli(
          [
            operation,
            '--manifest',
            manifestPath,
            '--apply',
            '--evidence',
            `${operation}.json`,
          ],
          validEnvironment(),
          output.io,
          dependencies,
        ),
      ).resolves.toBe(0)

      expect(receivedLive?.dokployApiKey).toBe(secretValues.apiKey)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        operation,
        input: { evidencePath: `${operation}.json` },
      })
      expect(output.stdout()).toContain('"outcome":"succeeded"')
      assertNoSecrets(output.stdout())
      assertNoSecrets(output.stderr())
    },
  )

  it('prints only redacted execution metadata and returns one', async () => {
    const output = createIo()
    const dependencies: DeploymentCliDependencies = {
      createOrchestrator: () =>
        ({
          promote: () =>
            Promise.reject(
              new DeploymentExecutionError(
                'save-candidate-provider',
                'external-operation',
              ),
            ),
          rollback: () => Promise.reject(new Error('not used')),
        }) as never,
    }

    await expect(
      runDeploymentCli(
        [
          'promote',
          '--manifest',
          manifestPath,
          '--apply',
          '--evidence',
          'promotion.json',
        ],
        validEnvironment(),
        output.io,
        dependencies,
      ),
    ).resolves.toBe(1)

    expect(JSON.parse(output.stderr())).toEqual({
      error: 'execution',
      step: 'save-candidate-provider',
      category: 'external-operation',
    })
    assertNoSecrets(output.stderr())
  })

  it('returns one for invalid usage without calling process.exit', async () => {
    const output = createIo()
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit must not be called')
    })

    try {
      await expect(runDeploymentCli(['unknown'], {}, output.io)).resolves.toBe(
        1,
      )
      expect(exit).not.toHaveBeenCalled()
      expect(output.stderr()).toContain('Usage:')
    } finally {
      exit.mockRestore()
    }
  })

  it('redacts rejected manifest values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deployment-cli-test-'))
    const path = join(directory, 'invalid.json')
    const sentinel = 'sentinel-manifest-secret'
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        DATABASE_URL: sentinel,
      }),
      'utf8',
    )
    const output = createIo()

    try {
      await expect(
        runDeploymentCli(['preflight', '--manifest', path], {}, output.io),
      ).resolves.toBe(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }

    expect(output.stderr()).toContain('"error":"input"')
    expect(output.stderr()).not.toContain(sentinel)
  })

  it('aborts an apply on SIGTERM and waits for its cleanup before returning', async () => {
    const listeners = new Map<string, () => void>()
    const signalSource = {
      once: (signal: string, listener: () => void) => {
        listeners.set(signal, listener)
        return signalSource
      },
      off: (signal: string, listener: () => void) => {
        if (listeners.get(signal) === listener) listeners.delete(signal)
        return signalSource
      },
    }
    let operationStarted: (() => void) | undefined
    const started = new Promise<void>((resolveStarted) => {
      operationStarted = resolveStarted
    })
    let cleanupFinished = false
    const dependencies: DeploymentCliDependencies = {
      createOrchestrator: () =>
        ({
          promote: async (input: ApplyDeploymentInput) => {
            const signal = Reflect.get(input, 'signal') as unknown
            if (!(signal instanceof AbortSignal)) {
              throw new Error('Missing deployment signal')
            }
            operationStarted?.()
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  void Promise.resolve().then(() => {
                    cleanupFinished = true
                    reject(new Error('operation aborted'))
                  })
                },
                { once: true },
              )
            })
            throw new Error('unreachable')
          },
          rollback: () => Promise.reject(new Error('not used')),
        }) as never,
    }
    const runProcess = Reflect.get(
      deploymentCliModule,
      'runDeploymentCliProcess',
    ) as unknown

    expect(typeof runProcess).toBe('function')
    if (typeof runProcess !== 'function') return

    const output = createIo()
    const running = (
      runProcess as (
        arguments_: readonly string[],
        environment: NodeJS.ProcessEnv,
        io: DeploymentCliIo,
        dependencies: DeploymentCliDependencies,
        signals: typeof signalSource,
      ) => Promise<number>
    )(
      [
        'promote',
        '--manifest',
        manifestPath,
        '--apply',
        '--evidence',
        'promotion.json',
      ],
      validEnvironment(),
      output.io,
      dependencies,
      signalSource,
    )

    await started
    listeners.get('SIGTERM')?.()

    await expect(running).resolves.toBe(1)
    expect(cleanupFinished).toBe(true)
    expect(listeners.size).toBe(0)
  })
})
