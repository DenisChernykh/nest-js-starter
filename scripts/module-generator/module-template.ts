import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path'

import Ajv2020 from 'ajv/dist/2020'

import type { ParsedModuleName } from './module-name'

const moduleTemplateSchemaV1Sha256 =
  '9a78ed43d49ca81744381062996d6df8860f4d30b82c09e59e740eaeddb87f00'

function isJsonSchema(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Rejects a schema that was changed together with its manifest version.
 *
 * @param schemaSource - Exact UTF-8 bytes of the checked version-one schema.
 * @throws Error when the external schema is not the independently pinned V1.
 */
function assertCanonicalSchema(schemaSource: string): void {
  const actualSha256 = createHash('sha256').update(schemaSource).digest('hex')
  if (actualSha256 !== moduleTemplateSchemaV1Sha256) {
    throw new Error('Unsupported module template schema bytes')
  }
}

/**
 * Maps one external template file to a project-relative target.
 */
export interface ModuleTemplateFile {
  readonly target: string
  readonly template: string
}

/**
 * Describes the checked version-one module template.
 */
export interface ModuleTemplateManifestV1 {
  readonly files: readonly ModuleTemplateFile[]
  readonly schemaVersion: 1
}

/**
 * Describes one rendered file relative to the project root.
 */
export interface RenderedModuleFile {
  readonly content: string
  readonly target: string
}

interface CanonicalTemplateRoots {
  readonly canonical: string
  readonly lexical: string
}

/**
 * Verifies that a resolved candidate is a child of the expected root.
 *
 * @param root - Absolute lexical or canonical root path.
 * @param candidate - Absolute path resolved in the same path space as the root.
 * @param message - Error reported when the candidate is not a strict child.
 * @throws Error when the candidate equals or escapes the root.
 */
function assertContained(
  root: string,
  candidate: string,
  message: string,
): void {
  const relativeCandidate = relative(root, candidate)
  if (
    relativeCandidate === '' ||
    isAbsolute(relativeCandidate) ||
    relativeCandidate === '..' ||
    relativeCandidate.startsWith(`..${sep}`)
  ) {
    throw new Error(message)
  }
}

/**
 * Rejects absolute, escaping or non-canonical manifest path spelling.
 *
 * @param path - Manifest source or target path to validate.
 * @param escapeMessage - Error reported for absolute or parent traversal paths.
 * @throws Error when the path is not portable normalized forward-slash spelling.
 */
function assertProjectRelative(path: string, escapeMessage: string): void {
  const segments = path.split('/')
  if (
    path.length === 0 ||
    posix.isAbsolute(path) ||
    win32.isAbsolute(path) ||
    segments.includes('..')
  ) {
    throw new Error(escapeMessage)
  }
  if (
    path.includes('\\') ||
    segments.includes('') ||
    segments.includes('.') ||
    posix.normalize(path) !== path
  ) {
    throw new Error(`Module template path is not normalized: ${path}`)
  }
}

/**
 * Restricts a rendered target to the three generator-owned directory trees.
 *
 * @param target - Validated project-relative rendered target.
 * @param name - Canonical module name used to form allowed prefixes.
 * @throws Error when the target is outside every generated tree.
 */
function assertGeneratedModuleTarget(
  target: string,
  name: ParsedModuleName,
): void {
  const allowedPrefixes = [
    `src/modules/${name.kebabCase}/`,
    `test/unit/modules/${name.kebabCase}/`,
    `test/architecture/modules/${name.kebabCase}/`,
  ]
  if (!allowedPrefixes.some((prefix) => target.startsWith(prefix))) {
    throw new Error(
      `Generated target is outside the generated module trees: ${target}`,
    )
  }
}

/**
 * Replaces only explicitly owned template variables.
 *
 * @param source - Template path or file contents.
 * @param tokens - Own-property token whitelist and replacement values.
 * @returns Rendered text without unresolved template delimiters.
 * @throws Error for unknown, inherited or malformed tokens.
 */
function renderTokens(
  source: string,
  tokens: Readonly<Record<string, string>>,
): string {
  const rendered = source.replace(
    /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu,
    (_match, token: string): string => {
      if (!Object.hasOwn(tokens, token)) {
        throw new Error(`Unknown module template token: ${token}`)
      }
      return tokens[token] ?? ''
    },
  )
  if (rendered.includes('{{') || rendered.includes('}}')) {
    throw new Error('Malformed module template token')
  }
  return rendered
}

/**
 * Resolves both caller-visible and canonical template root paths.
 *
 * @param templateRoot - Template root supplied by the generator caller.
 * @returns Lexical and realpath-normalized absolute roots.
 * @throws Error when the template root does not exist.
 */
async function resolveTemplateRoots(
  templateRoot: string,
): Promise<CanonicalTemplateRoots> {
  const lexical = resolve(templateRoot)
  return {
    canonical: await realpath(lexical),
    lexical,
  }
}

/**
 * Resolves one validated template file in lexical and canonical path spaces.
 *
 * @param roots - Lexical and canonical template roots.
 * @param templatePath - Portable project-relative path from the manifest.
 * @returns Canonical file path that is safe to read.
 * @throws Error for lexical or symlink-mediated template-root escape.
 */
async function resolveCanonicalTemplateFile(
  roots: CanonicalTemplateRoots,
  templatePath: string,
): Promise<string> {
  assertProjectRelative(
    templatePath,
    `Template path escapes template root: ${templatePath}`,
  )
  const lexicalPath = resolve(roots.lexical, templatePath)
  assertContained(
    roots.lexical,
    lexicalPath,
    `Template path escapes template root: ${templatePath}`,
  )
  const canonicalPath = await realpath(lexicalPath)
  assertContained(
    roots.canonical,
    canonicalPath,
    `Template path escapes canonical template root: ${templatePath}`,
  )
  return canonicalPath
}

/**
 * Reads and validates the external versioned module template manifest.
 *
 * @param templateRoot - Directory containing manifest, schema and template files.
 * @returns Schema-validated manifest with unique safe paths.
 * @throws Error for schema byte/version drift, duplicate targets or path traversal.
 */
export async function readModuleTemplateManifest(
  templateRoot: string,
): Promise<ModuleTemplateManifestV1> {
  const roots = await resolveTemplateRoots(templateRoot)
  const [manifestPath, schemaPath] = await Promise.all([
    resolveCanonicalTemplateFile(roots, 'module.template.json'),
    resolveCanonicalTemplateFile(roots, 'module-template.schema.json'),
  ])
  const [manifestSource, schemaSource] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(schemaPath, 'utf8'),
  ])
  assertCanonicalSchema(schemaSource)
  const manifest = JSON.parse(manifestSource) as unknown
  const schema = JSON.parse(schemaSource) as unknown
  if (!isJsonSchema(schema)) {
    throw new Error('Invalid module template schema: expected an object')
  }
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
  }).compile<ModuleTemplateManifestV1>(schema)

  if (!validate(manifest)) {
    const details = validate.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ')
    throw new Error(
      `Invalid module template manifest: ${details ?? 'unknown error'}`,
    )
  }

  const targets = new Set<string>()
  const canonicalTemplatePaths = new Set<string>()
  for (const file of manifest.files) {
    const canonicalTemplatePath = await resolveCanonicalTemplateFile(
      roots,
      file.template,
    )
    assertProjectRelative(
      file.target,
      `Generated target escapes project root: ${file.target}`,
    )
    if (targets.has(file.target)) {
      throw new Error(`Duplicate module template target: ${file.target}`)
    }
    if (canonicalTemplatePaths.has(canonicalTemplatePath)) {
      throw new Error(`Duplicate module template source: ${file.template}`)
    }
    targets.add(file.target)
    canonicalTemplatePaths.add(canonicalTemplatePath)
  }

  return manifest
}

