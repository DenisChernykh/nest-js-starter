import { Inject, Injectable } from '@nestjs/common'

import type { AccountAdministrationReadPort } from '../../application/account-administration-read.port'
import type {
  AccountAdministrationState,
  AdminAccount,
} from '../../application/account-administration.port'
import {
  accountStateToPrisma,
  adminAccountInclude,
  mapAdminAccount,
} from './prisma-account-administration.mapper'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'

@Injectable()
export class PrismaAccountAdministrationReadAdapter implements AccountAdministrationReadPort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
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
    const where = {
      ...(input.state === undefined
        ? {}
        : { status: accountStateToPrisma(input.state) }),
      ...(input.search === undefined || input.search.trim() === ''
        ? {}
        : {
            email: {
              contains: input.search.trim(),
              mode: 'insensitive' as const,
            },
          }),
    }
    const [items, total] = await this.provider.withClient((client) =>
      Promise.all([
        client.user.findMany({
          where,
          include: adminAccountInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        client.user.count({ where }),
      ]),
    )
    return { items: items.map(mapAdminAccount), total }
  }

  public async getAccount(
    accountId: string,
  ): Promise<AdminAccount | undefined> {
    const user = await this.provider.withClient((client) =>
      client.user.findUnique({
        where: { id: accountId },
        include: adminAccountInclude,
      }),
    )
    return user === null ? undefined : mapAdminAccount(user)
  }
}
