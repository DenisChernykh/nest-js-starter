export class PublicAuthResponseDelay {
  public constructor(
    private readonly minimumMs: number,
    private readonly now: () => number = () => performance.now(),
    private readonly sleep: (delayMs: number) => Promise<void> = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)),
  ) {}

  public async wait(startedAt: number): Promise<void> {
    const remaining = this.minimumMs - (this.now() - startedAt)
    if (remaining > 0) await this.sleep(remaining)
  }
}