/**
 * Renders every external template file for one validated module name.
 *
 * @param templateRoot - Checked external template directory.
 * @param name - Validated canonical module name.
 * @returns Stable project-relative rendered files.
 * @throws Error for unknown tokens, malformed tokens or unsafe rendered paths.
 */
export async function renderModuleFiles(
  templateRoot: string,
  name: ParsedModuleName,
): Promise<readonly RenderedModuleFile[]> {
  const roots = await resolveTemplateRoots(templateRoot)
  const manifest = await readModuleTemplateManifest(roots.canonical)
  const tokens = {
    displayName: name.kebabCase
      .split('-')
      .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
      .join(' '),
    kebabCase: name.kebabCase,
    pascalCase: name.pascalCase,
  }
  const renderedTargets = new Set<string>()
  const renderedEntries = manifest.files.map((file) => {
    const target = renderTokens(file.target, tokens)
    assertProjectRelative(
      target,
      `Generated target escapes project root: ${target}`,
    )
    assertGeneratedModuleTarget(target, name)
    if (renderedTargets.has(target)) {
      throw new Error(`Duplicate rendered module target: ${target}`)
    }
    renderedTargets.add(target)
    return { file, target }
  })
  const files = await Promise.all(
    renderedEntries.map(
      async ({ file, target }): Promise<RenderedModuleFile> => {
        const templatePath = await resolveCanonicalTemplateFile(
          roots,
          file.template,
        )
        const content = renderTokens(
          await readFile(templatePath, 'utf8'),
          tokens,
        )
        return { content, target }
      },
    ),
  )

  return files.sort((left, right) =>
    left.target < right.target ? -1 : left.target > right.target ? 1 : 0,
  )
}
