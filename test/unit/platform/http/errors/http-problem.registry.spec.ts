import { ApplicationError } from '@/shared/application/application.error'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import { defineProblemDefinition } from '@/platform/http/errors/problem-registry'

class ExampleError extends ApplicationError<'EXAMPLE_CONFLICT'> {
  public constructor() {
    super('EXAMPLE_CONFLICT', 'private example detail')
  }
}

describe('HttpProblemRegistry', () => {
  it('maps only an explicitly contributed application error', () => {
    const registry = new HttpProblemRegistry([
      CORE_HTTP_PROBLEM_CONTRIBUTION,
      {
        definitions: [
          defineProblemDefinition({
            slug: 'example-conflict',
            code: 'EXAMPLE_CONFLICT',
            status: 409,
            title: 'Example conflict',
            detail: 'The example cannot transition.',
          }),
        ],
        map: (error) =>
          error instanceof ExampleError
            ? { code: 'EXAMPLE_CONFLICT' }
            : undefined,
      },
    ])

    expect(registry.map(new ExampleError()).definition.code).toBe(
      'EXAMPLE_CONFLICT',
    )
    expect(
      registry.map(
        Object.assign(new Error('private'), {
          code: 'EXAMPLE_CONFLICT',
        }),
      ).definition.code,
    ).toBe('INTERNAL_ERROR')
  })

  it.each([
    [
      'code',
      {
        slug: 'duplicate-code-only',
        code: 'MALFORMED_REQUEST',
        status: 409,
        title: 'Duplicate code only',
        detail: 'The code duplicates a core definition.',
        type: 'https://nest-js-starter.invalid/problems/duplicate-code-only',
      },
    ],
    [
      'slug',
      {
        slug: 'malformed-request',
        code: 'DUPLICATE_SLUG_ONLY',
        status: 409,
        title: 'Duplicate slug only',
        detail: 'The slug duplicates a core definition.',
        type: 'https://example.invalid/problems/duplicate-slug-only',
      },
    ],
    [
      'absolute type',
      {
        slug: 'duplicate-type-only',
        code: 'DUPLICATE_TYPE_ONLY',
        status: 409,
        title: 'Duplicate type only',
        detail: 'The type duplicates a core definition.',
        type: 'https://nest-js-starter.invalid/problems/malformed-request',
      },
    ],
  ] as const)(
    'rejects a duplicate %s at construction',
    (_field, definition) => {
      expect(
        () =>
          new HttpProblemRegistry([
            CORE_HTTP_PROBLEM_CONTRIBUTION,
            {
              definitions: [definition],
              map: () => undefined,
            },
          ]),
      ).toThrow('Duplicate HTTP problem definition')
    },
  )
})
