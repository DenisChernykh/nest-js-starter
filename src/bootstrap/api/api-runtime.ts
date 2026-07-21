import type { AddressInfo } from 'node:net'

import type { ApiRuntimeResources } from './configure-api'

async function createConfiguredApi(): Promise<ApiRuntimeResources> {
  const { configureApi } = await import('./configure-api.js')
  return configureApi()
}

/** Factory used to create an initialized but not listening API handle. */
export type ApiRuntimeFactory = () => Promise<ApiRuntimeResources>

/** Owns one cancellable, concurrency-safe API startup attempt. */
export class ApiRuntime {
  private startPromise: Promise<AddressInfo | string | null> | undefined
  private startupController: AbortController | undefined
  private resources: ApiRuntimeResources | undefined
  private cleanupPromise: Promise<void> | undefined
  private cancelled = false

  public constructor(
    private readonly factory: ApiRuntimeFactory = createConfiguredApi,
  ) {}

  /** Starts exactly one listener/database sequence and returns its address. */
  public start(): Promise<AddressInfo | string | null> {
    if (this.startPromise === undefined) {
      this.startupController = new AbortController()
      this.startPromise = this.startInternal(this.startupController.signal)
    }
    return this.startPromise
  }

  /** Synchronously latches cancellation and prevents a later ready transition. */
  public cancelStartup(): void {
    this.cancelled = true
    this.resources?.lifecycle.beginDrain()
    this.startupController?.abort()
  }

  /** Cancels startup if needed and closes every published partial handle. */
  public async stop(): Promise<void> {
    this.cancelStartup()
    await this.startPromise?.catch(() => undefined)
    await this.cleanupPartialResources()
  }

  private ensureStartupAllowed(signal: AbortSignal): void {
    if (
      this.cancelled ||
      signal.aborted ||
      this.resources?.lifecycle.phase === 'draining'
    ) {
      throw new Error('API startup cancelled')
    }
  }

  private async startInternal(
    signal: AbortSignal,
  ): Promise<AddressInfo | string | null> {
    try {
      this.ensureStartupAllowed(signal)
      this.resources = await this.factory()
      this.ensureStartupAllowed(signal)
      await this.resources.application.listen()
      this.ensureStartupAllowed(signal)
      await this.resources.database.connect(signal)
      this.ensureStartupAllowed(signal)
      this.resources.lifecycle.markReady()
      return this.resources.application.address()
    } catch {
      this.resources?.lifecycle.beginDrain()
      this.startupController?.abort()
      await this.cleanupPartialResources()
      throw new Error('API startup failed')
    }
  }

  private async cleanupPartialResources(): Promise<void> {
    const resources = this.resources
    if (resources === undefined) return
    this.cleanupPromise ??= (async () => {
      const cleanupSignal = new AbortController().signal
      await Promise.allSettled([
        resources.application.close(),
        resources.database.close(cleanupSignal),
      ])
    })()
    await this.cleanupPromise
  }
}
