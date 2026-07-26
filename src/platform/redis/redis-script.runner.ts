import type { RedisCommandExecutorPort } from './redis-command.executor'

/** Immutable registration for one reviewed atomic Redis script. */
export interface RedisScriptDefinition {
  readonly name: string
  readonly source: string
}

interface RegisteredScript {
  readonly source: string
  sha: string | undefined
  loadPromise: Promise<string> | undefined
}

/** Registers named Lua scripts and executes them through Redis SHA caching. */
export class RedisScriptRunner {
  private readonly scripts = new Map<string, RegisteredScript>()

  public constructor(private readonly executor: RedisCommandExecutorPort) {}

  /**
   * Registers one unique script before it is used.
   *
   * @throws Error for duplicate or unsafe names and empty source text.
   */
  public register(definition: RedisScriptDefinition): void {
    if (
      !/^[A-Za-z0-9._-]+$/u.test(definition.name) ||
      definition.source.trim() === '' ||
      this.scripts.has(definition.name)
    ) {
      throw new Error('Redis script registration rejected')
    }
    this.scripts.set(definition.name, {
      source: definition.source,
      sha: undefined,
      loadPromise: undefined,
    })
  }

  /**
   * Executes a registered script with an explicit non-empty key list.
   *
   * @remarks A Redis script-cache flush triggers one transparent reload. The
   * operation remains bounded by the capability executor.
   * @throws Error for an unknown name or a zero-key invocation.
   */
  public async run<T>(
    name: string,
    keys: readonly string[],
    arguments_: readonly string[],
    signal?: AbortSignal,
  ): Promise<T> {
    if (keys.length === 0)
      throw new Error('Redis script requires an explicit key')
    const script = this.scripts.get(name)
    if (script === undefined) throw new Error('Redis script is not registered')

    const execute = async (): Promise<T> => {
      const sha = await this.load(name, script, signal)
      return this.executor.execute(
        `script:${name}`,
        (client) =>
          client.sendCommand<T>([
            'EVALSHA',
            sha,
            String(keys.length),
            ...keys,
            ...arguments_,
          ]),
        signal,
      )
    }

    try {
      return await execute()
    } catch (error: unknown) {
      if (!(error instanceof Error) || !error.message.includes('NOSCRIPT'))
        throw error
      script.sha = undefined
      return execute()
    }
  }

  private async load(
    name: string,
    script: RegisteredScript,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    if (script.sha !== undefined) return script.sha
    if (script.loadPromise === undefined) {
      const attempt = this.executor.execute(
        `script-load:${name}`,
        (client) =>
          client.sendCommand<string>(['SCRIPT', 'LOAD', script.source]),
        signal,
      )
      script.loadPromise = attempt
      const clearAttempt = (): void => {
        if (script.loadPromise === attempt) script.loadPromise = undefined
      }
      void attempt.then(clearAttempt, clearAttempt)
    }
    const sha = await script.loadPromise
    if (!/^[a-f0-9]{40}$/u.test(sha))
      throw new Error('Redis returned an invalid script digest')
    script.sha = sha
    return sha
  }
}
