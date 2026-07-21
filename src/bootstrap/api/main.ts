import { ApiRuntime } from './api-runtime'

/** Starts the API process and records a non-zero exit code on failure. */
export async function main(): Promise<void> {
  await new ApiRuntime().start()
}

void main().catch(() => {
  process.exitCode = 1
})
