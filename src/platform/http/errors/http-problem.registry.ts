import type {
  HttpProblemContribution,
  MappedHttpProblem,
  RegisteredProblemDefinition,
} from './problem.contracts'

/**
 * Resolves module-contributed errors through one immutable root-owned catalog.
 *
 * @remarks
 * Mappers run in declared contribution order. Only explicit mapper results are
 * expected failures; absent and unregistered results collapse to the constant
 * internal problem.
 */
export class HttpProblemRegistry {
  public readonly definitions: readonly RegisteredProblemDefinition[]

  readonly #contributions: readonly HttpProblemContribution[]
  readonly #definitionsByCode: ReadonlyMap<string, RegisteredProblemDefinition>
  readonly #internalError: RegisteredProblemDefinition

  /**
   * Builds and validates one deterministic root catalog.
   *
   * @param contributions - Ordered module contributions selected by the root.
   * @throws Error when code, slug or absolute type is duplicated, or when the
   * required `INTERNAL_ERROR` fallback is absent.
   */
  public constructor(contributions: readonly HttpProblemContribution[]) {
    this.#contributions = Object.freeze([...contributions])
    const definitions = contributions.flatMap(({ definitions: owned }) =>
      owned.map((definition) => Object.freeze({ ...definition })),
    )
    validateUniqueDefinitions(definitions)
    this.definitions = Object.freeze(definitions)
    this.#definitionsByCode = new Map(
      this.definitions.map((definition) => [definition.code, definition]),
    )
    const internalError = this.#definitionsByCode.get('INTERNAL_ERROR')
    if (internalError === undefined) {
      throw new Error(
        'HTTP problem registry requires an INTERNAL_ERROR definition',
      )
    }
    this.#internalError = internalError
  }

  /**
   * Maps one captured failure without exposing its message, cause or stack.
   *
   * @param error - Unknown failure captured at the HTTP boundary.
   * @returns A registered safe definition and explicitly projected metadata.
   */
  public map(error: unknown): MappedHttpProblem {
    for (const contribution of this.#contributions) {
      const mapping = contribution.map(error)
      if (mapping === undefined) continue
      const definition = this.#definitionsByCode.get(mapping.code)
      if (definition === undefined) return this.#unexpected()
      return {
        definition,
        ...(mapping.errors === undefined ? {} : { errors: mapping.errors }),
        ...(mapping.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: mapping.retryAfterSeconds }),
        unexpected: false,
      }
    }
    return this.#unexpected()
  }

  #unexpected(): MappedHttpProblem {
    return {
      definition: this.#internalError,
      unexpected: true,
    }
  }
}

function validateUniqueDefinitions(
  definitions: readonly RegisteredProblemDefinition[],
): void {
  const codes = new Set<string>()
  const slugs = new Set<string>()
  const types = new Set<string>()
  for (const definition of definitions) {
    if (
      codes.has(definition.code) ||
      slugs.has(definition.slug) ||
      types.has(definition.type)
    ) {
      throw new Error(`Duplicate HTTP problem definition: ${definition.code}`)
    }
    codes.add(definition.code)
    slugs.add(definition.slug)
    types.add(definition.type)
  }
}
