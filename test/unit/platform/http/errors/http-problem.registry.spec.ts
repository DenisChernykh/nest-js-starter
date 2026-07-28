import { ApplicationError } from '@/shared/application/application.error'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import {
  PROBLEM_CATALOG,
  defineProblemDefinition,
} from '@/platform/http/errors/problem-registry'

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

  it('rejects duplicate codes, slugs and types at construction', () => {
    expect(
      () =>
        new HttpProblemRegistry([
          CORE_HTTP_PROBLEM_CONTRIBUTION,
          {
            definitions: [PROBLEM_CATALOG[0]!],
            map: () => undefined,
          },
        ]),
    ).toThrow('Duplicate HTTP problem definition')
  })
})
