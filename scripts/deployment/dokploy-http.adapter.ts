import type { DokployDeploymentRecord, DokployPort } from './ports.js'

const defaultRequestTimeoutMs = 10_000

/** Construction inputs for the bounded Dokploy HTTPS adapter. */
export interface DokployHttpAdapterOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly requestTimeoutMs?: number
  readonly fetchImplementation?: typeof fetch
}

/**
 * Redacted Dokploy transport or response-contract failure.
 */
export class DokployContractError extends Error {
  readonly operation: string
  readonly status?: number
  readonly category: string

  /**
   * Creates an error containing bounded policy metadata only.
   *
   * @param operation - Fixed adapter operation name.
   * @param category - Fixed transport or contract category.
   * @param status - HTTP status when a response was received.
   */
  constructor(operation: string, category: string, status?: number) {
    super(`Dokploy operation failed: ${operation} (${category})`)
    this.name = 'DokployContractError'
    this.operation = operation
    this.category = category
    if (status !== undefined) this.status = status
  }

  /** Returns a serialization without URLs, headers, bodies or credentials. */
  toJSON(): Readonly<{
    name: string
    message: string
    operation: string
    category: string
    status?: number
  }> {
    return Object.freeze({
      name: this.name,
      message: this.message,
      operation: this.operation,
      category: this.category,
      ...(this.status === undefined ? {} : { status: this.status }),
    })
  }
}

function normalizeBaseUrl(value: string): URL {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new DokployContractError('configure', 'invalid-base-url')
    }
    return url
  } catch (error) {
    if (error instanceof DokployContractError) throw error
    throw new DokployContractError('configure', 'invalid-base-url')
  }
}

function isPlainEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]' &&
    Object.keys(value).length === 0
  )
}

function transportCategory(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return 'timeout'
  }
  return 'transport'
}

/**
 * Calls the documented Dokploy application endpoints over credential-free
 * HTTPS with strict response projection.
 *
 * @remarks
 * The API key and registry password stay in request memory. Errors contain
 * only operation, category and optional HTTP status.
 */
export class DokployHttpAdapter implements DokployPort {
  readonly #baseUrl: URL
  readonly #apiKey: string
  readonly #requestTimeoutMs: number
  readonly #fetch: typeof fetch

  /**
   * Creates a strict HTTPS adapter.
   *
   * @param options - Credential-free origin, in-memory API key and fetch port.
   * @throws DokployContractError when configuration is unsafe.
   */
  constructor(options: DokployHttpAdapterOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl)
    this.#apiKey = options.apiKey
    this.#requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs
    this.#fetch = options.fetchImplementation ?? fetch

    if (
      this.#apiKey.length === 0 ||
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs <= 0
    ) {
      throw new DokployContractError('configure', 'invalid-options')
    }
  }

  async #request(
    operation: string,
    path: string,
    init: Readonly<{ method: 'GET' | 'POST'; body?: string }>,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: init.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': this.#apiKey,
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      })
    } catch (error) {
      throw new DokployContractError(operation, transportCategory(error))
    }

    if (!response.ok) {
      throw new DokployContractError(operation, 'http-status', response.status)
    }

    try {
      return await response.json()
    } catch {
      throw new DokployContractError(operation, 'invalid-json', response.status)
    }
  }

  async #mutate(
    operation: string,
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const result = await this.#request(operation, path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!isPlainEmptyObject(result)) {
      throw new DokployContractError(operation, 'invalid-response')
    }
  }

  /**
   * Lists and safely projects deployment records for one application.
   *
   * @param applicationId - Existing Dokploy application identifier.
   * @returns A frozen list containing IDs, statuses and optional titles only.
   * @throws DokployContractError for transport, HTTP, JSON or shape failures.
   */
  async listDeployments(
    applicationId: string,
  ): Promise<readonly DokployDeploymentRecord[]> {
    const query = new URLSearchParams({ applicationId })
    const result = await this.#request(
      'list-deployments',
      `/api/deployment.all?${query.toString()}`,
      { method: 'GET' },
    )
    if (!Array.isArray(result)) {
      throw new DokployContractError('list-deployments', 'invalid-response')
    }

    const records = result.map((value) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof Reflect.get(value, 'deploymentId') !== 'string' ||
        typeof Reflect.get(value, 'status') !== 'string'
      ) {
        throw new DokployContractError('list-deployments', 'invalid-response')
      }
      const title = Reflect.get(value, 'title') as unknown
      if (title !== undefined && typeof title !== 'string') {
        throw new DokployContractError('list-deployments', 'invalid-response')
      }
      return Object.freeze({
        deploymentId: Reflect.get(value, 'deploymentId') as string,
        status: Reflect.get(value, 'status') as string,
        ...(title === undefined ? {} : { title }),
      })
    })
    return Object.freeze(records)
  }

  /**
   * Replaces the complete application environment.
   *
   * @param applicationId - Existing Dokploy application identifier.
   * @param environment - Complete secret-bearing runtime environment text.
   * @throws DokployContractError unless Dokploy returns an empty object.
   */
  saveEnvironment(applicationId: string, environment: string): Promise<void> {
    return this.#mutate(
      'save-environment',
      '/api/application.saveEnvironment',
      {
        applicationId,
        env: environment,
        buildArgs: null,
        buildSecrets: null,
        createEnvFile: false,
      },
    )
  }

  /**
   * Saves one digest-pinned private GHCR provider.
   *
   * @param input - Application, immutable image and in-memory registry credentials.
   * @throws DokployContractError unless Dokploy returns an empty object.
   */
  saveDockerProvider(input: {
    readonly applicationId: string
    readonly imageRef: string
    readonly registryUrl: string
    readonly username: string
    readonly password: string
  }): Promise<void> {
    return this.#mutate(
      'save-docker-provider',
      '/api/application.saveDockerProvider',
      {
        applicationId: input.applicationId,
        dockerImage: input.imageRef,
        registryUrl: input.registryUrl,
        username: input.username,
        password: input.password,
      },
    )
  }

  /**
   * Requests one revision-bound application deployment.
   *
   * @param input - Application identifier and operator-controlled metadata.
   * @throws DokployContractError unless Dokploy returns an empty object.
   */
  deploy(input: {
    readonly applicationId: string
    readonly title: string
    readonly description: string
  }): Promise<void> {
    return this.#mutate('deploy', '/api/application.deploy', {
      applicationId: input.applicationId,
      title: input.title,
      description: input.description,
    })
  }
}
