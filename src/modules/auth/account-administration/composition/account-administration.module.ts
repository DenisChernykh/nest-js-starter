import { Module, type DynamicModule } from '@nestjs/common'

import { AccountAdministrationMutations } from '../application/account-administration-mutations.service'
import { ACCOUNT_ADMINISTRATION_MUTATION } from '../application/account-administration-mutation.port'
import {
  ACCOUNT_ADMINISTRATION_POLICY,
  type AccountAdministrationPolicy,
} from '../application/account-administration.policy'
import { AccountAdministrationQueries } from '../application/account-administration-queries.service'
import { ACCOUNT_ADMINISTRATION_READ } from '../application/account-administration-read.port'
import { PrismaAccountAdministrationMutationAdapter } from '../infrastructure/prisma-account-administration-mutation.adapter'
import { PrismaAccountAdministrationReadAdapter } from '../infrastructure/prisma-account-administration-read.adapter'
import { AdminAccountController } from '../presentation/admin-account.controller'
import type { ConfiguredAuthorizationModule } from '../../authorization/composition/authorization.module'
import { SessionsModule } from '../../sessions/composition/sessions.module'
import { AUTH_AUDIT } from '../../public-contracts/auth-audit.port'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { DatabaseModule } from '@/platform/database/database.module'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

@Module({})
export class AccountAdministrationModule {
  public static register(
    authorizationModule: ConfiguredAuthorizationModule,
  ): DynamicModule {
    return {
      module: AccountAdministrationModule,
      imports: [
        authorizationModule,
        SessionsModule,
        RuntimeConfigModule,
        DatabaseModule,
      ],
      controllers: [AdminAccountController],
      providers: [
        PrismaAccountAdministrationReadAdapter,
        PrismaAccountAdministrationMutationAdapter,
        {
          provide: ACCOUNT_ADMINISTRATION_READ,
          useExisting: PrismaAccountAdministrationReadAdapter,
        },
        {
          provide: ACCOUNT_ADMINISTRATION_MUTATION,
          useExisting: PrismaAccountAdministrationMutationAdapter,
        },
        {
          provide: ACCOUNT_ADMINISTRATION_POLICY,
          inject: [RuntimeConfigService],
          useFactory: (
            config: RuntimeConfigService,
          ): AccountAdministrationPolicy => config.auth.accountAdministration,
        },
        { provide: AUTH_AUDIT, useExisting: AuthAuditLogger },
        AccountAdministrationQueries,
        AccountAdministrationMutations,
      ],
    }
  }
}
