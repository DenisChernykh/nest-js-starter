import { Inject, Injectable } from '@nestjs/common'

import {
  IdentitySecurityStateIntegrityError,
  type IdentitySecurityStatePort,
} from '../../application/identity-security-state.port'
import type { AuthProjection } from '../../application/auth.types'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'

const authProjectionInclude = {
  roles: { select: { roleKey: true } },
} as const

interface AuthProjectionRow {
  readonly id: string
  readonly email: string
  readonly normalizedEmail: string
  readonly status: 'INVITED' | 'ACTIVE' | 'DISABLED' | 'RETIRED'
  readonly sessionGeneration: bigint
  readonly roles: readonly { readonly roleKey: string }[]
}

@Injectable()
export class PrismaIdentitySecurityStateAdapter implements IdentitySecurityStatePort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
  ) {}

  public async findAuthProjectionByUserId(
    userId: string,
  ): Promise<AuthProjection | undefined> {
    const row = await this.provider.withClient((client) =>
      client.user.findUnique({
        where: { id: userId },
        include: authProjectionInclude,
      }),
    )
    return row === null ? undefined : mapAuthProjection(row)
  }

  public async readGlobalSessionEpoch(): Promise<bigint> {
    const state = await this.provider.withClient((client) =>
      client.authSecurityState.findUnique({
        where: { id: 1 },
        select: { globalSessionEpoch: true },
      }),
    )
    if (state === null) throw new IdentitySecurityStateIntegrityError()
    return state.globalSessionEpoch
  }
}

function mapAuthProjection(row: AuthProjectionRow): AuthProjection {
  return Object.freeze({
    userId: row.id,
    email: row.email,
    normalizedEmail: row.normalizedEmail,
    status: row.status === 'ACTIVE' ? 'active' : 'disabled',
    sessionGeneration: row.sessionGeneration,
    roleKeys: Object.freeze(row.roles.map(({ roleKey }) => roleKey).sort()),
  })
}
