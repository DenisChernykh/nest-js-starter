import type {
  CommandInput,
  CommandOutcome,
  CommandRunner,
} from '@scripts/deployment/command-runner'
import {
  DockerDeploymentAdapter,
  type DockerTemporaryDirectoryFunctions,
} from '@scripts/deployment/docker-deployment.adapter'

const imageRef =
  'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const revision = '1'.repeat(40)
const password = 'registry-password-secret'
const databaseUrl =
  'postgresql://migrator:migration-secret@database.example.com/app'
const temporaryDirectory = '/private/tmp/nest-js-starter-deployment-auth-test'

const success: CommandOutcome = {
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
}

class FakeCommandRunner implements CommandRunner {
  readonly inputs: CommandInput[] = []
  readonly #outcomes: CommandOutcome[]

  constructor(outcomes: readonly CommandOutcome[]) {
    this.#outcomes = [...outcomes]
  }

  run(input: CommandInput): Promise<CommandOutcome> {
    this.inputs.push(input)
    const outcome = this.#outcomes.shift()
    if (outcome === undefined) throw new Error('Missing fake command outcome')
    return Promise.resolve(outcome)
  }
}

function createTemporaryFunctions(events: string[]): {
  readonly functions: DockerTemporaryDirectoryFunctions
  readonly modes: number[]
} {
  const modes: number[] = []
  return {
    modes,
    functions: {
      temporaryRoot: () => '/private/tmp',
      create: (prefix) => {
        events.push(`create:${prefix}`)
        return Promise.resolve(temporaryDirectory)
      },
      changeMode: (path, mode) => {
        events.push(`chmod:${path}`)
        modes.push(mode)
        return Promise.resolve()
      },
      remove: (path) => {
        events.push(`remove:${path}`)
        return Promise.resolve()
      },
    },
  }
}

function verificationInput(): Readonly<{
  imageRef: string
  revision: string
  registryUrl: 'https://ghcr.io'
  username: string
  password: string
}> {
  return {
    imageRef,
    revision,
    registryUrl: 'https://ghcr.io',
    username: 'operator',
    password,
  } as const
}

