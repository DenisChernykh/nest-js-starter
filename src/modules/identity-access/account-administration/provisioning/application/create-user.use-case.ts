import { Inject, Injectable } from '@nestjs/common'

import {
  ACCOUNT_PROVISIONING,
  type AccountProvisioningPort,
  type CreateUserResult,
} from './account-provisioning.port'
import {
  PROVISIONING_PASSWORD_HASHER,
  type ProvisioningPasswordHasherPort,
} from './provisioning-password-hasher.port'
import {
  AUTH_AUDIT,
  type AuthAuditPort,
} from '../../../public-contracts/auth-audit.port'
import { UnknownRoleAssignmentError } from '../../../public-contracts/auth-errors'
import { RoleRegistry } from '../../../authorization/application/role-registry'

export interface CreateUserInput {
  readonly email: string
  readonly password: string
  readonly roleKeys: readonly string[]
}

export type { CreateUserResult } from './account-provisioning.port'

@Injectable()
export class CreateUserUseCase {
  public constructor(
    @Inject(ACCOUNT_PROVISIONING)
    private readonly provisioning: AccountProvisioningPort,
    @Inject(PROVISIONING_PASSWORD_HASHER)
    private readonly passwords: ProvisioningPasswordHasherPort,
    private readonly roles: RoleRegistry,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort,
  ) {}

  public async execute(input: CreateUserInput): Promise<CreateUserResult> {
    const roleKeys = [...new Set(input.roleKeys)].sort()
    try {
      this.roles.resolve('active', roleKeys)
      const email = input.email.trim()
      const passwordHash = await this.passwords.hash(input.password)
      const result = await this.provisioning.createUser({
        email,
        normalizedEmail: email.toLowerCase(),
        passwordHash,
        emailVerifiedAt: new Date(),
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
