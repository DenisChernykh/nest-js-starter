import { PassThrough } from 'node:stream'

import {
  runCreateAdminCli,
  type CreateAdminCliDependencies,
} from '@/bootstrap/admin/create-admin.cli'
import {
  readSecret,
  type SecretInput,
  type SecretOutput,
} from '@/bootstrap/admin/read-secret'

function cliHarness(password = 'correct horse battery staple'): {
  readonly dependencies: CreateAdminCliDependencies
  readonly create: jest.MockedFunction<
    CreateAdminCliDependencies['createInitialAdmin']['execute']
  >
  readonly readPassword: jest.MockedFunction<
    CreateAdminCliDependencies['readPassword']
  >
  readonly stdout: string[]
  readonly stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  const create: jest.MockedFunction<
    CreateAdminCliDependencies['createInitialAdmin']['execute']
  > = jest.fn((input) => {
    void input
    return Promise.resolve({ created: true, userId: 'user' })
  })
  const readPassword: jest.MockedFunction<
    CreateAdminCliDependencies['readPassword']
  > = jest.fn(() => Promise.resolve(Buffer.from(password)))
  return {
    create,
    readPassword,
    stdout,
    stderr,
    dependencies: {
      createInitialAdmin: { execute: create },
      readPassword,
      writeOutput: (message) => stdout.push(message),
      writeError: (message) => stderr.push(message),
    },
  }
}

describe('initial administrator CLI', () => {
  it('accepts only one email option and clears the owned password buffer', async () => {
    const harness = cliHarness()
    const passwordBuffer = await harness.readPassword()
    harness.readPassword.mockResolvedValueOnce(passwordBuffer)

    await expect(
      runCreateAdminCli(['--email', 'Admin@Example.com'], harness.dependencies),
    ).resolves.toBe(0)
    expect(harness.create).toHaveBeenCalledWith({
      email: 'Admin@Example.com',
      password: 'correct horse battery staple',
    })
    expect(passwordBuffer.every((byte) => byte === 0)).toBe(true)
    expect(harness.stdout).toEqual(['Initial administrator created.\n'])
    expect(harness.stderr).toEqual([])
  })

  it.each([
    ['password option', ['--email', 'a@example.com', '--password', 'secret']],
    ['password equals option', ['--email=a@example.com', '--password=secret']],
    ['positional password', ['--email', 'a@example.com', 'secret']],
    [
      'duplicate email',
      ['--email', 'a@example.com', '--email', 'b@example.com'],
    ],
    ['malformed email', ['--email', 'not-an-email']],
  ])('rejects %s before reading a secret', async (_name, argv) => {
    const harness = cliHarness()

    await expect(runCreateAdminCli(argv, harness.dependencies)).resolves.toBe(1)
    expect(harness.readPassword).not.toHaveBeenCalled()
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.stderr.join('')).toBe(
      'Invalid initial administrator command.\n',
    )
  })

  it('reports already completed bootstrap without exposing credential data', async () => {
    const password = 'never print this password'
    const harness = cliHarness(password)
    harness.create.mockResolvedValueOnce({ created: false })

    await expect(
      runCreateAdminCli(['--email=a@example.com'], harness.dependencies),
    ).resolves.toBe(1)
    const output = `${harness.stdout.join('')}${harness.stderr.join('')}`
    expect(output).toBe('Initial administrator already exists.\n')
    expect(output).not.toContain(password)
  })

  it('redacts dependency errors and connection URLs', async () => {
    const password = 'never print this password'
    const harness = cliHarness(password)
    harness.create.mockRejectedValueOnce(
      new Error(
        `hash=$argon2id$password=${password} postgresql://user:pass@db redis://secret`,
      ),
    )

    await expect(
      runCreateAdminCli(['--email=a@example.com'], harness.dependencies),
    ).resolves.toBe(1)
    const output = `${harness.stdout.join('')}${harness.stderr.join('')}`
    expect(output).toBe('Initial administrator creation failed.\n')
    expect(output).not.toContain(password)
    expect(output).not.toContain('argon2')
    expect(output).not.toContain('postgresql://')
    expect(output).not.toContain('redis://')
  })
})

describe('bounded secret input', () => {
  it('reads supported piped stdin and removes one line ending', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    input.end('piped password\r\n')

    const secret = await readSecret(
      input as SecretInput,
      output as SecretOutput,
    )

    expect(secret.toString()).toBe('piped password')
    secret.fill(0)
  })

  it('uses hidden raw TTY input without echoing the password', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const outputChunks: Buffer[] = []
    Object.defineProperty(input, 'isTTY', { value: true })
    const ttyInput = input as SecretInput
    ttyInput.setRawMode = jest.fn()
    output.on('data', (chunk: Buffer) => outputChunks.push(chunk))

    const reading = readSecret(ttyInput, output as SecretOutput)
    input.write('hidden password')
    input.write('\r')
    const secret = await reading

    const rendered = Buffer.concat(outputChunks).toString()
    expect(secret.toString()).toBe('hidden password')
    expect(rendered).toContain('Password: ')
    expect(rendered).not.toContain('hidden password')
    expect(ttyInput.setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(ttyInput.setRawMode).toHaveBeenLastCalledWith(false)
    secret.fill(0)
  })

  it.each([
    ['empty', Buffer.from('\n')],
    ['oversized', Buffer.alloc(1025, 97)],
  ])('rejects %s secret input', async (_name, payload) => {
    const input = new PassThrough()
    const output = new PassThrough()
    input.end(payload)

    await expect(
      readSecret(input as SecretInput, output as SecretOutput),
    ).rejects.toThrow('Secret input rejected')
  })
})
