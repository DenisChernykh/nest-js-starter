import { AsyncLocalStorage } from 'node:async_hooks'

import { Injectable } from '@nestjs/common'

import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import { TransactionRollbackOnlyError } from '@/shared/application/transaction.port'

interface ActivePrismaTransaction {
  readonly client: Prisma.TransactionClient
  rollbackOnly: boolean
  rollbackCause?: unknown
}

interface TransactionOptions {
  readonly maxWait: number
  readonly timeout: number
}

/** Keeps transaction clients and rollback state isolated per async call chain. */
@Injectable()
export class PrismaTransactionContext {
  private readonly storage = new AsyncLocalStorage<ActivePrismaTransaction>()

  /** Invokes one operation with the scoped client or the supplied root client. */
  public withClient<T>(
    rootClient: PrismaClient,
    operation: (client: PrismaClient | Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return operation(this.storage.getStore()?.client ?? rootClient)
  }

  /** Joins the current transaction or opens one on the supplied root client. */
  public run<T>(
    rootClient: PrismaClient | Prisma.TransactionClient,
    operation: () => Promise<T>,
    options: TransactionOptions,
  ): Promise<T> {
    const active = this.storage.getStore()
    if (active !== undefined) {
      return this.runNested(active, operation)
    }
    if (!('$transaction' in rootClient)) {
      return Promise.reject(new Error('Root Prisma Client is required'))
    }
    return rootClient.$transaction(
      (client) => this.runOuter(client, operation),
      options,
    )
  }

  private async runNested<T>(
    active: ActivePrismaTransaction,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      active.rollbackOnly = true
      active.rollbackCause ??= error
      throw error
    }
  }

  private runOuter<T>(
    client: Prisma.TransactionClient,
    operation: () => Promise<T>,
  ): Promise<T> {
    const active: ActivePrismaTransaction = {
      client,
      rollbackOnly: false,
    }
    return this.storage.run(active, async () => {
      const result = await operation()
      if (active.rollbackOnly) {
        throw new TransactionRollbackOnlyError(active.rollbackCause)
      }
      return result
    })
  }
}
