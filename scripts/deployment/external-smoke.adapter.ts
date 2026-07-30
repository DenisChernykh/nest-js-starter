import type { ExternalSmokePort, ExternalSmokeResult } from './ports.js'

const defaultRequestTimeoutMs = 10_000

/** Construction inputs for unauthenticated public API smoke checks. */
export interface ExternalSmokeAdapterOptions {
  readonly requestTimeoutMs?: number
  readonly fetchImplementation?: typeof fetch
}

/**
 * Redacted public smoke transport or contract failure.
 */
export class ExternalSmokeError extends Error {
  readonly endpoint: string
  readonly category: string
  readonly status?: number

  /**
   * Creates a bounded smoke failure.
   *
   * @param endpoint - Fixed logical endpoint name.
   * @param category - Fixed transport or response category.
   * @param status - HTTP status when a response was received.
   */
  constructor(endpoint: string, category: string, status?: number) {
    super(`External smoke failed: ${endpoint} (${category})`)
    this.name = 'ExternalSmokeError'
    this.endpoint = endpoint
    this.category = category
    if (status !== undefined) this.status = status
  }

  /** Returns a serialization without URLs or response bodies. */
  toJSON(): Readonly<{
    name: string
    message: string
    endpoint: string
    category: string
    status?: number
  }> {
    return Object.freeze({
      name: this.name,
      message: this.message,
      endpoint: this.endpoint,
      category: this.category,
      ...(this.status === undefined ? {} : { status: this.status }),
    })
  }
}

function normalizePublicOrigin(value: string): URL {
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
      throw new ExternalSmokeError('configure', 'invalid-public-url')
    }
    return url
  } catch (error) {
    if (error instanceof ExternalSmokeError) throw error
    throw new ExternalSmokeError('configure', 'invalid-public-url')
  }
}

function transportCategory(error: unknown): string {
  const name: unknown =
    typeof error === 'object' && error !== null
      ? (Reflect.get(error, 'name') as unknown)
      : undefined
  if (name === 'TimeoutError') return 'timeout'
  if (name === 'AbortError') return 'aborted'
  return 'transport'
}

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

function hasRequiredProblemString(body: object, field: string): boolean {
  const value = Reflect.get(body, field) as unknown
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Verifies the externally routed health and unauthenticated auth contracts.
 *
 * @remarks
 * Requests omit credentials and do not add cookies or headers. Errors never
 * include response bodies or public URL values.
 */
export class ExternalSmokeAdapter implements ExternalSmokePort {
  readonly #requestTimeoutMs: number
  readonly #fetch: typeof fetch

  /**
   * Creates the smoke adapter over an injectable fetch implementation.
   *
   * @param options - Optional timeout and fetch boundary.
   * @throws ExternalSmokeError for an invalid timeout.
   */
  constructor(options: ExternalSmokeAdapterOptions = {}) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs
    this.#fetch = options.fetchImplementation ?? fetch
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs <= 0
    ) {
      throw new ExternalSmokeError('configure', 'invalid-options')
    }
  }

  async #request(
    origin: URL,
    endpoint: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.#fetch(new URL(path, origin), {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: requestSignal(this.#requestTimeoutMs, signal),
      })
    } catch (error) {
      throw new ExternalSmokeError(endpoint, transportCategory(error))
    }
  }

  async #verifyHealth(
    origin: URL,
    endpoint: 'live' | 'startup' | 'ready',
    path: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.#request(origin, endpoint, path, signal)
    if (response.status !== 200) {
      throw new ExternalSmokeError(
        endpoint,
        'unexpected-status',
        response.status,
      )
    }
  }

  async #verifyAuth(origin: URL, signal?: AbortSignal): Promise<void> {
    const endpoint = 'auth'
    const response = await this.#request(
      origin,
      endpoint,
      '/v1/auth/me',
      signal,
    )
    if (response.status !== 401) {
      throw new ExternalSmokeError(
        endpoint,
        'unexpected-status',
        response.status,
      )
    }

    const mediaType =
      response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? ''
    if (mediaType.toLowerCase() !== 'application/problem+json') {
      throw new ExternalSmokeError(
        endpoint,
        'unexpected-content-type',
        response.status,
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ExternalSmokeError(endpoint, 'invalid-json', response.status)
    }
    if (
      typeof body !== 'object' ||
      body === null ||
      !hasRequiredProblemString(body, 'type') ||
      !hasRequiredProblemString(body, 'title') ||
      !hasRequiredProblemString(body, 'detail') ||
      !hasRequiredProblemString(body, 'instance') ||
      !hasRequiredProblemString(body, 'requestId') ||
      Reflect.get(body, 'code') !== 'AUTHENTICATION_REQUIRED' ||
      Reflect.get(body, 'status') !== 401
    ) {
      throw new ExternalSmokeError(
        endpoint,
        'unexpected-problem',
        response.status,
      )
    }
  }

  /**
   * Runs all public smoke checks sequentially in their fixed order.
   *
   * @param publicApiUrl - Credential-free HTTPS API origin.
   * @returns Four true outcomes only after every contract passes.
   * @throws ExternalSmokeError at the first failed endpoint.
   */
  async verify(
    publicApiUrl: string,
    signal?: AbortSignal,
  ): Promise<ExternalSmokeResult> {
    const origin = normalizePublicOrigin(publicApiUrl)
    await this.#verifyHealth(origin, 'live', '/health/live', signal)
    await this.#verifyHealth(origin, 'startup', '/health/startup', signal)
    await this.#verifyHealth(origin, 'ready', '/health/ready', signal)
    await this.#verifyAuth(origin, signal)
    return Object.freeze({
      live: true,
      startup: true,
      ready: true,
      unauthenticatedAuthProblem: true,
    })
  }
}
