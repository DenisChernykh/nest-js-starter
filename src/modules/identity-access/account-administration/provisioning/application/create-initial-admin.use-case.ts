import { Inject, Injectable } from '@nestjs/common'

import {
  ACCOUNT_PROVISIONING,
  type AccountProvisioningPort,
  type InitialAdminResult,
} from './account-provisioning.port'
import {
  PROVISIONING_PASSWORD_HASHER,
  type ProvisioningPasswordHasherPort,
} from './provisioning-password-hasher.port'
import {
  AUTH_AUDIT,
  type AuthAuditPort,
} from '../../../public-contracts/auth-audit.port'

export interface CreateInitialAdminInput {
  readonly email: string
  readonly password: string
}

@Injectable()
export class CreateInitialAdminUseCase {
  public constructor(
    @Inject(ACCOUNT_PROVISIONING)
    private readonly provisioning: AccountProvisioningPort,
    @Inject(PROVISIONING_PASSWORD_HASHER)
    private readonly passwords: ProvisioningPasswordHasherPort,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort,
  ) {}

  public async execute(
    input: CreateInitialAdminInput,
  ): Promise<InitialAdminResult> {
    try {
      const normalizedEmail = input.email.trim().toLowerCase()
      const passwordHash = await this.passwords.hash(input.password)
      const result = await this.provisioning.bootstrapInitialAdmin({
        email: input.email.trim(),
        normalizedEmail,
        passwordHash,
        emailVerifiedAt: new Date(),
      })
      this.audit.emit({
        action: 'initial_admin_create',
        outcome: result.created ? 'success' : 'conflict',
        reasonCode: result.created ? 'INITIAL_ADMIN_CREATED' : 'ALREADY_EXISTS',
        ...(result.created
          ? { targetType: 'user' as const, targetId: result.userId }
          : {}),
      })
      return result
    } catch (error: unknown) {
      this.audit.emit({
        action: 'initial_admin_create',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
      })
      throw error
    }
  }
}