describe('DockerDeploymentAdapter', () => {
  it('verifies the exact image with isolated credentials and always cleans up', async () => {
    const runner = new FakeCommandRunner([
      success,
      success,
      { ...success, stdout: `${revision}\n` },
      success,
    ])
    const events: string[] = []
    const temporary = createTemporaryFunctions(events)
    const adapter = new DockerDeploymentAdapter(runner, temporary.functions)

    await adapter.verifyImage(verificationInput())

    expect(runner.inputs).toEqual([
      {
        file: 'docker',
        arguments: [
          '--config',
          temporaryDirectory,
          'login',
          'ghcr.io',
          '--username',
          'operator',
          '--password-stdin',
        ],
        stdin: password,
        timeoutMs: 300_000,
      },
      {
        file: 'docker',
        arguments: ['--config', temporaryDirectory, 'pull', imageRef],
        timeoutMs: 300_000,
      },
      {
        file: 'docker',
        arguments: [
          'image',
          'inspect',
          imageRef,
          '--format',
          '{{index .Config.Labels "org.opencontainers.image.revision"}}',
        ],
        timeoutMs: 300_000,
      },
      {
        file: 'docker',
        arguments: ['--config', temporaryDirectory, 'logout', 'ghcr.io'],
        timeoutMs: 300_000,
      },
    ])
    expect(temporary.modes).toEqual([0o700])
    expect(events.at(-1)).toBe(`remove:${temporaryDirectory}`)

    const serializedInputs = JSON.stringify(runner.inputs)
    expect(serializedInputs.match(new RegExp(password, 'gu'))).toHaveLength(1)
    for (const input of runner.inputs) {
      expect(input.arguments).not.toContain(password)
    }
  })

  it('runs migration with the database URL only in the child environment', async () => {
    const runner = new FakeCommandRunner([
      { ...success, exitCode: 7, stderr: 'private migration body' },
    ])
    const adapter = new DockerDeploymentAdapter(
      runner,
      createTemporaryFunctions([]).functions,
    )

    const result = await adapter.migrate({ imageRef, databaseUrl })

    expect(result).toEqual({ exitCode: 7 })
    expect(runner.inputs).toEqual([
      {
        file: 'docker',
        arguments: [
          'run',
          '--rm',
          '--env',
          'DATABASE_URL',
          '--entrypoint',
          'corepack',
          imageRef,
          'pnpm@11.15.1',
          'start:migrate',
        ],
        environment: { DATABASE_URL: databaseUrl },
        timeoutMs: 300_000,
      },
    ])
    expect(runner.inputs[0]!.arguments).not.toContain(databaseUrl)
    expect(JSON.stringify(result)).not.toContain(databaseUrl)
  })

  it.each([
    { name: 'login non-zero', failedCommand: 0, timedOut: false },
    { name: 'login timeout', failedCommand: 0, timedOut: true },
    { name: 'pull non-zero', failedCommand: 1, timedOut: false },
    { name: 'pull timeout', failedCommand: 1, timedOut: true },
    { name: 'inspect non-zero', failedCommand: 2, timedOut: false },
    { name: 'inspect timeout', failedCommand: 2, timedOut: true },
  ])(
    'returns a redacted error and cleanup after $name',
    async ({ failedCommand, timedOut }) => {
      const outcomes: CommandOutcome[] = [
        success,
        success,
        { ...success, stdout: `${revision}\n` },
        success,
      ]
      outcomes[failedCommand] = {
        exitCode: 1,
        stdout: 'sentinel-private-output',
        stderr: 'sentinel-private-error',
        timedOut,
      }
      const runner = new FakeCommandRunner(outcomes)
      const events: string[] = []
      const adapter = new DockerDeploymentAdapter(
        runner,
        createTemporaryFunctions(events).functions,
      )

      let failure: unknown
      try {
        await adapter.verifyImage(verificationInput())
      } catch (error) {
        failure = error
      }

      expect(failure).toEqual(
        expect.objectContaining({ name: 'DockerDeploymentError' }),
      )
      const serialized = JSON.stringify(failure)
      expect(serialized).not.toContain(password)
      expect(serialized).not.toContain('sentinel-private-output')
      expect(serialized).not.toContain('sentinel-private-error')
      expect(events.at(-1)).toBe(`remove:${temporaryDirectory}`)
    },
  )

  it('rejects a revision mismatch and still logs out and cleans up', async () => {
    const runner = new FakeCommandRunner([
      success,
      success,
      { ...success, stdout: `${'2'.repeat(40)}\n` },
      success,
    ])
    const events: string[] = []
    const adapter = new DockerDeploymentAdapter(
      runner,
      createTemporaryFunctions(events).functions,
    )

    await expect(
      adapter.verifyImage(verificationInput()),
    ).rejects.toMatchObject({
      name: 'DockerDeploymentError',
      operation: 'inspect-revision',
      category: 'revision-mismatch',
    })
    expect(runner.inputs.at(-1)?.arguments).toContain('logout')
    expect(events.at(-1)).toBe(`remove:${temporaryDirectory}`)
  })

  it('cleans up when logout fails', async () => {
    const runner = new FakeCommandRunner([
      success,
      success,
      { ...success, stdout: `${revision}\n` },
      { ...success, exitCode: 1 },
    ])
    const events: string[] = []
    const adapter = new DockerDeploymentAdapter(
      runner,
      createTemporaryFunctions(events).functions,
    )

    await expect(
      adapter.verifyImage(verificationInput()),
    ).rejects.toMatchObject({
      name: 'DockerDeploymentError',
      operation: 'logout',
    })
    expect(events.at(-1)).toBe(`remove:${temporaryDirectory}`)
  })

  it('rejects a migration timeout without exposing command output', async () => {
    const runner = new FakeCommandRunner([
      {
        exitCode: 1,
        stdout: 'sentinel-private-output',
        stderr: 'sentinel-private-error',
        timedOut: true,
      },
    ])
    const adapter = new DockerDeploymentAdapter(
      runner,
      createTemporaryFunctions([]).functions,
    )

    let failure: unknown
    try {
      await adapter.migrate({ imageRef, databaseUrl })
    } catch (error) {
      failure = error
    }

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'DockerDeploymentError',
        operation: 'migrate',
        category: 'timeout',
      }),
    )
    expect(JSON.stringify(failure)).not.toContain(databaseUrl)
    expect(JSON.stringify(failure)).not.toContain('sentinel-private')
  })
})
