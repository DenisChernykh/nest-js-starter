import { readFile } from 'node:fs/promises'

import Ajv2020 from 'ajv/dist/2020'

function isJsonSchema(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Identifies one recipe already applied to a starter copy.
 */
export interface AppliedRecipeReference {
  readonly name: string
  readonly sourceRevision: string
  readonly version: string
}

/**
 * Describes the version-one portable starter metadata contract.
 */
export interface StarterManifestV1 {
  readonly $schema: './docs/schemas/starter-manifest.schema.json'
  readonly appliedRecipes: readonly AppliedRecipeReference[]
  readonly manifestVersion: 1
  readonly starter: {
    readonly name: 'nest-js-starter'
    readonly sourceRevision: string
    readonly version: string
  }
}

/**
 * Reads and validates a starter manifest without consulting Git metadata.
 *
 * @param manifestPath - Absolute or working-directory-relative manifest path.
 * @param schemaPath - Absolute or working-directory-relative JSON Schema path.
 * @returns The schema-validated version-one manifest.
 * @throws Error when JSON, schema validation or recipe uniqueness is invalid.
 */
export async function readStarterManifest(
  manifestPath: string,
  schemaPath: string,
): Promise<StarterManifestV1> {
  const [manifestSource, schemaSource] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(schemaPath, 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource) as unknown
  const schema = JSON.parse(schemaSource) as unknown
  if (!isJsonSchema(schema)) {
    throw new Error('Invalid starter manifest schema: expected an object')
  }
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
  }).compile<StarterManifestV1>(schema)

  if (!validate(manifest)) {
    const details = validate.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ')
    throw new Error(`Invalid starter manifest: ${details ?? 'unknown error'}`)
  }

  const recipeNames = new Set<string>()
  for (const recipe of manifest.appliedRecipes) {
    if (recipeNames.has(recipe.name)) {
      throw new Error(`Duplicate applied recipe name: ${recipe.name}`)
    }
    recipeNames.add(recipe.name)
  }

  return manifest
}
