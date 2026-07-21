import { spawnSync } from 'node:child_process'

export interface PrismaCommandResult {
  readonly exitCode: number
  readonly output: string
}

export function runPrismaCommand(
  args: readonly string[],
  databaseUrl: string,
): PrismaCommandResult {
  const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const result = spawnSync(
    command,
    ['pnpm@11.15.1', 'exec', 'prisma', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  )
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  }
}
