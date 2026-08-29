import 'dotenv/config'

import { runCreateUserCli } from './create-user.cli'
import { readSecret } from '../admin/read-secret'
import { API_ROLE_DEFINITIONS } from '../api/api-auth.roles'
import { createUserCommand } from '@/modules/identity-access/composition/user-provisioning.module'
import { createPostgresCommandRuntimeConfig } from '@/platform/config/postgres-command-config'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'
import { PinoLogSink } from '@/platform/logging/pino-log.sink'

/** Runs the PostgreSQL-only one-shot user provisioning command. */
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
    const useCase = createUserCommand(
      provider,
      transaction,
      new AuthAuditLogger(
        new PinoLogSink(config, { destination: process.stderr }),
      ),
      API_ROLE_DEFINITIONS,
    )
    await provider.connect(
      AbortSignal.timeout(config.database.connectionTimeoutMs),
    )
    return await runCreateUserCli(argv, {
      createUser: useCase,
      readPassword: () => readSecret(process.stdin, process.stdout),
      writeOutput: (message) => process.stdout.write(message),
      writeError: (message) => process.stderr.write(message),
    })
  } catch {
    process.stderr.write('User creation failed.\n')
    return 1
  } finally {
    await provider?.close(AbortSignal.timeout(2_000)).catch(() => undefined)
  }
}

void main().then((exitCode) => {
  process.exitCode = exitCode
})
