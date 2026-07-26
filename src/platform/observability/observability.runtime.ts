/** Minimal SDK surface owned by bounded telemetry lifecycle. */
export interface ObservabilitySdk {
  shutdown(): Promise<void>
}

/** Bounded OpenTelemetry SDK lifecycle owned by the API runtime. */
export class ObservabilityRuntime {
  private shutdownPromise: Promise<void> | undefined

  public constructor(private readonly sdk?: ObservabilitySdk) {}

  /** Shares SDK shutdown and rejects when the coordinator signal wins. */
  public async close(signal: AbortSignal): Promise<void> {
    if (this.sdk === undefined) return
    this.shutdownPromise ??= this.sdk.shutdown()
    if (signal.aborted) throw new Error('OpenTelemetry shutdown deadline')
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void =>
        reject(new Error('OpenTelemetry shutdown deadline'))
      signal.addEventListener('abort', onAbort, { once: true })
      void this.shutdownPromise?.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort)
      })
    })
  }
}
