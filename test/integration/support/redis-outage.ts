import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { StartedRedisContainer } from '@testcontainers/redis'

const execFileAsync = promisify(execFile)

/** Suspends all processes and network activity in one Redis test container. */
export async function suspendRedis(
  container: StartedRedisContainer,
): Promise<void> {
  await execFileAsync('docker', ['pause', container.getId()])
}

/** Resumes a Redis test container previously suspended by the harness. */
export async function resumeRedis(
  container: StartedRedisContainer,
): Promise<void> {
  await execFileAsync('docker', ['unpause', container.getId()])
}
