import { Module } from '@nestjs/common'

import { IDENTITY_SECURITY_STATE } from '../application/identity-security-state.port'
import { PrismaIdentitySecurityStateAdapter } from '../infrastructure/prisma-identity-security-state.adapter'
import { DatabaseModule } from '@/platform/database/database.module'

@Module({
  imports: [DatabaseModule],
  providers: [
    PrismaIdentitySecurityStateAdapter,
    {
      provide: IDENTITY_SECURITY_STATE,
      useExisting: PrismaIdentitySecurityStateAdapter,
    },
  ],
  exports: [IDENTITY_SECURITY_STATE],
})
export class IdentityModule {}
