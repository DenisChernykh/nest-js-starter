import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const stopCommand = ['sh', '-c', 'pkill -STOP -u postgres -x postgres']
const continueCommand = ['sh', '-c', 'pkill -CONT -u postgres -x postgres']
const execFileAsync = promisify(execFile)

/** Verifies that the pinned PostgreSQL image supplies the process signal helper. */
export async function assertPostgresSignalSupport(
  container: StartedPostgreSqlContainer,
): Promise<void> {
  const result = await container.exec(['sh', '-c', 'command -v pkill'])
  if (result.exitCode !== 0)
    throw new Error('Pinned PostgreSQL image lacks pkill')
}

/** Suspends every PostgreSQL server process owned by the container user. */
export async function suspendPostgres(
  container: StartedPostgreSqlContainer,
): Promise<void> {
  const result = await container.exec(stopCommand)
  if (result.exitCode !== 0) throw new Error('PostgreSQL STOP failed')
  try {
    await execFileAsync('docker', ['pause', container.getId()])
  } catch (error: unknown) {
    const resumed = await container.exec(continueCommand)
    throw new Error(
      resumed.exitCode === 0
        ? 'PostgreSQL pause failed'
        : 'PostgreSQL pause and compensating CONT failed',
      { cause: error },
    )
  }
}

/** Resumes every PostgreSQL server process owned by the container user. */
export async function resumePostgres(
  container: StartedPostgreSqlContainer,
): Promise<void> {
  const failures: unknown[] = []
  try {
    await execFileAsync('docker', ['unpause', container.getId()])
  } catch (error: unknown) {
    failures.push(error)
  }
  const result = await container.exec(continueCommand)
  if (result.exitCode !== 0) failures.push(new Error('PostgreSQL CONT failed'))
  if (failures.length > 0) {
    throw new AggregateError(failures, 'PostgreSQL resume failed')
  }
}
