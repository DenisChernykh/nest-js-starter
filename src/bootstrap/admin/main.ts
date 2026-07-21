import { runCreateAdminCli } from './create-admin.cli'
import { readSecret } from './read-secret'
import { createInitialAdminCommand } from '@/modules/auth/composition/initial-admin.module'
import { createPostgresCommandRuntimeConfig } from '@/platform/config/postgres-command-config'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { PinoLogSink } from '@/platform/logging/pino-log.sink'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

/** Runs the PostgreSQL-only one-shot administrator bootstrap command. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<0 | 1> {
  let provider: PrismaClientProvider | undefined
  try {
    const config = createPostgresCommandRuntimeConfig()
    const transactionContext = new PrismaTransactionContext()
    provider = new PrismaClientProvider(config, transactionContext)
    const transaction = new PrismaTransactionAdapter(
      provider,
      transactionContext,
      config,
    )
    const useCase = createInitialAdminCommand(
      provider,
      transaction,
      new AuthAuditLogger(new PinoLogSink(config)),
    )
    await provider.connect(
      AbortSignal.timeout(config.database.connectionTimeoutMs),
    )
    return await runCreateAdminCli(argv, {
      createInitialAdmin: useCase,
      readPassword: () => readSecret(process.stdin, process.stdout),
      writeOutput: (message) => process.stdout.write(message),
      writeError: (message) => process.stderr.write(message),
    })
  } catch {
    process.stderr.write('Initial administrator creation failed.\n')
    return 1
  } finally {
    await provider?.close(AbortSignal.timeout(2_000)).catch(() => undefined)
  }
}

void main().then((exitCode) => {
  process.exitCode = exitCode
})
