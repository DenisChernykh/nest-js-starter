/**
 * Runs one application operation atomically.
 *
 * @remarks
 * The callback intentionally receives no Prisma type. Infrastructure
 * repositories resolve the transaction-scoped database client internally.
 */
export interface TransactionPort {
  /** Runs the operation in the current or a new transaction boundary. */
  run<T>(operation: () => Promise<T>): Promise<T>
}

/** Injection token for the application transaction boundary. */
export const TRANSACTION_PORT: unique symbol = Symbol('TRANSACTION_PORT')

/**
 * Indicates that a caught nested failure made the outer transaction unsafe to
 * commit.
 */
export class TransactionRollbackOnlyError extends Error {
  /** Creates a stable rollback-only failure while retaining its internal cause. */
  public constructor(cause: unknown) {
    super('Transaction is marked rollback-only', { cause })
    this.name = 'TransactionRollbackOnlyError'
  }
}
