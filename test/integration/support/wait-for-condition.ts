import { performance } from 'node:perf_hooks'

/** Polls a condition against one monotonic absolute deadline. */
export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!(await condition())) {
    if (performance.now() >= deadline)
      throw new Error('Condition deadline exceeded')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
