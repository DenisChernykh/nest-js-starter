import { Inject, Injectable } from '@nestjs/common'

import type {
  AccountAdministrationState,
  AdminAccount,
} from './account-administration.model'
import { AccountAdministrationDisabledError } from './account-administration.errors'
import {
  ACCOUNT_ADMINISTRATION_POLICY,
  type AccountAdministrationPolicy,
} from './account-administration.policy'
import {
  ACCOUNT_ADMINISTRATION_READ,
  type AccountAdministrationReadPort,
} from './account-administration-read.port'
import {
  RoleRegistry,
  type RoleDefinition,
} from '../../authorization/application/role-registry'

@Injectable()
export class AccountAdministrationQueries {
  public constructor(
    @Inject(ACCOUNT_ADMINISTRATION_READ)
    private readonly accounts: AccountAdministrationReadPort,
    @Inject(ACCOUNT_ADMINISTRATION_POLICY)
    private readonly policy: AccountAdministrationPolicy,
    @Inject(RoleRegistry)
    private readonly roles: RoleRegistry,
  ) {}

  public async listAccounts(input: {
    readonly page: number
    readonly pageSize: number
    readonly search?: string
    readonly state?: AccountAdministrationState
  }): Promise<{
    readonly items: readonly AdminAccount[]
    readonly total: number
  }> {
    this.assertEnabled()
    return this.accounts.listAccounts(input)
  }

  public async getAccount(
    accountId: string,
  ): Promise<AdminAccount | undefined> {
    this.assertEnabled()
    return this.accounts.getAccount(accountId)
  }

  public listRoles(): readonly RoleDefinition[] {
    this.assertEnabled()
    return this.roles.listRoles()
  }

  private assertEnabled(): void {
    if (this.policy.mode !== 'enabled')
      throw new AccountAdministrationDisabledError()
  }
}
