import type {
  ProblemDefinition,
  RegisteredProblemDefinition,
} from './problem.contracts'

const problemBaseUri = 'https://nest-js-starter.invalid/problems'
const validSlug = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const validCode = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u

const problemDefinitions = [
  {
    slug: 'malformed-request',
    code: 'MALFORMED_REQUEST',
    status: 400,
    title: 'Malformed request',
    detail: 'The request could not be parsed.',
  },
  {
    slug: 'authentication-required',
    code: 'AUTHENTICATION_REQUIRED',
    status: 401,
    title: 'Authentication required',
    detail: 'Valid authentication is required for this request.',
  },
  {
    slug: 'authorization-denied',
    code: 'AUTHORIZATION_DENIED',
    status: 403,
    title: 'Authorization denied',
    detail: 'The authenticated principal cannot perform this request.',
  },
  {
    slug: 'not-found',
    code: 'NOT_FOUND',
    status: 404,
    title: 'Resource not found',
    detail: 'The requested resource does not exist.',
  },
  {
    slug: 'conflict',
    code: 'CONFLICT',
    status: 409,
    title: 'Request conflict',
    detail: 'The request conflicts with the current resource state.',
  },
  {
    slug: 'payload-too-large',
    code: 'PAYLOAD_TOO_LARGE',
    status: 413,
    title: 'Payload too large',
    detail: 'The request payload exceeds the configured limit.',
  },
  {
    slug: 'unsupported-media-type',
    code: 'UNSUPPORTED_MEDIA_TYPE',
    status: 415,
    title: 'Unsupported media type',
    detail: 'The request content type is not supported.',
  },
  {
    slug: 'validation-failed',
    code: 'VALIDATION_FAILED',
    status: 422,
    title: 'Validation failed',
    detail: 'One or more request fields are invalid.',
  },
  {
    slug: 'rate-limit-exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    status: 429,
    title: 'Rate limit exceeded',
    detail: 'Too many requests were submitted in the allowed interval.',
  },
  {
    slug: 'internal-error',
    code: 'INTERNAL_ERROR',
    status: 500,
    title: 'Internal server error',
    detail: 'The server could not complete the request.',
  },
  {
    slug: 'dependency-unavailable',
    code: 'DEPENDENCY_UNAVAILABLE',
    status: 503,
    title: 'Dependency unavailable',
    detail: 'A required service is temporarily unavailable.',
  },
] as const satisfies readonly ProblemDefinition[]

/** Stable machine codes owned by the starter problem catalogue. */
export type ProblemCode = (typeof problemDefinitions)[number]['code']

/** Validated immutable lookup for starter-owned problem definitions. */
export class ProblemRegistry {
  public readonly definitions: readonly RegisteredProblemDefinition[]
  private readonly definitionsByCode: ReadonlyMap<
    string,
    RegisteredProblemDefinition
  >

  /**
   * Validates and freezes a complete set of problem definitions.
   *
   * @param definitions - Candidate definitions from the committed catalogue.
   * @throws Error when any field is invalid or slug/code uniqueness is broken.
   */
  public constructor(definitions: readonly ProblemDefinition[]) {
    const slugs = new Set<string>()
    const codes = new Set<string>()
    const registered = definitions.map((definition) => {
      const type = `${problemBaseUri}/${definition.slug}`
      if (
        !validSlug.test(definition.slug) ||
        !validCode.test(definition.code) ||
        !Number.isInteger(definition.status) ||
        definition.status < 400 ||
        definition.status > 599 ||
        definition.title.length === 0 ||
        definition.detail.length === 0 ||
        slugs.has(definition.slug) ||
        codes.has(definition.code) ||
        !isAbsoluteHttpsUrl(type)
      ) {
        throw new Error('Invalid problem registry')
      }
      slugs.add(definition.slug)
      codes.add(definition.code)
      return Object.freeze({ ...definition, type })
    })

    this.definitions = Object.freeze(registered)
    this.definitionsByCode = new Map(
      this.definitions.map((definition) => [definition.code, definition]),
    )
    Object.freeze(this)
  }

  /**
   * Resolves one known definition without a fallback that could hide drift.
   *
   * @param code - Stable machine code to resolve.
   * @returns The frozen registered definition.
   * @throws Error when code is absent from the committed catalogue.
   */
  public get(code: string): RegisteredProblemDefinition {
    const definition = this.definitionsByCode.get(code)
    if (definition === undefined) {
      throw new Error(`Unknown problem code: ${code}`)
    }
    return definition
  }
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** Process-wide immutable canonical problem registry. */
export const PROBLEM_REGISTRY = new ProblemRegistry(problemDefinitions)
