import { join } from 'node:path'

import { readStarterManifest } from './starter-manifest'

async function main(): Promise<void> {
  const projectRoot = process.cwd()
  const manifest = await readStarterManifest(
    join(projectRoot, 'starter.manifest.json'),
    join(projectRoot, 'docs/schemas/starter-manifest.schema.json'),
  )

  process.stdout.write(
    `starter.manifest.json: valid (manifestVersion=${manifest.manifestVersion}, appliedRecipes=${manifest.appliedRecipes.length})\n`,
  )
}

void main()
