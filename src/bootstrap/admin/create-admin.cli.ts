import { TextDecoder } from 'node:util'

/** Narrow one-shot use-case surface consumed by the command parser. */
export interface InitialAdminCreator {
  execute(input: {
    readonly email: string
    readonly password: string
  }): Promise<
    | { readonly created: true; readonly userId: string }
    | { readonly created: false }
  >
}

/** Injectable CLI effects used to keep secrets and output independently testable. */
export interface CreateAdminCliDependencies {
  readonly createInitialAdmin: InitialAdminCreator
  readonly readPassword: () => Promise<Buffer>
  readonly writeOutput: (message: string) => void
  readonly writeError: (message: string) => void
}

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u

function parseEmail(argv: readonly string[]): string | undefined {
  let email: string | undefined
  if (argv.length === 2 && argv[0] === '--email') email = argv[1]
  if (argv.length === 1 && argv[0]?.startsWith('--email=') === true)
    email = argv[0].slice('--email='.length)
  if (email === undefined || email.length > 254 || !emailPattern.test(email)) {
    return undefined
  }
  return email
}

/** Parses the email-only command and returns a process-safe exit code. */
export async function runCreateAdminCli(
  argv: readonly string[],
  dependencies: CreateAdminCliDependencies,
): Promise<0 | 1> {
  const email = parseEmail(argv)
  if (email === undefined) {
    dependencies.writeError('Invalid initial administrator command.\n')
    return 1
  }
  let passwordBuffer: Buffer | undefined
  try {
    passwordBuffer = await dependencies.readPassword()
    const password = new TextDecoder('utf-8', { fatal: true }).decode(
      passwordBuffer,
    )
    if (password.length === 0) throw new Error('Empty password')
    const result = await dependencies.createInitialAdmin.execute({
      email,
      password,
    })
    if (!result.created) {
      dependencies.writeError('Initial administrator already exists.\n')
      return 1
    }
    dependencies.writeOutput('Initial administrator created.\n')
    return 0
  } catch {
    dependencies.writeError('Initial administrator creation failed.\n')
    return 1
  } finally {
    passwordBuffer?.fill(0)
  }
}
