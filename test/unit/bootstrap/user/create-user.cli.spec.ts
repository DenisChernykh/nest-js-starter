import { UnknownRoleAssignmentError } from '@/modules/auth/application/auth-errors'
import {
  runCreateUserCli,
  type CreateUserCliDependencies,
} from '@/bootstrap/user/create-user.cli'

function cliHarness(password = 'correct horse battery staple'): {
  readonly create: jest.MockedFunction<
    CreateUserCliDependencies['createUser']['execute']
  >
  readonly dependencies: CreateUserCliDependencies
  readonly passwordBuffer: Buffer
  readonly readPassword: jest.MockedFunction<
    CreateUserCliDependencies['readPassword']
  >
  readonly stderr: string[]
  readonly stdout: string[]
} {
  const passwordBuffer = Buffer.from(password)
  const stdout: string[] = []
  const stderr: string[] = []
  const create: jest.MockedFunction<
    CreateUserCliDependencies['createUser']['execute']
  > = jest.fn().mockResolvedValue({ created: true, userId: 'user-1' })
  const readPassword = jest.fn().mockResolvedValue(passwordBuffer)
  return {
    create,
    passwordBuffer,
    readPassword,
    stdout,
    stderr,
    dependencies: {
      createUser: { execute: create },
      readPassword,
      writeOutput: (message) => stdout.push(message),
      writeError: (message) => stderr.push(message),
    },
  }
}

describe('user provisioning CLI', () => {
  it.each([
    [
      'separate values',
      [
        '--email',
        'Reviewer@Example.com',
        '--role',
        'system.admin',
        '--role',
        'approval.reviewer',
        '--role',
        'approval.reviewer',
      ],
      ['system.admin', 'approval.reviewer', 'approval.reviewer'],
    ],
    [
      'equals values',
      [
        '--email=Reviewer@Example.com',
        '--role=system.admin',
        '--role=approval.reviewer',
      ],
      ['system.admin', 'approval.reviewer'],
    ],
  ] as const)(
    'passes accepted %s to the use case',
    async (_name, argv, roles) => {
      const harness = cliHarness()

      await expect(runCreateUserCli(argv, harness.dependencies)).resolves.toBe(
        0,
      )
      expect(harness.create).toHaveBeenCalledWith({
        email: 'Reviewer@Example.com',
        password: 'correct horse battery staple',
        roleKeys: roles,
      })
      expect(harness.stdout).toEqual(['User created.\n'])
      expect(harness.stderr).toEqual([])
      expect(harness.passwordBuffer.every((byte) => byte === 0)).toBe(true)
    },
  )

  it('accepts a user without role options', async () => {
    const harness = cliHarness()

    await expect(
      runCreateUserCli(['--email=requester@example.com'], harness.dependencies),
    ).resolves.toBe(0)
    expect(harness.create).toHaveBeenCalledWith({
      email: 'requester@example.com',
      password: 'correct horse battery staple',
      roleKeys: [],
    })
  })

  it.each([
    ['password option', ['--email=a@example.com', '--password', 'secret']],
    ['password equals option', ['--email=a@example.com', '--password=secret']],
    ['positional value', ['--email=a@example.com', 'unexpected']],
    ['duplicate email', ['--email=a@example.com', '--email=b@example.com']],
    ['malformed email', ['--email=not-an-email']],
    ['unknown option', ['--email=a@example.com', '--unknown=value']],
    ['missing email value', ['--email']],
    ['empty email value', ['--email=']],
    ['missing role value', ['--email=a@example.com', '--role']],
    ['empty role value', ['--email=a@example.com', '--role=']],
  ])('rejects %s before reading stdin', async (_name, argv) => {
    const harness = cliHarness()

    await expect(runCreateUserCli(argv, harness.dependencies)).resolves.toBe(1)
    expect(harness.readPassword).not.toHaveBeenCalled()
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.stderr).toEqual(['Invalid user creation command.\n'])
  })

  it.each(['', 'short', 'elevenchars'])(
    'rejects a password shorter than 12 characters and clears its buffer',
    async (password) => {
      const harness = cliHarness(password)

      await expect(
        runCreateUserCli(['--email=a@example.com'], harness.dependencies),
      ).resolves.toBe(1)
      expect(harness.create).not.toHaveBeenCalled()
      expect(harness.passwordBuffer.every((byte) => byte === 0)).toBe(true)
      expect(harness.stderr).toEqual(['User creation failed.\n'])
    },
  )

  it.each([
    {
      name: 'duplicate email',
      setup: (harness: ReturnType<typeof cliHarness>) =>
        harness.create.mockResolvedValueOnce({ created: false }),
      output: 'User email already exists.\n',
    },
    {
      name: 'unknown role',
      setup: (harness: ReturnType<typeof cliHarness>) =>
        harness.create.mockRejectedValueOnce(new UnknownRoleAssignmentError()),
      output: 'Unknown user role.\n',
    },
    {
      name: 'private dependency failure',
      setup: (harness: ReturnType<typeof cliHarness>) =>
        harness.create.mockRejectedValueOnce(
          new Error(
            'hash=$argon2id$credential postgresql://user:pass@database',
          ),
        ),
      output: 'User creation failed.\n',
    },
  ])(
    'clears the password and prints only the safe $name output',
    async ({ output, setup }) => {
      const password = 'never print this password'
      const harness = cliHarness(password)
      setup(harness)

      await expect(
        runCreateUserCli(
          ['--email=a@example.com', '--role=approval.reviewer'],
          harness.dependencies,
        ),
      ).resolves.toBe(1)

      expect(harness.passwordBuffer.every((byte) => byte === 0)).toBe(true)
      const rendered = `${harness.stdout.join('')}${harness.stderr.join('')}`
      expect(rendered).toBe(output)
      for (const privateValue of [
        password,
        '$argon2id$',
        'credential',
        'postgresql://',
        'user:pass',
      ]) {
        expect(rendered).not.toContain(privateValue)
      }
    },
  )

  it('clears invalid UTF-8 input without leaking decoder details', async () => {
    const harness = cliHarness()
    const invalidUtf8 = Buffer.from([0xc3, 0x28])
    harness.readPassword.mockResolvedValueOnce(invalidUtf8)

    await expect(
      runCreateUserCli(['--email=a@example.com'], harness.dependencies),
    ).resolves.toBe(1)
    expect(invalidUtf8.every((byte) => byte === 0)).toBe(true)
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.stderr).toEqual(['User creation failed.\n'])
  })
})
