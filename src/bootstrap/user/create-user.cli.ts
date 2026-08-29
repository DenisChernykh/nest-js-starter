import { TextDecoder } from 'node:util'

import {
  UnknownRoleAssignmentError,
  type CreateUserInput,
  type CreateUserResult,
} from '@/modules/identity-access/composition/user-provisioning.module'

/** Narrow user-provisioning use-case surface consumed by the CLI parser. */
export interface UserCreator {
  execute(input: CreateUserInput): Promise<CreateUserResult>
}

/** Injectable CLI effects used to keep secrets and output independently testable. */
export interface CreateUserCliDependencies {
  readonly createUser: UserCreator
  readonly readPassword: () => Promise<Buffer>
  readonly writeOutput: (message: string) => void
  readonly writeError: (message: string) => void
}

interface ParsedArguments {
  readonly email: string
  readonly roleKeys: readonly string[]
}

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u

function parseArguments(argv: readonly string[]): ParsedArguments | undefined {
  let email: string | undefined
  const roleKeys: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--email') {
      if (email !== undefined) return undefined
      email = argv[index + 1]
      index += 1
    } else if (argument?.startsWith('--email=') === true) {
      if (email !== undefined) return undefined
      email = argument.slice('--email='.length)
    } else if (argument === '--role') {
      const roleKey = argv[index + 1]
      if (roleKey === undefined || roleKey.startsWith('--')) return undefined
      roleKeys.push(roleKey)
      index += 1
    } else if (argument?.startsWith('--role=') === true) {
      roleKeys.push(argument.slice('--role='.length))
    } else {
      return undefined
    }
  }
  if (
    email === undefined ||
    email.length > 254 ||
    !emailPattern.test(email) ||
    roleKeys.some((roleKey) => roleKey.length === 0)
  ) {
    return undefined
  }
  return { email, roleKeys }
}

/**
 * Parses operator arguments and provisions one user through bounded CLI effects.
 *
 * @remarks
 * Invalid arguments are rejected before password input. Once acquired, the
 * caller-supplied password buffer is zero-filled on every completion path.
 * Only finite public messages are sent to the supplied output callbacks.
 *
 * @param argv - Operator arguments excluding the executable and script paths.
 * @param dependencies - Use case, password reader and public output callbacks.
 * @returns `0` after confirmed creation; `1` for handled validation, conflict,
 * unknown-role and dependency failures.
 * @throws When a supplied output callback throws.
 */
export async function runCreateUserCli(
  argv: readonly string[],
  dependencies: CreateUserCliDependencies,
): Promise<0 | 1> {
  const parsed = parseArguments(argv)
  if (parsed === undefined) {
    dependencies.writeError('Invalid user creation command.\n')
    return 1
  }

  let passwordBuffer: Buffer | undefined
  try {
    passwordBuffer = await dependencies.readPassword()
    const password = new TextDecoder('utf-8', { fatal: true }).decode(
      passwordBuffer,
    )
    if (password.length < 12) throw new Error('Weak password')
    const result = await dependencies.createUser.execute({
      email: parsed.email,
      password,
      roleKeys: parsed.roleKeys,
    })
    if (!result.created) {
      dependencies.writeError('User email already exists.\n')
      return 1
    }
    dependencies.writeOutput('User created.\n')
    return 0
  } catch (error: unknown) {
    dependencies.writeError(
      error instanceof UnknownRoleAssignmentError
        ? 'Unknown user role.\n'
        : 'User creation failed.\n',
    )
    return 1
  } finally {
    passwordBuffer?.fill(0)
  }
}
