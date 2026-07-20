import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readStarterManifest } from '@scripts/manifest/starter-manifest'

const schemaPath = join(
  process.cwd(),
  'docs/schemas/starter-manifest.schema.json',
)

async function writeManifest(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'starter-manifest-'))
  const manifestPath = join(directory, 'starter.manifest.json')
  await writeFile(manifestPath, JSON.stringify(value), 'utf8')
  return manifestPath
}

describe('starter manifest', () => {
  const validManifest = {
    $schema: './docs/schemas/starter-manifest.schema.json',
    manifestVersion: 1,
    starter: {
      name: 'nest-js-starter',
      sourceRevision: 'unreleased',
      version: '0.1.0-alpha.0',
    },
    appliedRecipes: [],
  } as const

  it('accepts the committed version-one manifest', async () => {
    await expect(
      readStarterManifest(
        join(process.cwd(), 'starter.manifest.json'),
        schemaPath,
      ),
    ).resolves.toEqual(validManifest)
  })

  it.each([
    ['unknown root property', { ...validManifest, extra: true }],
    ['unsupported manifest version', { ...validManifest, manifestVersion: 2 }],
    [
      'invalid starter version',
      {
        ...validManifest,
        starter: { ...validManifest.starter, version: 'first' },
      },
    ],
    [
      'invalid source revision',
      {
        ...validManifest,
        starter: { ...validManifest.starter, sourceRevision: 'HEAD' },
      },
    ],
  ])('rejects %s', async (_name, value) => {
    const manifestPath = await writeManifest(value)

    await expect(readStarterManifest(manifestPath, schemaPath)).rejects.toThrow(
      'Invalid starter manifest',
    )
  })

  it('rejects duplicate applied recipe names', async () => {
    const recipe = {
      name: 'jobs-bullmq',
      sourceRevision: 'unreleased',
      version: '1.0.0',
    }
    const manifestPath = await writeManifest({
      ...validManifest,
      appliedRecipes: [recipe, { ...recipe, version: '1.1.0' }],
    })

    await expect(readStarterManifest(manifestPath, schemaPath)).rejects.toThrow(
      'Duplicate applied recipe name: jobs-bullmq',
    )
  })
})
