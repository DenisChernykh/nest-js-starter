import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertGeneratedClientOutput,
  checkGeneratedClient,
} from '@scripts/openapi/check-generated-client'

describe('generated OpenAPI Fetch client gate', () => {
  it('rejects missing and stale generated output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openapi-client-test-'))
    try {
      await expect(
        assertGeneratedClientOutput(join(directory, 'missing'), 'current'),
      ).rejects.toThrow('Generated OpenAPI client output is missing')

      const staleDirectory = join(directory, 'stale')
      await mkdir(join(staleDirectory, 'client'), { recursive: true })
      await Promise.all([
        writeFile(join(staleDirectory, 'index.ts'), 'export {}\n'),
        writeFile(join(staleDirectory, 'sdk.gen.ts'), 'export {}\n'),
        writeFile(join(staleDirectory, 'types.gen.ts'), 'export {}\n'),
        writeFile(join(staleDirectory, 'client/client.gen.ts'), 'export {}\n'),
        writeFile(join(staleDirectory, '.openapi-source.sha256'), 'stale\n'),
      ])

      await expect(
        assertGeneratedClientOutput(staleDirectory, 'current'),
      ).rejects.toThrow('Generated OpenAPI client output is stale')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it.each([
    "import { nonexistentOperation } from './index.js'; void nonexistentOperation;\n",
    [
      "import type { AuthLoginResponses } from './index.js';",
      'const response: AuthLoginResponses[200] = { csrfToken: 42 };',
      'void response;',
      '',
    ].join('\n'),
  ])('rejects a consumer outside the generated contract', async (consumer) => {
    await expect(checkGeneratedClient(consumer)).rejects.toThrow(
      'Generated OpenAPI client TypeScript compilation failed',
    )
  })
})
