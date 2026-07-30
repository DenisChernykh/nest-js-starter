import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from './auth-audit.port'
import { UnknownRoleAssignmentError } from './auth-errors'
import {
  AUTH_PERSISTENCE,
  type AuthPersistencePort,
} from './auth-persistence.port'
import type { CreateUserResult } from './auth.types'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from './password-hasher.port'
import { RoleRegistry } from './role-registry'

/** Operator-supplied values for provisioning one product user. */
export interface CreateUserInput {
  readonly email: string
  readonly password: string
  readonly roleKeys: readonly string[]
}

export type { CreateUserResult } from './auth.types'

/** Validates code-owned roles and atomically provisions one durable user. */
@Injectable()
export class CreateUserUseCase {
  public constructor(
    @Inject(AUTH_PERSISTENCE)
    private readonly persistence: AuthPersistencePort,
    @Inject(PASSWORD_HASHER)
    private readonly passwords: PasswordHasherPort,
    @Inject(RoleRegistry)
    private readonly roles: RoleRegistry,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  /**
   * Validates code-owned roles and provisions one login-capable user.
   *
   * @remarks
   * Role resolution intentionally completes before password hashing, so an
   * unknown role cannot consume hashing or persistence resources.
   *
   * @param input - Operator-owned email, plaintext password and requested role keys.
   * @returns The persistence result unchanged, including its created user id or
   * finite normalized-email conflict.
   * @throws UnknownRoleAssignmentError when any requested role is absent.
   * @throws Non-role failures from hashing or persistence are rethrown unchanged.
   */
  public async execute(input: CreateUserInput): Promise<CreateUserResult> {
    const roleKeys = [...new Set(input.roleKeys)].sort()
    try {
      this.roles.resolve('active', roleKeys)
      const email = input.email.trim()
      const passwordHash = await this.passwords.hash(input.password)
      const result = await this.persistence.createUser({
        email,
        normalizedEmail: email.toLowerCase(),
        passwordHash,
        roleKeys,
      })
      this.audit.emit({
        action: 'user_create',
        outcome: result.created ? 'success' : 'conflict',
        reasonCode: result.created ? 'USER_CREATED' : 'EMAIL_ALREADY_EXISTS',
      })
      return result
    } catch (error: unknown) {
      this.audit.emit({
        action: 'user_create',
        outcome: 'denied',
        reasonCode:
          error instanceof UnknownRoleAssignmentError
            ? 'UNKNOWN_ROLE'
            : 'DEPENDENCY_UNAVAILABLE',
      })
      throw error
    }
  }
}
