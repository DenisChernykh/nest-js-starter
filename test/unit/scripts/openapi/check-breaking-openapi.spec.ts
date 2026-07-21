import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  assertNoBreakingOpenApiChanges,
  diffOpenApiContracts,
} from '@scripts/openapi/check-breaking-openapi'
import { resolveBreakingBaseSource } from '@scripts/openapi/read-breaking-base'

interface BreakingCases {
  readonly base: unknown
  readonly breaking: Readonly<Record<string, unknown>>
  readonly nonBreaking: Readonly<Record<string, unknown>>
}

async function cases(): Promise<BreakingCases> {
  const text = await readFile(
    join(process.cwd(), 'test/fixtures/openapi/breaking/cases.json'),
    'utf8',
  )
  return JSON.parse(text) as BreakingCases
}

describe('OpenAPI breaking change gate', () => {
  it.each([
    'removedPath',
    'removedMethod',
    'removedResponse',
    'tightenedRequest',
  ])('classifies %s as breaking', async (name) => {
    const fixtures = await cases()
    const outcome = await diffOpenApiContracts(
      fixtures.base,
      fixtures.breaking[name],
    )

    expect(outcome.breakingDifferencesFound).toBe(true)
    await expect(
      assertNoBreakingOpenApiChanges(fixtures.base, fixtures.breaking[name]),
    ).rejects.toThrow('Breaking OpenAPI changes detected')
  })

  it.each(['additiveEndpoint', 'additiveResponseProperty'])(
    'accepts %s as non-breaking',
    async (name) => {
      const fixtures = await cases()
      await expect(
        assertNoBreakingOpenApiChanges(
          fixtures.base,
          fixtures.nonBreaking[name],
        ),
      ).resolves.toBeUndefined()
    },
  )

  it('requires exactly one explicit base source', () => {
    expect(() => resolveBreakingBaseSource([], {})).toThrow(
      'Exactly one OpenAPI breaking base source is required',
    )
    expect(() =>
      resolveBreakingBaseSource(['--base-ref', 'stage'], {
        OPENAPI_BREAKING_BASE_FILE: '/tmp/base.json',
      }),
    ).toThrow('Exactly one OpenAPI breaking base source is required')
  })

  it('accepts each CLI and environment source form', () => {
    expect(resolveBreakingBaseSource(['--base-file', 'base.json'], {})).toEqual(
      {
        kind: 'file',
        value: 'base.json',
      },
    )
    expect(
      resolveBreakingBaseSource([], { OPENAPI_BREAKING_BASE_REF: 'stage' }),
    ).toEqual({
      kind: 'ref',
      value: 'stage',
    })
    expect(
      resolveBreakingBaseSource(['--', '--base-ref', 'origin/stage'], {}),
    ).toEqual({
      kind: 'ref',
      value: 'origin/stage',
    })
  })
})
